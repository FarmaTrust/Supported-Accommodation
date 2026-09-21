<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Support\Authz;
use App\Support\Dates;
use App\Support\EncryptedFields;
use App\Support\StaffWorkspaceSupport;
use App\Support\WorkspaceGuards;
use App\Support\WorkspacePolicy;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * staffWorkspace.*, mirroring server/routers/staffWorkspace.ts.
 *
 * The frontline workspace: what a worker sees on shift at a property, what they
 * see for the young people they key-work, their own HR records, and the queue a
 * manager reviews. Most of its content is encrypted at field level, so rows
 * leave through EncryptedFields rather than being returned directly.
 */
final class StaffWorkspaceRouter
{
    private const VISITOR_TYPES = [
        'friend', 'relative', 'professional', 'contractor', 'public_official', 'other',
    ];

    private const ID_CHECK_STATUSES = [
        'not_required', 'not_checked', 'verified', 'declined', 'unavailable',
    ];

    private const CHECK_TYPES = [
        'room_check', 'property_check', 'fire_check', 'night_check', 'health_safety', 'welfare', 'other',
    ];

    /** What authorised an entry into someone's home. */
    private const AUTHORITY_BASES = [
        'scheduled', 'consent', 'risk_assessment', 'emergency', 'policy', 'other',
    ];

    private const MAINTENANCE_CATEGORIES = [
        'plumbing', 'electrical', 'heating', 'fire_safety', 'security', 'furniture',
        'appliance', 'fabric', 'pest', 'cleaning', 'other',
    ];

    private const MAINTENANCE_STATUSES = [
        'triaged', 'assigned', 'scheduled', 'in_progress', 'completed', 'verified', 'cancelled', 'reopened',
    ];

    public static function register(Registry $registry): void
    {
        $registry->query('staffWorkspace.context', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyIds = Authz::currentShiftPropertyIds($ctx->userId(), $entityId, 'property.read');

            $access = Authz::userAccess($ctx->userId());
            $role = $access['user']['operationalRole'] === 'owner' ? 'owner' : null;
            if ($role === null) {
                foreach ($access['memberships'] as $membership) {
                    if ($membership['entityId'] === $entityId) {
                        $role = $membership['operationalRole'];
                        break;
                    }
                }
            }

            $properties = $propertyIds === []
                ? []
                : DB::table('properties')->whereIn('id', $propertyIds)->get()->map(static fn ($r) => (array) $r)->all();

            $query = DB::table('placements')->where('entityId', $entityId);
            if ($propertyIds !== []) {
                $query->whereIn('propertyId', $propertyIds);
            }

            // A support worker sees only the young people they are currently
            // assigned to. With no live assignment they see none, rather than
            // falling through to everyone at the property.
            if ($role === 'support_worker') {
                $now = \App\Support\Dates::nowMillis();
                $assigned = DB::table('workerAssignments')
                    ->where('entityId', $entityId)
                    ->where('userId', $ctx->userId())
                    ->where(fn ($q) => $q->whereNull('startsAt')->orWhere('startsAt', '<=', $now))
                    ->where(fn ($q) => $q->whereNull('endsAt')->orWhere('endsAt', '>', $now))
                    ->pluck('placementId')->all();

                $query->whereIn('id', $assigned === [] ? [-1] : $assigned);
            }

            $profile = DB::table('staffProfiles')
                ->where('entityId', $entityId)->where('userId', $ctx->userId())->first();

            return [
                'role' => $role,
                'isManager' => WorkspacePolicy::isManagerRole($role),
                'properties' => $properties,
                'placements' => $query->get()->map(static fn ($r) => (array) $r)->all(),
                'staffProfile' => $profile === null ? null : (array) $profile,
            ];
        });

        $registry->query('staffWorkspace.propertyWorkspace', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            Authz::assertCurrentShiftPropertyCapability($ctx->userId(), $entityId, $propertyId, 'property.read');

            $scoped = static fn (string $table) => DB::table($table)
                ->where('entityId', $entityId)->where('propertyId', $propertyId);

            return [
                // A visitor's name, why they came and what was noted are all
                // encrypted; the vehicle registration is deliberately not
                // revealed here, and strip() drops it either way.
                'visitors' => EncryptedFields::revealAll(
                    $scoped('propertyVisitors')->orderByDesc('arrivedAt')->get(),
                    ['name', 'relationship', 'purpose', 'notes', 'departureNotes'],
                ),
                'checks' => $scoped('propertyChecks')->orderByDesc('createdAt')->get()
                    ->map(static fn ($r) => (array) $r)->all(),
                'maintenance' => $scoped('maintenanceJobs')->orderByDesc('updatedAt')->get()
                    ->map(static fn ($r) => (array) $r)->all(),
                'loneWorkers' => $scoped('loneWorkerSessions')->orderByDesc('updatedAt')->get()
                    ->map(static fn ($r) => (array) $r)->all(),
                'presence' => $scoped('propertyPresenceEvents')->orderByDesc('occurredAt')->get()
                    ->map(static fn ($r) => (array) $r)->all(),
                'rollCalls' => $scoped('emergencyRollCalls')->orderByDesc('initiatedAt')->get()
                    ->map(static fn ($r) => (array) $r)->all(),
            ];
        });

        $registry->query('staffWorkspace.placementWorkspace', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            $placementId = Validate::id($input['placementId'] ?? null, 'placementId');

            $scoped = WorkspaceGuards::assertPlacementScope(
                $ctx->userId(), $entityId, $propertyId, $placementId, 'young_person.read'
            );
            $isManager = WorkspacePolicy::isManagerRole($scoped['access']['role'] ?? null);

            $byPlacement = static fn (string $table) => DB::table($table)->where('placementId', $placementId);

            $concerns = [];
            foreach ($byPlacement('safeguardingConcerns')->orderByDesc('createdAt')->get() as $row) {
                if ($isManager) {
                    $concerns[] = EncryptedFields::reveal((array) $row, ['summary', 'immediateProtection']);
                    continue;
                }

                // A worker sees that a concern exists, its type, risk and review
                // date, so they can act on it. The account of what happened is a
                // manager's record.
                $concerns[] = [
                    'id' => (int) $row->id,
                    'entityId' => (int) $row->entityId,
                    'propertyId' => $row->propertyId === null ? null : (int) $row->propertyId,
                    'placementId' => (int) $row->placementId,
                    'concernType' => $row->concernType,
                    'riskLevel' => $row->riskLevel,
                    'status' => $row->status,
                    'reviewDueAt' => $row->reviewDueAt,
                    'createdAt' => \App\Support\Dates::fromDatabase($row->createdAt),
                    'restricted' => true,
                ];
            }

            return [
                'goals' => EncryptedFields::revealAll(
                    $byPlacement('supportGoals')->orderByDesc('updatedAt')->get(),
                    ['description', 'youngPersonView'],
                ),
                'sessions' => EncryptedFields::revealAll(
                    $byPlacement('keyworkSessions')->orderByDesc('occurredAt')->get(),
                    ['objectives', 'discussion', 'youngPersonView', 'outcome'],
                ),
                'notes' => EncryptedFields::revealAll(
                    $byPlacement('dailyNotes')->orderByDesc('observedAt')->get(),
                    ['content', 'youngPersonView'],
                ),
                'reports' => $byPlacement('keyWorkerReports')->orderByDesc('reportDate')->get()
                    ->map(static fn ($r) => (array) $r)->all(),
                'financeAccounts' => $byPlacement('residentFinanceAccounts')->orderByDesc('updatedAt')->get()
                    ->map(static fn ($r) => (array) $r)->all(),
                'valuables' => $byPlacement('residentValuables')->orderByDesc('receivedAt')->get()
                    ->map(static fn ($r) => (array) $r)->all(),
                'concerns' => $concerns,
            ];
        });

        $registry->query('staffWorkspace.staffWorkspace', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'staff.self_service');

            $profile = DB::table('staffProfiles')
                ->where('entityId', $entityId)->where('userId', $ctx->userId())->first();

            if ($profile === null) {
                return ['profile' => null, 'requests' => [], 'supervisions' => []];
            }

            return [
                'profile' => (array) $profile,
                'requests' => DB::table('staffRequests')
                    ->where('entityId', $entityId)->where('userId', $ctx->userId())
                    ->orderByDesc('createdAt')->get()->map(static fn ($r) => (array) $r)->all(),
                // Only the shared notes are revealed. A supervision session also
                // holds the manager's private notes, which the subject does not
                // see, and strip() removes them.
                'supervisions' => EncryptedFields::revealAll(
                    DB::table('supervisionSessions')
                        ->where('entityId', $entityId)->where('staffProfileId', $profile->id)
                        ->orderByDesc('scheduledAt')->get(),
                    ['sharedNotes'],
                ),
            ];
        });

        $registry->query('staffWorkspace.managerQueue', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            WorkspaceGuards::assertManager($ctx->userId(), $entityId);

            $rows = static fn (string $table, callable $filter) => $filter(
                DB::table($table)->where('entityId', $entityId)
            )->get()->map(static fn ($r) => (array) $r)->all();

            return [
                'reports' => $rows('keyWorkerReports', fn ($q) => $q->whereIn('status', ['submitted', 'reviewed'])),
                'incidents' => $rows('incidents', fn ($q) => $q->whereIn('managerReviewState', ['pending', 'in_review'])),
                'propertyChecks' => $rows('propertyChecks', fn ($q) => $q->where('status', 'submitted')),
                'staffRequests' => $rows('staffRequests', fn ($q) => $q->where('status', 'submitted')),
                'medicationDiscrepancies' => $rows('medicationDiscrepancies', fn ($q) => $q->where('status', '!=', 'closed')),
                'financeTransactions' => $rows('residentFinanceTransactions', fn ($q) => $q->where('status', 'submitted')),
                'reconciliations' => $rows('residentFinanceReconciliations', fn ($q) => $q->whereIn('status', ['submitted', 'balanced', 'discrepancy'])),
                'financeDiscrepancies' => $rows('residentFinanceDiscrepancies', fn ($q) => $q->where('status', '!=', 'closed')),
                'safeguardingConcerns' => $rows('safeguardingConcerns', fn ($q) => $q->where('status', '!=', 'closed')),
                'investigations' => $rows('investigations', fn ($q) => $q->where('status', '!=', 'closed')),
            ];
        });

        $registry->query('staffWorkspace.evidenceReviewQueue', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            WorkspaceGuards::assertManager($ctx->userId(), $entityId);

            $rows = DB::table('staffRequests as r')
                ->join('staffProfiles as p', 'p.id', '=', 'r.staffProfileId')
                ->leftJoin('documents as d', 'd.id', '=', 'r.evidenceDocumentId')
                ->leftJoin('documentVersions as v', function ($join): void {
                    $join->on('v.documentId', '=', 'd.id')->on('v.version', '=', 'd.currentVersion');
                })
                ->where('r.entityId', $entityId)
                ->whereIn('r.requestType', ['certificate_submission', 'sickness'])
                ->where('r.status', 'submitted')
                ->orderByDesc('r.createdAt')
                ->select([
                    'r.*', 'p.fullName as staffName',
                    'd.id as documentId', 'd.title as documentTitle', 'd.status as documentStatus',
                    'v.fileName', 'v.fileUrl', 'v.scanStatus',
                ])
                ->get();

            $out = [];
            foreach ($rows as $row) {
                $request = (array) $row;
                foreach (['documentId', 'documentTitle', 'documentStatus', 'fileName', 'fileUrl', 'scanStatus'] as $key) {
                    unset($request[$key]);
                }

                $request['evidence'] = $row->documentId === null ? null : [
                    'documentId' => (int) $row->documentId,
                    'title' => $row->documentTitle,
                    'status' => $row->documentStatus,
                    'fileName' => $row->fileName,
                    'fileUrl' => $row->fileUrl,
                    'scanStatus' => $row->scanStatus,
                ];

                $out[] = $request;
            }

            return $out;
        });

        $registry->mutation('staffWorkspace.arriveVisitor', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            Authz::assertCurrentShiftPropertyCapability($ctx->userId(), $entityId, $propertyId, 'frontline.write');

            $placementId = Validate::optionalId($input['placementId'] ?? null, 'placementId');
            if ($placementId !== null) {
                // Recording a visitor against a young person is a disclosure
                // about that young person, so it needs the placement check too.
                Authz::assertCurrentShiftPlacementCapability($ctx->userId(), $placementId, 'young_person.read');
            }

            $visitorType = Validate::enum($input['visitorType'] ?? null, self::VISITOR_TYPES, 'visitorType');
            $name = Validate::string($input['name'] ?? null, 'name', 2, 180);
            $relationship = Validate::optionalString($input['relationship'] ?? null, 'relationship', 220);
            $purpose = Validate::string($input['purpose'] ?? null, 'purpose', 2, 2000);
            $idCheckStatus = Validate::enum($input['idCheckStatus'] ?? 'not_checked', self::ID_CHECK_STATUSES, 'idCheckStatus');
            $identityDocumentId = Validate::optionalId($input['identityDocumentId'] ?? null, 'identityDocumentId');
            $expectedDepartureAt = isset($input['expectedDepartureAt']) ? Validate::int($input['expectedDepartureAt'], 'expectedDepartureAt') : null;
            $notes = Validate::optionalString($input['notes'] ?? null, 'notes', 4000);

            $now = Dates::nowMillis();

            $visitorId = DB::transaction(static function () use ($ctx, $entityId, $propertyId, $placementId, $visitorType, $name, $relationship, $purpose, $idCheckStatus, $identityDocumentId, $expectedDepartureAt, $notes, $now): int {
                // Who visited, why, and anything noted about them is held
                // encrypted: a visitor log names people who are not staff and not
                // residents.
                $id = (int) DB::table('propertyVisitors')->insertGetId([
                    'entityId' => $entityId,
                    'propertyId' => $propertyId,
                    'placementId' => $placementId,
                    'visitorType' => $visitorType,
                    'nameCiphertext' => EncryptedFields::seal($name),
                    'relationshipCiphertext' => EncryptedFields::seal($relationship),
                    'purposeCiphertext' => EncryptedFields::seal($purpose),
                    'notesCiphertext' => EncryptedFields::seal($notes),
                    'idCheckStatus' => $idCheckStatus,
                    'identityDocumentId' => $identityDocumentId,
                    'expectedDepartureAt' => $expectedDepartureAt,
                    'arrivedAt' => $now,
                    'createdBy' => $ctx->userId(),
                ]);

                DB::table('propertyPresenceEvents')->insert([
                    'entityId' => $entityId,
                    'propertyId' => $propertyId,
                    'placementId' => $placementId,
                    'visitorId' => $id,
                    'personType' => StaffWorkspaceSupport::presencePersonType($visitorType),
                    'eventType' => 'arrived',
                    'presenceState' => 'present',
                    'source' => 'visitor_log',
                    'occurredAt' => $now,
                    'createdBy' => $ctx->userId(),
                ]);

                return $id;
            });

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'action' => 'visitor.arrive',
                'resourceType' => 'property_visitor',
                'resourceId' => $visitorId,
                'sensitivity' => 'restricted',
                'result' => 'success',
                // The visitor's name stays out of the audit metadata.
                'metadata' => ['visitorType' => $visitorType, 'idCheckStatus' => $idCheckStatus],
            ]);

            return ['id' => $visitorId];
        });

        $registry->mutation('staffWorkspace.departVisitor', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $visitorId = Validate::id($input['visitorId'] ?? null, 'visitorId');
            $expectedVersion = Validate::int($input['expectedVersion'] ?? null, 'expectedVersion', 1);
            $departureNotes = Validate::optionalString($input['departureNotes'] ?? null, 'departureNotes', 4000);

            $visitor = DB::table('propertyVisitors')->where('id', $visitorId)->where('entityId', $entityId)->first();
            if ($visitor === null) {
                throw TrpcException::notFound('Visitor record not found');
            }

            Authz::assertCurrentShiftPropertyCapability($ctx->userId(), $entityId, (int) $visitor->propertyId, 'frontline.write');
            WorkspacePolicy::assertExpectedVersion((int) $visitor->version, $expectedVersion);

            $now = Dates::nowMillis();

            DB::transaction(static function () use ($ctx, $entityId, $visitor, $departureNotes, $now): void {
                DB::table('propertyVisitors')->where('id', $visitor->id)->update([
                    'departedAt' => $now,
                    'departureNotesCiphertext' => EncryptedFields::seal($departureNotes),
                    'status' => 'departed',
                    'version' => (int) $visitor->version + 1,
                ]);

                DB::table('propertyPresenceEvents')->insert([
                    'entityId' => $entityId,
                    'propertyId' => (int) $visitor->propertyId,
                    'placementId' => $visitor->placementId,
                    'visitorId' => (int) $visitor->id,
                    'personType' => StaffWorkspaceSupport::presencePersonType((string) $visitor->visitorType),
                    'eventType' => 'departed',
                    'presenceState' => 'off_site',
                    'source' => 'visitor_log',
                    'occurredAt' => $now,
                    'createdBy' => $ctx->userId(),
                ]);
            });

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => (int) $visitor->propertyId,
                'action' => 'visitor.depart',
                'resourceType' => 'property_visitor',
                'resourceId' => (int) $visitor->id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'metadata' => [
                    'visitorType' => $visitor->visitorType,
                    'departureNoteRecorded' => $departureNotes !== null,
                ],
            ]);

            return ['success' => true];
        });

        $registry->mutation('staffWorkspace.startBreak', Registry::USER, static function (Context $ctx, mixed $input): array {
            $shiftId = Validate::id($input['shiftId'] ?? null, 'shiftId');
            $shift = StaffWorkspaceSupport::assertShiftActor($ctx->userId(), $shiftId)['shift'];

            $startClockEventId = Validate::optionalId($input['startClockEventId'] ?? null, 'startClockEventId');
            $plannedMinutes = isset($input['plannedMinutes'])
                ? Validate::int($input['plannedMinutes'], 'plannedMinutes', 5, 240)
                : null;

            // Two open breaks on one shift would make the worked hours
            // unreconcilable, so a second is refused rather than merged.
            $active = DB::table('shiftBreaks')
                ->where('shiftId', $shiftId)->where('userId', $ctx->userId())->where('status', 'active')
                ->first('id');

            if ($active !== null) {
                throw TrpcException::conflict('A break is already active');
            }

            $breakId = (int) DB::table('shiftBreaks')->insertGetId([
                'entityId' => (int) $shift['entityId'],
                'propertyId' => (int) $shift['propertyId'],
                'shiftId' => (int) $shift['id'],
                'userId' => $ctx->userId(),
                'startClockEventId' => $startClockEventId,
                'startedAt' => Dates::nowMillis(),
                'plannedMinutes' => $plannedMinutes,
            ]);

            return ['id' => $breakId];
        });

        $registry->mutation('staffWorkspace.endBreak', Registry::USER, static function (Context $ctx, mixed $input): array {
            $breakId = Validate::id($input['breakId'] ?? null, 'breakId');
            $endClockEventId = Validate::optionalId($input['endClockEventId'] ?? null, 'endClockEventId');
            $exceptionReason = Validate::optionalString($input['exceptionReason'] ?? null, 'exceptionReason', 2000);

            $row = DB::table('shiftBreaks')->where('id', $breakId)->first();
            if ($row === null) {
                throw TrpcException::notFound('Break not found');
            }

            StaffWorkspaceSupport::assertShiftActor($ctx->userId(), (int) $row->shiftId);

            if ($row->status !== 'active') {
                throw TrpcException::conflict('Break is already closed');
            }

            $now = Dates::nowMillis();

            DB::table('shiftBreaks')->where('id', $row->id)->update([
                'endedAt' => $now,
                'endClockEventId' => $endClockEventId,
                // Derived from the timestamps rather than taken from the caller,
                // so a break cannot be recorded as shorter than it was.
                'actualMinutes' => max(0, (int) round(($now - (int) $row->startedAt) / 60000)),
                'status' => 'completed',
                'exceptionReasonCiphertext' => EncryptedFields::seal($exceptionReason),
            ]);

            return ['success' => true];
        });

        $registry->mutation('staffWorkspace.createPropertyCheck', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            Authz::assertCurrentShiftPropertyCapability($ctx->userId(), $entityId, $propertyId, 'frontline.write');

            $placementId = Validate::optionalId($input['placementId'] ?? null, 'placementId');
            if ($placementId !== null) {
                Authz::assertCurrentShiftPlacementCapability($ctx->userId(), $placementId, 'young_person.write');
            }

            $checkType = Validate::enum($input['checkType'] ?? null, self::CHECK_TYPES, 'checkType');
            $authorityBasis = Validate::enum($input['authorityBasis'] ?? null, self::AUTHORITY_BASES, 'authorityBasis');
            $result = Validate::enum($input['result'] ?? null, ['pass', 'issues_found', 'urgent_action'], 'result');
            $status = Validate::enum($input['status'] ?? 'submitted', ['draft', 'submitted'], 'status');
            $checklist = self::validateChecklist($input['checklist'] ?? null);

            $checkId = (int) DB::table('propertyChecks')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'unitId' => Validate::optionalId($input['unitId'] ?? null, 'unitId'),
                'placementId' => $placementId,
                'shiftId' => Validate::optionalId($input['shiftId'] ?? null, 'shiftId'),
                'checkType' => $checkType,
                // A room check is an intrusion into someone's home, so the record
                // states what authorised it.
                'authorityBasis' => $authorityBasis,
                'checklistSnapshot' => json_encode($checklist, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                'findingsCiphertext' => EncryptedFields::seal(Validate::optionalString($input['findings'] ?? null, 'findings', 6000)),
                'privacyNotesCiphertext' => EncryptedFields::seal(Validate::optionalString($input['privacyNotes'] ?? null, 'privacyNotes', 4000)),
                'youngPersonPresent' => Validate::bool($input['youngPersonPresent'] ?? false, 'youngPersonPresent') ? 1 : 0,
                'result' => $result,
                'status' => $status,
                'completedAt' => $status === 'submitted' ? Dates::nowMillis() : null,
                'createdBy' => $ctx->userId(),
            ]);

            if ($result === 'urgent_action') {
                StaffWorkspaceSupport::notifyManagers(
                    $entityId, $propertyId, 'property_check', $checkId,
                    'Urgent property check', true, "/app/property/$propertyId",
                );
            }

            return ['id' => $checkId];
        });

        $registry->mutation('staffWorkspace.reviewPropertyCheck', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $checkId = Validate::id($input['checkId'] ?? null, 'checkId');
            $decision = Validate::enum($input['decision'] ?? null, ['reviewed', 'returned', 'closed'], 'decision');
            $expectedVersion = Validate::int($input['expectedVersion'] ?? null, 'expectedVersion', 1);
            $notes = Validate::optionalString($input['notes'] ?? null, 'notes', 4000);

            WorkspaceGuards::assertManager($ctx->userId(), $entityId);

            $row = DB::table('propertyChecks')->where('id', $checkId)->where('entityId', $entityId)->first();
            if ($row === null) {
                throw TrpcException::notFound('Property check not found');
            }

            WorkspacePolicy::assertIndependentReviewer($row->createdBy === null ? null : (int) $row->createdBy, $ctx->userId());
            WorkspacePolicy::assertExpectedVersion((int) $row->version, $expectedVersion);
            WorkspacePolicy::assertTransition('property_check', (string) $row->status, $decision);

            DB::table('propertyChecks')->where('id', $row->id)->update([
                'status' => $decision,
                'reviewedBy' => $ctx->userId(),
                'reviewedAt' => Dates::nowMillis(),
                'reviewNotesCiphertext' => EncryptedFields::seal($notes),
                'version' => (int) $row->version + 1,
            ]);

            return ['success' => true];
        });

        $registry->mutation('staffWorkspace.createMaintenance', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            Authz::assertCurrentShiftPropertyCapability($ctx->userId(), $entityId, $propertyId, 'frontline.write');

            $priority = Validate::enum($input['priority'] ?? 'routine', ['routine', 'urgent', 'emergency'], 'priority');

            $jobId = (int) DB::table('maintenanceJobs')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'unitId' => Validate::optionalId($input['unitId'] ?? null, 'unitId'),
                'propertyCheckId' => Validate::optionalId($input['propertyCheckId'] ?? null, 'propertyCheckId'),
                'incidentId' => Validate::optionalId($input['incidentId'] ?? null, 'incidentId'),
                'title' => Validate::string($input['title'] ?? null, 'title', 3, 220),
                'category' => Validate::enum($input['category'] ?? null, self::MAINTENANCE_CATEGORIES, 'category'),
                'priority' => $priority,
                // The description can name the room and the resident, and the
                // access notes can carry key or alarm details.
                'descriptionCiphertext' => EncryptedFields::seal(Validate::string($input['description'] ?? null, 'description', 5, 6000)),
                'accessNotesCiphertext' => EncryptedFields::seal(Validate::optionalString($input['accessNotes'] ?? null, 'accessNotes', 4000)),
                'targetAt' => isset($input['targetAt']) ? Validate::int($input['targetAt'], 'targetAt') : null,
                'createdBy' => $ctx->userId(),
            ]);

            if ($priority !== 'routine') {
                StaffWorkspaceSupport::notifyManagers(
                    $entityId, $propertyId, 'maintenance_job', $jobId,
                    'Urgent maintenance', $priority === 'emergency', "/app/property/$propertyId",
                );
            }

            return ['id' => $jobId];
        });

        $registry->mutation('staffWorkspace.transitionMaintenance', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $jobId = Validate::id($input['jobId'] ?? null, 'jobId');
            $nextStatus = Validate::enum($input['nextStatus'] ?? null, self::MAINTENANCE_STATUSES, 'nextStatus');
            $expectedVersion = Validate::int($input['expectedVersion'] ?? null, 'expectedVersion', 1);
            $note = Validate::optionalString($input['note'] ?? null, 'note', 4000);
            $assignedUserId = Validate::optionalId($input['assignedUserId'] ?? null, 'assignedUserId');
            $contractorName = Validate::optionalString($input['contractorName'] ?? null, 'contractorName', 220);

            $row = DB::table('maintenanceJobs')->where('id', $jobId)->where('entityId', $entityId)->first();
            if ($row === null) {
                throw TrpcException::notFound('Maintenance job not found');
            }

            Authz::assertCurrentShiftPropertyCapability($ctx->userId(), $entityId, (int) $row->propertyId, 'frontline.write');
            WorkspacePolicy::assertExpectedVersion((int) $row->version, $expectedVersion);
            WorkspacePolicy::assertTransition('maintenance', (string) $row->status, $nextStatus);

            // Signing a repair off as verified is a check on somebody else's
            // work, so it takes a manager who did not raise the job.
            if ($nextStatus === 'verified') {
                WorkspaceGuards::assertManager($ctx->userId(), $entityId);
                WorkspacePolicy::assertIndependentReviewer($row->createdBy === null ? null : (int) $row->createdBy, $ctx->userId());
            }

            $now = Dates::nowMillis();

            DB::transaction(static function () use ($ctx, $entityId, $row, $nextStatus, $assignedUserId, $contractorName, $note, $now): void {
                DB::table('maintenanceJobs')->where('id', $row->id)->update([
                    'status' => $nextStatus,
                    'assignedUserId' => $assignedUserId ?? $row->assignedUserId,
                    'contractorName' => $contractorName ?? $row->contractorName,
                    'completedAt' => $nextStatus === 'completed' ? $now : $row->completedAt,
                    'verifiedBy' => $nextStatus === 'verified' ? $ctx->userId() : $row->verifiedBy,
                    'verifiedAt' => $nextStatus === 'verified' ? $now : $row->verifiedAt,
                    'version' => (int) $row->version + 1,
                ]);

                // Each move leaves its own row, so the job carries its history
                // rather than only its latest state.
                DB::table('maintenanceUpdates')->insert([
                    'entityId' => $entityId,
                    'maintenanceJobId' => (int) $row->id,
                    'updateType' => match ($nextStatus) {
                        'reopened' => 'reopen',
                        'completed' => 'completion',
                        default => 'status_change',
                    },
                    'statusFrom' => $row->status,
                    'statusTo' => $nextStatus,
                    'noteCiphertext' => EncryptedFields::seal($note),
                    'occurredAt' => $now,
                    'createdBy' => $ctx->userId(),
                ]);
            });

            return ['success' => true];
        });

        $registry->mutation('staffWorkspace.startLoneWorker', Registry::USER, static function (Context $ctx, mixed $input): array {
            $shiftId = Validate::id($input['shiftId'] ?? null, 'shiftId');
            $shift = StaffWorkspaceSupport::assertShiftActor($ctx->userId(), $shiftId)['shift'];

            $interval = Validate::int($input['checkInIntervalMinutes'] ?? 60, 'checkInIntervalMinutes', 15, 240);
            $escalation = Validate::int($input['escalationAfterMinutes'] ?? 15, 'escalationAfterMinutes', 5, 120);
            $now = Dates::nowMillis();

            $sessionId = (int) DB::table('loneWorkerSessions')->insertGetId([
                'entityId' => (int) $shift['entityId'],
                'propertyId' => (int) $shift['propertyId'],
                'shiftId' => (int) $shift['id'],
                'userId' => $ctx->userId(),
                'startsAt' => $now,
                'expectedEndAt' => $shift['endsAt'],
                'checkInIntervalMinutes' => $interval,
                'escalationAfterMinutes' => $escalation,
                'nextCheckInDueAt' => $now + $interval * 60000,
                'createdBy' => $ctx->userId(),
            ]);

            return ['id' => $sessionId];
        });

        $registry->mutation('staffWorkspace.loneWorkerCheckIn', Registry::USER, static function (Context $ctx, mixed $input): array {
            $sessionId = Validate::id($input['sessionId'] ?? null, 'sessionId');
            $checkInType = Validate::enum($input['checkInType'] ?? null, ['scheduled', 'manual', 'help_requested', 'session_end'], 'checkInType');
            $wellbeingStatus = Validate::enum($input['wellbeingStatus'] ?? null, ['safe', 'concern', 'help_required'], 'wellbeingStatus');
            $locationState = Validate::enum($input['locationState'] ?? null, ['on_site', 'off_site', 'unavailable', 'manual'], 'locationState');
            $expectedVersion = Validate::int($input['expectedVersion'] ?? null, 'expectedVersion', 1);
            $note = Validate::optionalString($input['note'] ?? null, 'note', 4000);

            $latitude = isset($input['latitude']) ? Validate::decimal($input['latitude'], 'latitude', -90, 90) : null;
            $longitude = isset($input['longitude']) ? Validate::decimal($input['longitude'], 'longitude', -180, 180) : null;
            $accuracy = isset($input['accuracyMetres']) ? Validate::decimal($input['accuracyMetres'], 'accuracyMetres', 0, 10000) : null;

            $row = DB::table('loneWorkerSessions')->where('id', $sessionId)->first();
            if ($row === null) {
                throw TrpcException::notFound('Lone-worker session not found');
            }

            StaffWorkspaceSupport::assertShiftActor($ctx->userId(), (int) $row->shiftId);
            WorkspacePolicy::assertExpectedVersion((int) $row->version, $expectedVersion);

            $now = Dates::nowMillis();
            $urgent = $checkInType === 'help_requested' || $wellbeingStatus === 'help_required';

            $checkInId = DB::transaction(static function () use ($ctx, $row, $checkInType, $wellbeingStatus, $locationState, $latitude, $longitude, $accuracy, $note, $now, $urgent): int {
                $id = (int) DB::table('loneWorkerCheckIns')->insertGetId([
                    'entityId' => (int) $row->entityId,
                    'sessionId' => (int) $row->id,
                    'checkInType' => $checkInType,
                    'wellbeingStatus' => $wellbeingStatus,
                    'occurredAt' => $now,
                    'latitude' => $latitude === null ? null : (string) $latitude,
                    'longitude' => $longitude === null ? null : (string) $longitude,
                    'accuracyMetres' => $accuracy === null ? null : (string) $accuracy,
                    'locationState' => $locationState,
                    'noteCiphertext' => EncryptedFields::seal($note),
                    'createdBy' => $ctx->userId(),
                ]);

                DB::table('loneWorkerSessions')->where('id', $row->id)->update([
                    'lastCheckInAt' => $now,
                    'nextCheckInDueAt' => $now + (int) $row->checkInIntervalMinutes * 60000,
                    'status' => $checkInType === 'session_end' ? 'completed' : ($urgent ? 'escalated' : 'active'),
                    'escalatedAt' => $urgent ? $now : $row->escalatedAt,
                    'completedAt' => $checkInType === 'session_end' ? $now : $row->completedAt,
                    'version' => (int) $row->version + 1,
                ]);

                return $id;
            });

            // A worker asking for help, or reporting that they need it, reaches
            // the managers immediately rather than waiting for a missed check-in.
            if ($urgent) {
                StaffWorkspaceSupport::notifyManagers(
                    (int) $row->entityId, (int) $row->propertyId, 'lone_worker_session', (int) $row->id,
                    'Lone-worker alert', true, '/app/property/' . (int) $row->propertyId,
                );
            }

            return ['id' => $checkInId];
        });

        $registry->mutation('staffWorkspace.createGoal', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            $placementId = Validate::id($input['placementId'] ?? null, 'placementId');
            WorkspaceGuards::assertPlacementScope($ctx->userId(), $entityId, $propertyId, $placementId, 'young_person.write');

            $goalId = (int) DB::table('supportGoals')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'placementId' => $placementId,
                'carePlanId' => Validate::optionalId($input['carePlanId'] ?? null, 'carePlanId'),
                'title' => Validate::string($input['title'] ?? null, 'title', 3, 220),
                'descriptionCiphertext' => EncryptedFields::seal(Validate::optionalString($input['description'] ?? null, 'description', 5000)),
                'outcomeArea' => Validate::optionalString($input['outcomeArea'] ?? null, 'outcomeArea', 160),
                'targetAt' => isset($input['targetAt']) ? Validate::int($input['targetAt'], 'targetAt') : null,
                // What the young person said about the goal, in their words, is
                // kept alongside the worker's version.
                'youngPersonViewCiphertext' => EncryptedFields::seal(Validate::optionalString($input['youngPersonView'] ?? null, 'youngPersonView', 4000)),
                'reviewDueAt' => isset($input['reviewDueAt']) ? Validate::int($input['reviewDueAt'], 'reviewDueAt') : null,
                'status' => 'active',
                'createdBy' => $ctx->userId(),
            ]);

            return ['id' => $goalId];
        });

        $registry->mutation('staffWorkspace.createKeyworkSession', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            $placementId = Validate::id($input['placementId'] ?? null, 'placementId');
            WorkspaceGuards::assertPlacementScope($ctx->userId(), $entityId, $propertyId, $placementId, 'young_person.write');

            $actions = isset($input['actions']) ? Validate::arrayOf($input['actions'], 'actions', 30) : [];
            foreach ($actions as $index => $action) {
                $action = Validate::object($action, "actions.$index");
                Validate::string($action['title'] ?? null, "actions.$index.title", 2, 220);
            }

            $sessionId = (int) DB::table('keyworkSessions')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'placementId' => $placementId,
                'shiftId' => Validate::optionalId($input['shiftId'] ?? null, 'shiftId'),
                'goalId' => Validate::optionalId($input['goalId'] ?? null, 'goalId'),
                'topic' => Validate::string($input['topic'] ?? null, 'topic', 3, 220),
                'occurredAt' => Validate::int($input['occurredAt'] ?? null, 'occurredAt'),
                'durationMinutes' => isset($input['durationMinutes']) ? Validate::int($input['durationMinutes'], 'durationMinutes', 1, 600) : null,
                'objectivesCiphertext' => EncryptedFields::seal(Validate::optionalString($input['objectives'] ?? null, 'objectives', 5000)),
                'discussionCiphertext' => EncryptedFields::seal(Validate::string($input['discussion'] ?? null, 'discussion', 10, 12000)),
                'youngPersonViewCiphertext' => EncryptedFields::seal(Validate::optionalString($input['youngPersonView'] ?? null, 'youngPersonView', 8000)),
                'outcomeCiphertext' => EncryptedFields::seal(Validate::optionalString($input['outcome'] ?? null, 'outcome', 8000)),
                'status' => Validate::enum($input['status'] ?? 'submitted', ['draft', 'submitted'], 'status'),
                'createdBy' => $ctx->userId(),
            ]);

            return ['id' => $sessionId];
        });
    }

    /**
     * A check is stored with the questions that were asked, not only the
     * answers, so a later reviewer can see what the worker was shown.
     *
     * @return array<int, array<string, mixed>>
     */
    private static function validateChecklist(mixed $checklist): array
    {
        $items = Validate::arrayOf($checklist, 'checklist', 100);
        if ($items === []) {
            throw TrpcException::badRequest('Record at least one checklist item.');
        }

        $out = [];
        foreach ($items as $index => $item) {
            $item = Validate::object($item, "checklist.$index");
            $out[] = [
                'key' => Validate::string($item['key'] ?? null, "checklist.$index.key", 1, 80),
                'label' => Validate::string($item['label'] ?? null, "checklist.$index.label", 1, 180),
                'result' => Validate::enum($item['result'] ?? null, ['pass', 'fail', 'not_applicable'], "checklist.$index.result"),
                'note' => Validate::optionalString($item['note'] ?? null, "checklist.$index.note", 1000),
            ];
        }

        return $out;
    }
}
