<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\AgePolicy;
use App\Support\Audit;
use App\Support\Authz;
use App\Support\Crypto;
use App\Support\Dates;
use App\Support\RotaCoverage;
use App\Support\RotaOverview;
use App\Support\RotaRules;
use App\Support\ShiftReminders;
use App\Support\WorkspacePolicy;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * operations.*, mirroring server/routers/operations.ts.
 *
 * The rota, attendance, handovers and timesheets: who is meant to be in the
 * house, who actually turned up, what they passed on at the end, and what they
 * get paid for. Nearly every write here produces a warning list rather than a
 * refusal, because a rota is a negotiation with reality — the exceptions are
 * the working-time blocks, which exist for the worker's safety and need a
 * recorded override to pass.
 */
final class OperationsRouter
{
    private const HOUR_MS = 3600000;

    private const SHIFT_BRIEF_TEMPLATES = [
        ['code' => 'nursing_general', 'label' => 'Nursing shift handover', 'fields' => ['Clinical observations', 'Medication and administration', 'Care delivered', 'Risks and escalation', 'Outstanding actions']],
        ['code' => 'nursing_night', 'label' => 'Night shift handover', 'fields' => ['Night observations', 'Sleep and welfare', 'Medication and checks', 'Incidents or risks', 'Morning actions']],
        ['code' => 'operational', 'label' => 'Operational shift handover', 'fields' => ['Shift summary', 'People and property updates', 'Risks', 'Actions due', 'Manager escalation']],
    ];

    private const CONTACT_SHIFT_STATUSES = ['assigned', 'confirmed', 'in_progress'];

    public static function register(Registry $registry): void
    {
        self::registerRota($registry);
        self::registerShifts($registry);
        self::registerAttendance($registry);
        self::registerHandovers($registry);
        self::registerTimesheets($registry);
    }

    // ---------------------------------------------------------------- rota

    private static function registerRota(Registry $registry): void
    {
        $registry->query('operations.handoverTemplates', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'shift.read');

            return self::SHIFT_BRIEF_TEMPLATES;
        });

        $registry->query('operations.rotaOverview', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $now = Dates::nowMillis();
            $rotaDayStart = isset($input['rotaDayStart'])
                ? Validate::int($input['rotaDayStart'], 'rotaDayStart', 0)
                : RotaOverview::operationalDayStart($now);

            if (abs($rotaDayStart - $now) > 370 * RotaOverview::DAY_MS) {
                throw TrpcException::badRequest('Choose an operational rota day within one year of today.');
            }

            $propertyIds = Authz::accessiblePropertyIds($ctx->userId(), $entityId, 'shift.read');
            if ($propertyIds === []) {
                return RotaOverview::build($rotaDayStart, [], []);
            }

            $propertyId = Validate::optionalId($input['propertyId'] ?? null, 'propertyId');
            if ($propertyId !== null && !in_array($propertyId, $propertyIds, true)) {
                throw TrpcException::forbidden('This property is outside your authorised rota scope.');
            }

            $role = self::roleFor($ctx->userId(), $entityId);
            $scoped = $propertyId !== null ? [$propertyId] : $propertyIds;

            $properties = DB::table('properties')
                ->where('entityId', $entityId)->whereIn('id', $scoped)->where('status', 'active')
                ->get(['id', 'name', 'minimumStaffing'])
                ->map(static fn ($row) => [
                    'id' => (int) $row->id,
                    'name' => (string) $row->name,
                    'minimumStaffing' => (int) $row->minimumStaffing,
                ])->all();

            $query = DB::table('shifts as s')
                ->join('properties as p', 'p.id', '=', 's.propertyId')
                ->leftJoin('users as u', 'u.id', '=', 's.assignedUserId')
                ->where('s.entityId', $entityId)
                ->whereIn('s.propertyId', $scoped)
                ->where('s.startsAt', '<=', $rotaDayStart + RotaOverview::DAY_MS - 1)
                ->where('s.endsAt', '>', $rotaDayStart)
                ->orderBy('s.startsAt');

            if ($role === 'support_worker') {
                $query->where('s.assignedUserId', $ctx->userId());
            }

            $shifts = $query->get(['s.*', 'p.name as propertyName', 'u.name as workerName'])
                ->map(static fn ($row) => self::shiftRow($row))->all();

            // Frontline users can only inspect their own assigned shifts. Do not
            // derive property-wide gaps from that intentionally partial data set.
            return RotaOverview::build($rotaDayStart, $shifts, $role === 'support_worker' ? [] : $properties);
        });

        $registry->mutation('operations.evaluateRotaCoverage', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $access = Authz::assertEntityCapability($ctx->userId(), $entityId, 'shift.write');

            if (!in_array($access['role'], ['owner', 'registered_manager'], true)
                && ($ctx->requireUser()['operationalRole'] ?? null) !== 'platform_admin'
            ) {
                throw TrpcException::forbidden('Only an Owner or Registered Manager can run coverage alerts.');
            }

            $propertyIds = Authz::accessiblePropertyIds($ctx->userId(), $entityId, 'shift.read');
            $propertyId = Validate::optionalId($input['propertyId'] ?? null, 'propertyId');
            if ($propertyId !== null && !in_array($propertyId, $propertyIds, true)) {
                throw TrpcException::forbidden('This property is outside your authorised rota scope.');
            }

            $from = isset($input['from'])
                ? Validate::int($input['from'], 'from', 0)
                : RotaOverview::operationalDayStart(Dates::nowMillis());
            $to = isset($input['to']) ? Validate::int($input['to'], 'to', 0) : $from + 31 * RotaOverview::DAY_MS;

            try {
                return RotaCoverage::evaluate([
                    'entityId' => $entityId,
                    'from' => $from,
                    'to' => $to,
                    'propertyIds' => $propertyId !== null ? [$propertyId] : $propertyIds,
                    'actorUserId' => $ctx->userId(),
                    'actorType' => 'user',
                ]);
            } catch (RuntimeException $error) {
                throw TrpcException::badRequest($error->getMessage());
            }
        });

        $registry->query('operations.calendarWorkers', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            Authz::assertPropertyCapability($ctx->userId(), $entityId, $propertyId, 'shift.write');

            return self::eligibleWorkers($entityId, $propertyId, true);
        });

        $registry->query('operations.availableReplacementStaff', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            $startsAt = Validate::int($input['startsAt'] ?? null, 'startsAt');
            $endsAt = Validate::int($input['endsAt'] ?? null, 'endsAt');
            $requiredRole = Validate::optionalString($input['requiredRole'] ?? null, 'requiredRole', 120);

            AgePolicy::assertDateRange($startsAt, $endsAt, 'Replacement cover');
            Authz::assertPropertyCapability($ctx->userId(), $entityId, $propertyId, 'shift.write');

            $candidates = [];
            foreach (self::eligibleWorkers($entityId, $propertyId, false) as $worker) {
                $warnings = self::schedulabilityWarnings($entityId, $propertyId, (int) $worker['userId'], [
                    'startsAt' => $startsAt, 'endsAt' => $endsAt, 'requiredRole' => $requiredRole,
                ]);

                $candidates[] = [
                    'id' => (int) $worker['userId'],
                    'name' => $worker['name'] ?? 'Unnamed Key Worker',
                    'email' => $worker['email'],
                    'warnings' => $warnings,
                    'available' => !self::isBlocked($warnings),
                ];
            }

            usort($candidates, static fn (array $left, array $right) => ((int) $right['available'] <=> (int) $left['available'])
                ?: strcmp((string) $left['name'], (string) $right['name']));

            return $candidates;
        });

        $registry->mutation('operations.assignCoverageGapReplacement', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            $startsAt = Validate::int($input['startsAt'] ?? null, 'startsAt');
            $endsAt = Validate::int($input['endsAt'] ?? null, 'endsAt');
            $gapKey = Validate::string($input['gapKey'] ?? null, 'gapKey', 8, 180);
            $slot = Validate::int($input['slot'] ?? null, 'slot', 1, 30);
            $userId = Validate::id($input['userId'] ?? null, 'userId');
            $requiredRole = Validate::optionalString($input['requiredRole'] ?? null, 'requiredRole', 120);
            $overrideReason = Validate::optionalString($input['overrideReason'] ?? null, 'overrideReason', 4000);

            AgePolicy::assertDateRange($startsAt, $endsAt, 'Replacement cover');
            Authz::assertPropertyCapability($ctx->userId(), $entityId, $propertyId, 'shift.write');

            $rotaDayStart = RotaOverview::operationalDayStart($startsAt);
            $property = DB::table('properties')->where('id', $propertyId)->where('entityId', $entityId)
                ->first(['id', 'name', 'minimumStaffing']);

            if ($property === null) {
                throw TrpcException::notFound('Property not found.');
            }

            $overview = RotaOverview::build(
                $rotaDayStart,
                RotaCoverage::overviewShifts($entityId, [$propertyId], $rotaDayStart, $rotaDayStart + RotaOverview::DAY_MS),
                [['id' => (int) $property->id, 'name' => (string) $property->name, 'minimumStaffing' => (int) $property->minimumStaffing]],
            );

            // The gap key carries the exact interval and shortfall, so a rota
            // that moved under the manager's feet fails here rather than
            // silently rostering somebody against a hole that no longer exists.
            $gap = null;
            foreach ($overview['coverageGaps'] as $candidate) {
                if ($candidate['key'] === $gapKey && $candidate['propertyId'] === $propertyId
                    && $candidate['startsAt'] === $startsAt && $candidate['endsAt'] === $endsAt
                ) {
                    $gap = $candidate;
                    break;
                }
            }

            if ($gap === null) {
                throw TrpcException::conflict('This coverage gap has changed or is already resolved. Refresh the rota before assigning replacement cover.');
            }
            if ($slot > $gap['deficit']) {
                throw TrpcException::badRequest('This replacement slot is outside the current staffing deficit.');
            }

            $taken = DB::table('shifts')
                ->where('propertyId', $propertyId)->where('coverageGapKey', $gapKey)->where('coverageGapSlot', $slot)
                ->first('id');

            if ($taken !== null) {
                throw TrpcException::conflict('This replacement slot has already been allocated. Refresh the rota to see the latest coverage.');
            }

            $warnings = self::schedulabilityWarnings($entityId, $propertyId, $userId, [
                'startsAt' => $startsAt, 'endsAt' => $endsAt, 'requiredRole' => $requiredRole,
            ]);

            if (self::isBlocked($warnings)) {
                throw new TrpcException('PRECONDITION_FAILED', 'This Key Worker is not available for the selected cover interval. Choose an available replacement.');
            }

            $overridden = RotaRules::requireCalendarOverride($warnings, $overrideReason);

            $shiftId = (int) DB::table('shifts')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'assignedUserId' => $userId,
                'title' => 'Replacement cover',
                'startsAt' => $startsAt,
                'endsAt' => $endsAt,
                'requiredRole' => $requiredRole,
                'status' => 'assigned',
                'coverageState' => $warnings === [] ? 'covered' : 'at_risk',
                'coverageGapKey' => $gapKey,
                'coverageGapSlot' => $slot,
                'notes' => 'Manager allocation created from an identified coverage gap.',
                'createdBy' => $ctx->userId(),
            ]);

            self::refreshPropertyCoverage($propertyId);

            $evaluation = RotaCoverage::evaluate([
                'entityId' => $entityId,
                'from' => $rotaDayStart,
                'to' => $rotaDayStart + RotaOverview::DAY_MS,
                'propertyIds' => [$propertyId],
                'actorUserId' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId, 'propertyId' => $propertyId,
                'action' => 'shift.coverage_gap_assign', 'resourceType' => 'shift', 'resourceId' => $shiftId,
                'sensitivity' => 'general', 'result' => 'success',
                'metadata' => [
                    'coverageGapKey' => $gapKey,
                    'coverageGapSlot' => $slot,
                    'replacementUserId' => $userId,
                    'warnings' => $warnings,
                    'overridden' => $overridden,
                    'coverageGapCountAfterAllocation' => $evaluation['gapCount'],
                    'overrideReasonCiphertext' => $overridden && $overrideReason !== null ? Crypto::encrypt($overrideReason) : null,
                ],
            ]);

            return ['id' => $shiftId, 'warnings' => $warnings, 'overridden' => $overridden, 'remainingGapCount' => $evaluation['gapCount']];
        });
    }

    // -------------------------------------------------------------- shifts

    private static function registerShifts(Registry $registry): void
    {
        $registry->query('operations.shifts', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyIds = Authz::accessiblePropertyIds($ctx->userId(), $entityId, 'shift.read');
            if ($propertyIds === []) {
                return [];
            }

            $role = self::roleFor($ctx->userId(), $entityId);
            $query = DB::table('shifts')
                ->where('entityId', $entityId)->whereIn('propertyId', $propertyIds)->orderBy('startsAt');

            if ($role === 'support_worker') {
                $query->where('assignedUserId', $ctx->userId());
            }

            $shifts = $query->get()->map(static fn ($row) => self::shiftRow($row))->all();

            self::raiseShiftReminders($ctx->userId(), $entityId, $propertyIds, $shifts);

            return $shifts;
        });

        $registry->query('operations.shiftContacts', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $shiftId = Validate::id($input['shiftId'] ?? null, 'shiftId');

            $shift = DB::table('shifts')->where('id', $shiftId)->where('entityId', $entityId)->first();
            if ($shift === null) {
                throw TrpcException::notFound('Shift not found.');
            }

            $propertyId = (int) $shift->propertyId;
            $access = Authz::assertCurrentShiftPropertyCapability($ctx->userId(), $entityId, $propertyId, 'shift.read');

            if ($access['role'] === 'support_worker' && (int) $shift->assignedUserId !== $ctx->userId()) {
                throw TrpcException::forbidden('You can only view contact details for your own assigned shift.');
            }

            $property = DB::table('properties')->where('id', $propertyId)->first(['id', 'name', 'managerUserId']);
            if ($property === null) {
                throw TrpcException::notFound('Property not found.');
            }

            $contactColumns = ['u.id', 'u.name', 'u.email', 'u.phone', 'sp.jobTitle', 'sp.phone as profilePhone'];

            $overlaps = DB::table('shifts as s')
                ->join('users as u', 'u.id', '=', 's.assignedUserId')
                ->leftJoin('staffProfiles as sp', fn ($join) => $join->on('sp.userId', '=', 'u.id')->where('sp.entityId', '=', $entityId))
                ->where('s.entityId', $entityId)->where('s.propertyId', $propertyId)
                ->whereIn('s.status', self::CONTACT_SHIFT_STATUSES)
                ->where('s.startsAt', '<', (int) $shift->endsAt)
                ->where('s.endsAt', '>', (int) $shift->startsAt)
                ->get($contactColumns);

            $managerAssignments = DB::table('propertyAssignments as pa')
                ->join('users as u', 'u.id', '=', 'pa.userId')
                ->leftJoin('staffProfiles as sp', fn ($join) => $join->on('sp.userId', '=', 'u.id')->where('sp.entityId', '=', $entityId))
                ->where('pa.entityId', $entityId)->where('pa.propertyId', $propertyId)
                ->where('pa.assignmentType', 'manager')
                ->get($contactColumns);

            $managerIds = [];
            foreach ($managerAssignments as $manager) {
                $managerIds[(int) $manager->id] = true;
            }

            $namedManager = [];
            if ($property->managerUserId !== null) {
                $managerIds[(int) $property->managerUserId] = true;

                if (!$managerAssignments->contains(static fn ($row) => (int) $row->id === (int) $property->managerUserId)) {
                    $namedManager = DB::table('users as u')
                        ->leftJoin('staffProfiles as sp', fn ($join) => $join->on('sp.userId', '=', 'u.id')->where('sp.entityId', '=', $entityId))
                        ->where('u.id', (int) $property->managerUserId)
                        ->limit(1)->get($contactColumns)->all();
                }
            }

            $colleagues = [];
            foreach ($overlaps as $row) {
                if ((int) $row->id !== $ctx->userId() && !isset($managerIds[(int) $row->id])) {
                    $colleagues[] = self::contact($row, 'On-shift colleague');
                }
            }

            $supervisors = [];
            $seen = [];
            foreach ([...$managerAssignments->all(), ...$namedManager] as $row) {
                if (!isset($seen[(int) $row->id])) {
                    $seen[(int) $row->id] = true;
                    $supervisors[] = self::contact($row, 'Property manager / supervisor');
                }
            }

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId, 'propertyId' => $propertyId,
                'action' => 'shift.contacts.read', 'resourceType' => 'shift', 'resourceId' => (int) $shift->id,
                'sensitivity' => 'restricted', 'result' => 'allowed',
                'metadata' => ['colleagueCount' => count($colleagues), 'supervisorCount' => count($supervisors)],
            ]);

            return [
                'shift' => [
                    'id' => (int) $shift->id,
                    'title' => $shift->title,
                    'startsAt' => (int) $shift->startsAt,
                    'endsAt' => (int) $shift->endsAt,
                ],
                'property' => ['id' => (int) $property->id, 'name' => $property->name],
                'colleagues' => $colleagues,
                'supervisors' => $supervisors,
            ];
        });

        $registry->mutation('operations.createShift', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            $assignedUserId = Validate::optionalId($input['assignedUserId'] ?? null, 'assignedUserId');
            $title = Validate::string($input['title'] ?? 'Support shift', 'title', 2, 140);
            $startsAt = Validate::int($input['startsAt'] ?? null, 'startsAt');
            $endsAt = Validate::int($input['endsAt'] ?? null, 'endsAt');
            $requiredRole = Validate::optionalString($input['requiredRole'] ?? null, 'requiredRole', 120);
            $notes = Validate::optionalString($input['notes'] ?? null, 'notes', 2000);
            $overrideReason = Validate::optionalString($input['overrideReason'] ?? null, 'overrideReason', 4000);

            AgePolicy::assertDateRange($startsAt, $endsAt, 'Shift');
            Authz::assertPropertyCapability($ctx->userId(), $entityId, $propertyId, 'shift.write');

            $warnings = $assignedUserId === null ? [] : self::schedulabilityWarnings($entityId, $propertyId, $assignedUserId, [
                'startsAt' => $startsAt, 'endsAt' => $endsAt, 'requiredRole' => $requiredRole,
            ]);
            $overridden = RotaRules::requireCalendarOverride($warnings, $overrideReason);

            $shiftId = (int) DB::table('shifts')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'assignedUserId' => $assignedUserId,
                'title' => $title,
                'startsAt' => $startsAt,
                'endsAt' => $endsAt,
                'requiredRole' => $requiredRole,
                'notes' => $notes,
                'createdBy' => $ctx->userId(),
                'status' => $assignedUserId !== null ? 'assigned' : 'open',
                'coverageState' => $assignedUserId === null ? 'uncovered' : ($warnings === [] ? 'covered' : 'at_risk'),
            ]);

            self::refreshPropertyCoverage($propertyId);

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId, 'propertyId' => $propertyId,
                'action' => 'shift.create', 'resourceType' => 'shift', 'resourceId' => $shiftId, 'result' => 'success',
                'metadata' => [
                    'warnings' => $warnings,
                    'overridden' => $overridden,
                    'overrideReasonCiphertext' => $overridden && $overrideReason !== null ? Crypto::encrypt($overrideReason) : null,
                ],
            ]);

            return ['id' => $shiftId, 'warnings' => $warnings];
        });

        $registry->mutation('operations.rescheduleShift', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $shiftId = Validate::id($input['shiftId'] ?? null, 'shiftId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            $assignedUserId = Validate::optionalId($input['assignedUserId'] ?? null, 'assignedUserId');
            $startsAt = Validate::int($input['startsAt'] ?? null, 'startsAt');
            $endsAt = Validate::int($input['endsAt'] ?? null, 'endsAt');
            $expectedUpdatedAt = isset($input['expectedUpdatedAt']) ? Validate::int($input['expectedUpdatedAt'], 'expectedUpdatedAt') : null;
            $overrideReason = Validate::optionalString($input['overrideReason'] ?? null, 'overrideReason', 4000);

            AgePolicy::assertDateRange($startsAt, $endsAt, 'Shift');

            $current = DB::table('shifts')->where('id', $shiftId)->where('entityId', $entityId)->first();
            if ($current === null) {
                throw TrpcException::notFound('The shift no longer exists. Refresh the calendar.');
            }

            $currentPropertyId = (int) $current->propertyId;
            $currentAssignedUserId = $current->assignedUserId === null ? null : (int) $current->assignedUserId;

            Authz::assertPropertyCapability($ctx->userId(), $entityId, $currentPropertyId, 'shift.write');
            Authz::assertPropertyCapability($ctx->userId(), $entityId, $propertyId, 'shift.write');

            $currentVersion = (Dates::fromDatabase($current->updatedAt)?->getTimestamp() ?? 0) * 1000;
            if (RotaRules::isStaleCalendarVersion($expectedUpdatedAt, $currentVersion)) {
                throw TrpcException::conflict('This shift was changed by another user. Refresh the calendar before moving it again.');
            }

            $warnings = $assignedUserId === null ? [] : self::schedulabilityWarnings($entityId, $propertyId, $assignedUserId, [
                'id' => (int) $current->id,
                'startsAt' => $startsAt,
                'endsAt' => $endsAt,
                'requiredRole' => $current->requiredRole,
            ]);
            $overridden = RotaRules::requireCalendarOverride($warnings, $overrideReason);
            $eventType = $currentAssignedUserId !== $assignedUserId ? 'reassigned' : 'edited';

            DB::transaction(static function () use ($current, $entityId, $propertyId, $assignedUserId, $startsAt, $endsAt, $warnings, $eventType, $currentPropertyId, $currentAssignedUserId, $ctx): void {
                DB::table('shifts')->where('id', (int) $current->id)->update([
                    'propertyId' => $propertyId,
                    'assignedUserId' => $assignedUserId,
                    'startsAt' => $startsAt,
                    'endsAt' => $endsAt,
                    'status' => $assignedUserId !== null ? 'assigned' : 'open',
                    'coverageState' => $assignedUserId === null ? 'uncovered' : ($warnings === [] ? 'covered' : 'at_risk'),
                ]);

                $eventId = (int) DB::table('shiftChangeEvents')->insertGetId([
                    'entityId' => $entityId,
                    'propertyId' => $propertyId,
                    'shiftId' => (int) $current->id,
                    'eventType' => $eventType,
                    'reasonKey' => 'calendar_drag',
                    'reason' => 'Manager calendar scheduling change',
                    'previousSnapshot' => json_encode([
                        'propertyId' => $currentPropertyId,
                        'assignedUserId' => $currentAssignedUserId,
                        'startsAt' => (int) $current->startsAt,
                        'endsAt' => (int) $current->endsAt,
                    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                    'newSnapshot' => json_encode([
                        'propertyId' => $propertyId,
                        'assignedUserId' => $assignedUserId,
                        'startsAt' => $startsAt,
                        'endsAt' => $endsAt,
                    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                    'affectedUserId' => $assignedUserId,
                    'createdBy' => $ctx->userId(),
                ]);

                // Both the worker losing the shift and the one gaining it have to
                // see the change, so each gets an unread acknowledgement row.
                $affected = array_values(array_unique(array_filter([$assignedUserId, $currentAssignedUserId])));
                foreach ($affected as $userId) {
                    DB::table('shiftChangeAcknowledgements')->upsert([[
                        'entityId' => $entityId,
                        'shiftChangeEventId' => $eventId,
                        'userId' => $userId,
                        'status' => 'unread',
                        'readAt' => null,
                        'acknowledgedAt' => null,
                    ]], ['shiftChangeEventId', 'userId'], ['status', 'readAt', 'acknowledgedAt']);
                }
            });

            self::refreshPropertyCoverage($currentPropertyId);
            if ($propertyId !== $currentPropertyId) {
                self::refreshPropertyCoverage($propertyId);
            }

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId, 'propertyId' => $propertyId,
                'action' => 'shift.calendar_reschedule', 'resourceType' => 'shift', 'resourceId' => (int) $current->id,
                'sensitivity' => 'general', 'result' => 'success',
                'metadata' => [
                    'warnings' => $warnings,
                    'overridden' => $overridden,
                    'previousPropertyId' => $currentPropertyId,
                    'previousAssignedUserId' => $currentAssignedUserId,
                    'overrideReasonCiphertext' => $overridden && $overrideReason !== null ? Crypto::encrypt($overrideReason) : null,
                ],
            ]);

            return ['success' => true, 'warnings' => $warnings, 'overridden' => $overridden];
        });

        $registry->mutation('operations.requestShiftChange', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            $shiftId = Validate::id($input['shiftId'] ?? null, 'shiftId');
            $requestType = Validate::enum($input['requestType'] ?? null, ['claim', 'swap', 'release', 'cancel'], 'requestType');
            $proposedUserId = Validate::optionalId($input['proposedUserId'] ?? null, 'proposedUserId');
            $reason = Validate::string($input['reason'] ?? null, 'reason', 3, 2000);

            Authz::assertPropertyCapability($ctx->userId(), $entityId, $propertyId, 'shift.read');

            $requestId = (int) DB::table('shiftRequests')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'shiftId' => $shiftId,
                'requestType' => $requestType,
                'proposedUserId' => $proposedUserId,
                'reason' => $reason,
                'requestedBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId, 'propertyId' => $propertyId,
                'action' => "shift_request.$requestType", 'resourceType' => 'shift_request',
                'resourceId' => $requestId, 'result' => 'success',
            ]);

            return ['id' => $requestId];
        });

        $registry->query('operations.pendingShiftRequests', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'shift.write');

            return DB::table('shiftRequests')
                ->where('entityId', $entityId)->where('status', 'pending')->orderBy('createdAt')
                ->get()->map(static fn ($row) => self::timestamps((array) $row))->all();
        });

        $registry->mutation('operations.reviewShiftRequest', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $id = Validate::id($input['id'] ?? null, 'id');
            $decision = Validate::enum($input['decision'] ?? null, ['approved', 'declined'], 'decision');
            $notes = Validate::optionalString($input['notes'] ?? null, 'notes', 2000);

            Authz::assertEntityCapability($ctx->userId(), $entityId, 'shift.write');

            $request = DB::table('shiftRequests')->where('id', $id)->where('entityId', $entityId)->first();
            if ($request === null || $request->status !== 'pending') {
                throw TrpcException::badRequest('Pending request not found');
            }

            $shift = DB::table('shifts')->where('id', (int) $request->shiftId)->first();
            if ($shift === null) {
                throw TrpcException::badRequest('Shift not found');
            }

            $targetUserId = match ($request->requestType) {
                'claim' => (int) $request->requestedBy,
                'swap' => $request->proposedUserId === null ? null : (int) $request->proposedUserId,
                default => null,
            };

            $warnings = $decision === 'approved' && $targetUserId !== null
                ? self::assignmentWarnings($entityId, $targetUserId, self::shiftRow($shift))
                : [];

            DB::transaction(static function () use ($request, $decision, $notes, $warnings, $ctx): void {
                DB::table('shiftRequests')->where('id', (int) $request->id)->update([
                    'status' => $decision,
                    'reviewedBy' => $ctx->userId(),
                    'reviewedAt' => Dates::nowMillis(),
                    'reviewNotes' => $notes,
                ]);

                if ($decision !== 'approved') {
                    return;
                }

                $coverageState = $warnings === [] ? 'covered' : 'at_risk';
                $update = match ($request->requestType) {
                    'claim' => ['assignedUserId' => (int) $request->requestedBy, 'status' => 'assigned', 'coverageState' => $coverageState],
                    'swap' => $request->proposedUserId === null
                        ? null
                        : ['assignedUserId' => (int) $request->proposedUserId, 'status' => 'assigned', 'coverageState' => $coverageState],
                    'release' => ['assignedUserId' => null, 'status' => 'open', 'coverageState' => 'uncovered'],
                    'cancel' => ['status' => 'cancelled', 'coverageState' => 'uncovered'],
                    default => null,
                };

                if ($update !== null) {
                    DB::table('shifts')->where('id', (int) $request->shiftId)->update($update);
                }
            });

            self::refreshPropertyCoverage((int) $shift->propertyId);

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => "shift_request.$decision", 'resourceType' => 'shift_request',
                'resourceId' => $id, 'result' => 'success', 'metadata' => ['warnings' => $warnings],
            ]);

            return ['success' => true, 'warnings' => $warnings];
        });
    }

    // ---------------------------------------------------------- attendance

    private static function registerAttendance(Registry $registry): void
    {
        $registry->mutation('operations.clock', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            $shiftId = Validate::optionalId($input['shiftId'] ?? null, 'shiftId');
            $eventType = Validate::enum($input['eventType'] ?? null, ['clock_in', 'clock_out'], 'eventType');
            $latitude = isset($input['latitude']) ? Validate::decimal($input['latitude'], 'latitude', -90, 90) : null;
            $longitude = isset($input['longitude']) ? Validate::decimal($input['longitude'], 'longitude', -180, 180) : null;
            $accuracyMetres = isset($input['accuracyMetres']) ? Validate::decimal($input['accuracyMetres'], 'accuracyMetres', 0) : null;
            $overrideReason = Validate::optionalString($input['overrideReason'] ?? null, 'overrideReason', 1000);

            $access = Authz::assertPropertyCapability($ctx->userId(), $entityId, $propertyId, 'shift.read');

            if ($access['role'] === 'support_worker' && $shiftId === null) {
                throw TrpcException::forbidden('Choose your assigned shift before recording attendance.');
            }

            if ($shiftId !== null) {
                $shift = DB::table('shifts')
                    ->where('id', $shiftId)->where('entityId', $entityId)->where('propertyId', $propertyId)->first();

                if ($shift === null) {
                    throw TrpcException::notFound('Shift not found');
                }
                if (!in_array($access['role'], ['owner', 'registered_manager'], true) && (int) $shift->assignedUserId !== $ctx->userId()) {
                    throw TrpcException::forbidden('This shift is not assigned to you');
                }

                $now = Dates::nowMillis();
                if ($access['role'] === 'support_worker'
                    && ($now < (int) $shift->startsAt - 1800000 || $now > (int) $shift->endsAt + 1800000)
                ) {
                    throw TrpcException::conflict('Attendance can be recorded from 30 minutes before the assigned shift until 30 minutes after it ends.');
                }
            }

            $property = DB::table('properties')->where('id', $propertyId)->first();

            $hasCoordinates = $latitude !== null && $longitude !== null
                && $property !== null && $property->latitude !== null && $property->longitude !== null;

            $distance = $hasCoordinates
                ? RotaRules::distanceMetres($latitude, $longitude, (float) $property->latitude, (float) $property->longitude)
                : null;

            $locationState = $distance === null
                ? 'unavailable'
                : ($distance <= (float) $property->geofenceRadiusMetres ? 'on_site' : 'off_site');

            // Anything other than a confirmed on-site fix needs a reason, so an
            // off-site clock-in is a recorded decision rather than a silent one.
            if ($locationState !== 'on_site' && ($overrideReason === null || trim($overrideReason) === '')) {
                throw WorkspacePolicy::fieldError(
                    'override_reason_required',
                    'overrideReason',
                    'An off-site, manual or unavailable location requires a reason.',
                );
            }

            $eventId = (int) DB::table('clockEvents')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'shiftId' => $shiftId,
                'userId' => $ctx->userId(),
                'eventType' => $eventType,
                'occurredAt' => Dates::nowMillis(),
                'latitude' => $latitude === null ? null : number_format($latitude, 7, '.', ''),
                'longitude' => $longitude === null ? null : number_format($longitude, 7, '.', ''),
                'accuracyMetres' => $accuracyMetres === null ? null : number_format($accuracyMetres, 2, '.', ''),
                'distanceMetres' => $distance === null ? null : number_format($distance, 2, '.', ''),
                'locationState' => $locationState,
                'overrideReason' => $overrideReason,
            ]);

            if ($shiftId !== null) {
                $resolvedAt = Dates::nowMillis();
                DB::table('notifications')
                    ->where('userId', $ctx->userId())
                    ->where('dedupeKey', ShiftReminders::attendanceDedupeKey($shiftId, $ctx->userId(), $eventType))
                    ->update(['resolvedAt' => $resolvedAt, 'readAt' => $resolvedAt, 'escalationState' => 'resolved']);
            }

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId, 'propertyId' => $propertyId,
                'action' => "shift.$eventType", 'resourceType' => 'clock_event', 'resourceId' => $eventId,
                'result' => 'success',
                'metadata' => [
                    'locationState' => $locationState,
                    'overrideReasonCiphertext' => $locationState === 'on_site' ? null : Crypto::encrypt((string) $overrideReason),
                ],
            ]);

            return ['id' => $eventId, 'locationState' => $locationState, 'distanceMetres' => $distance];
        });
    }

    // ----------------------------------------------------------- handovers

    private static function registerHandovers(Registry $registry): void
    {
        $registry->query('operations.handovers', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            $shiftId = Validate::optionalId($input['shiftId'] ?? null, 'shiftId');

            Authz::assertCurrentShiftPropertyCapability($ctx->userId(), $entityId, $propertyId, 'shift.read');

            $rows = DB::table('handovers as h')
                ->join('properties as p', 'p.id', '=', 'h.propertyId')
                ->join('users as u', 'u.id', '=', 'h.createdBy')
                ->where('h.entityId', $entityId)->where('h.propertyId', $propertyId)
                ->orderBy('h.createdAt')
                ->get(['h.*', 'p.name as propertyName', 'u.name as authorName'])->all();

            $ids = array_map(static fn ($row) => (int) $row->id, $rows);

            $events = $ids === [] ? [] : DB::table('handoverReviewEvents as e')
                ->join('users as u', 'u.id', '=', 'e.createdBy')
                ->whereIn('e.handoverId', $ids)
                ->orderBy('e.createdAt')
                ->get(['e.id', 'e.handoverId', 'e.decision', 'e.notesCiphertext', 'e.createdAt', 'u.name as reviewerName'])->all();

            $acknowledged = [];
            if ($ids !== [] && $shiftId !== null) {
                $acknowledgements = DB::table('handoverAcknowledgements')
                    ->whereIn('handoverId', $ids)->where('shiftId', $shiftId)->where('userId', $ctx->userId())
                    ->get(['handoverId', 'acknowledgedAt']);

                foreach ($acknowledgements as $item) {
                    $acknowledged[(int) $item->handoverId] = (int) $item->acknowledgedAt;
                }
            }

            return array_map(static function ($row) use ($events, $acknowledged): array {
                $handover = self::timestamps((array) $row);
                $id = (int) $handover['id'];

                $history = [];
                foreach ($events as $event) {
                    if ((int) $event->handoverId !== $id) {
                        continue;
                    }

                    $history[] = [
                        'id' => (int) $event->id,
                        'handoverId' => $id,
                        'decision' => $event->decision,
                        'createdAt' => Dates::fromDatabase($event->createdAt),
                        'reviewerName' => $event->reviewerName,
                        'notes' => Crypto::decrypt($event->notesCiphertext),
                        'notesCiphertext' => null,
                    ];
                }

                $handover['authorName'] = ($handover['authorName'] ?? '') !== '' ? $handover['authorName'] : 'Authorised colleague';
                $handover['structuredBrief'] = Crypto::decrypt($handover['structuredBriefCiphertext'] ?? null);
                $handover['dictatedText'] = Crypto::decrypt($handover['dictatedTextCiphertext'] ?? null);
                $handover['reviewNotes'] = Crypto::decrypt($handover['reviewNotesCiphertext'] ?? null);
                $handover['structuredBriefCiphertext'] = null;
                $handover['dictatedTextCiphertext'] = null;
                $handover['reviewNotesCiphertext'] = null;
                $handover['acknowledgedForCurrentShiftAt'] = $acknowledged[$id] ?? null;
                $handover['reviewHistory'] = $history;

                return $handover;
            }, $rows);
        });

        $registry->mutation('operations.acknowledgeHandover', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $handoverId = Validate::id($input['handoverId'] ?? null, 'handoverId');
            $shiftId = Validate::id($input['shiftId'] ?? null, 'shiftId');

            $shift = DB::table('shifts')->where('id', $shiftId)->where('entityId', $entityId)->first();
            $handover = DB::table('handovers')->where('id', $handoverId)->where('entityId', $entityId)->first();

            if ($shift === null) {
                throw TrpcException::notFound('The current shift could not be found.');
            }
            if ($handover === null) {
                throw TrpcException::notFound('The handover could not be found.');
            }

            Authz::assertCurrentShiftPropertyCapability($ctx->userId(), $entityId, (int) $shift->propertyId, 'shift.read');
            self::assertHandoverCanBeAcknowledged($shift, $handover, $ctx->userId());

            $existing = DB::table('handoverAcknowledgements')
                ->where('handoverId', (int) $handover->id)->where('shiftId', (int) $shift->id)->where('userId', $ctx->userId())
                ->first(['id', 'acknowledgedAt']);

            if ($existing !== null) {
                return ['success' => true, 'alreadyAcknowledged' => true, 'acknowledgedAt' => (int) $existing->acknowledgedAt];
            }

            $acknowledgedAt = Dates::nowMillis();
            DB::table('handoverAcknowledgements')->insertOrIgnore([[
                'entityId' => $entityId,
                'handoverId' => (int) $handover->id,
                'shiftId' => (int) $shift->id,
                'userId' => $ctx->userId(),
                'acknowledgedAt' => $acknowledgedAt,
            ]]);

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId, 'propertyId' => (int) $shift->propertyId,
                'action' => 'handover.acknowledge', 'resourceType' => 'handover', 'resourceId' => (int) $handover->id,
                'sensitivity' => $handover->sensitivity === 'operational' ? 'general' : 'safeguarding',
                'result' => 'success',
                'metadata' => ['shiftId' => (int) $shift->id, 'acknowledgementType' => 'incoming_worker'],
            ]);

            return ['success' => true, 'alreadyAcknowledged' => false, 'acknowledgedAt' => $acknowledgedAt];
        });

        $registry->mutation('operations.createHandover', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            $shiftId = Validate::optionalId($input['shiftId'] ?? null, 'shiftId');
            $summary = Validate::string($input['summary'] ?? null, 'summary', 10, 5000);
            $risks = Validate::optionalString($input['risks'] ?? null, 'risks', 4000);
            $outstandingActions = Validate::optionalString($input['outstandingActions'] ?? null, 'outstandingActions', 4000);
            $sensitivity = Validate::enum($input['sensitivity'] ?? 'operational', ['operational', 'safeguarding', 'restricted'], 'sensitivity');
            $templateCode = Validate::optionalEnum($input['templateCode'] ?? null, ['nursing_general', 'nursing_night', 'operational'], 'templateCode');
            $structuredBrief = isset($input['structuredBrief']) ? Validate::object($input['structuredBrief'], 'structuredBrief') : null;
            $dictatedText = isset($input['dictatedText']) ? Validate::string($input['dictatedText'], 'dictatedText', 10, 8000) : null;

            Authz::assertCurrentShiftPropertyCapability($ctx->userId(), $entityId, $propertyId, 'shift.read');

            if ($shiftId !== null) {
                $shift = DB::table('shifts')
                    ->where('id', $shiftId)->where('entityId', $entityId)->where('propertyId', $propertyId)->first('id');

                if ($shift === null) {
                    throw TrpcException::forbidden('Shift scope does not match the selected property.');
                }
            }

            // Dictated notes are transcribed speech, so they go to a manager for
            // review before they count as the record of the shift.
            $reviewState = $dictatedText !== null ? 'pending_review' : 'not_required';

            $handoverId = (int) DB::table('handovers')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'shiftId' => $shiftId,
                'summary' => $summary,
                'risks' => $risks,
                'outstandingActions' => $outstandingActions,
                'sensitivity' => $sensitivity,
                'templateCode' => $templateCode,
                'structuredBriefCiphertext' => $structuredBrief === null
                    ? null
                    : Crypto::encrypt(json_encode($structuredBrief, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)),
                'dictatedTextCiphertext' => $dictatedText === null ? null : Crypto::encrypt($dictatedText),
                'dictatedReviewState' => $reviewState,
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId, 'propertyId' => $propertyId,
                'action' => 'handover.create', 'resourceType' => 'handover', 'resourceId' => $handoverId,
                'sensitivity' => $sensitivity === 'operational' ? 'general' : 'safeguarding', 'result' => 'success',
                'metadata' => ['templateCode' => $templateCode, 'dictatedReviewState' => $reviewState],
            ]);

            return ['id' => $handoverId];
        });

        $registry->mutation('operations.reviewHandover', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $handoverId = Validate::id($input['handoverId'] ?? null, 'handoverId');
            $decision = Validate::enum($input['decision'] ?? null, ['reviewed', 'approved', 'returned'], 'decision');
            $notes = Validate::optionalString($input['notes'] ?? null, 'notes', 4000);
            $notes = $notes === null ? null : trim($notes);

            $access = Authz::assertEntityCapability($ctx->userId(), $entityId, 'shift.write');
            if (!in_array($access['role'], ['owner', 'registered_manager'], true)) {
                throw TrpcException::forbidden('Manager approval is required.');
            }

            if ($decision === 'returned' && ($notes === null || mb_strlen($notes) < 10)) {
                throw TrpcException::badRequest('Add a clear return reason of at least 10 characters.');
            }

            $row = DB::table('handovers')->where('id', $handoverId)->where('entityId', $entityId)->first();
            if ($row === null) {
                throw TrpcException::notFound('Handover not found.');
            }

            // Somebody else has to read it. A worker signing off their own
            // handover is not a review.
            if ((int) $row->createdBy === $ctx->userId()) {
                throw TrpcException::forbidden('A different authorised manager must review this handover.');
            }

            $now = Dates::nowMillis();
            DB::transaction(static function () use ($row, $entityId, $decision, $notes, $now, $ctx): void {
                DB::table('handovers')->where('id', (int) $row->id)->update([
                    'dictatedReviewState' => $decision,
                    'reviewedBy' => $ctx->userId(),
                    'reviewedAt' => $now,
                    'approvedBy' => $decision === 'approved' ? $ctx->userId() : $row->approvedBy,
                    'approvedAt' => $decision === 'approved' ? $now : $row->approvedAt,
                    'reviewNotesCiphertext' => $notes === null ? null : Crypto::encrypt($notes),
                ]);

                DB::table('handoverReviewEvents')->insert([
                    'entityId' => $entityId,
                    'handoverId' => (int) $row->id,
                    'decision' => $decision,
                    'notesCiphertext' => $notes === null ? null : Crypto::encrypt($notes),
                    'createdBy' => $ctx->userId(),
                ]);
            });

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId, 'propertyId' => (int) $row->propertyId,
                'action' => "handover.$decision", 'resourceType' => 'handover', 'resourceId' => (int) $row->id,
                'sensitivity' => $row->sensitivity === 'operational' ? 'general' : 'safeguarding', 'result' => 'success',
                'metadata' => ['dictatedTextReviewed' => $row->dictatedTextCiphertext !== null],
            ]);

            return ['success' => true, 'reviewedAt' => $now];
        });
    }

    // ---------------------------------------------------------- timesheets

    private static function registerTimesheets(Registry $registry): void
    {
        $registry->query('operations.timesheets', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'shift.read');

            $role = self::roleFor($ctx->userId(), $entityId);
            $query = DB::table('timesheets')->where('entityId', $entityId)->orderBy('periodStart');

            if (!in_array($role, ['owner', 'registered_manager'], true)) {
                $query->where('userId', $ctx->userId());
            }

            return $query->get()->map(static fn ($row) => self::timestamps((array) $row))->all();
        });

        $registry->query('operations.timesheetEntries', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $timesheetId = Validate::id($input['timesheetId'] ?? null, 'timesheetId');

            Authz::assertEntityCapability($ctx->userId(), $entityId, 'shift.read');

            $sheet = DB::table('timesheets')->where('id', $timesheetId)->where('entityId', $entityId)->first();
            if ($sheet === null) {
                throw TrpcException::badRequest('Timesheet not found');
            }
            if ((int) $sheet->userId !== $ctx->userId()) {
                Authz::assertEntityCapability($ctx->userId(), $entityId, 'shift.write');
            }

            return DB::table('timesheetEntries')->where('timesheetId', (int) $sheet->id)
                ->get()->map(static fn ($row) => self::timestamps((array) $row))->all();
        });

        $registry->mutation('operations.adjustTimesheetEntry', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $timesheetId = Validate::id($input['timesheetId'] ?? null, 'timesheetId');
            $entryId = Validate::id($input['entryId'] ?? null, 'entryId');
            $minutes = Validate::int($input['minutes'] ?? null, 'minutes', 0, 1440);
            $reason = Validate::string($input['reason'] ?? null, 'reason', 5, 2000);

            Authz::assertEntityCapability($ctx->userId(), $entityId, 'shift.write');

            $sheet = DB::table('timesheets')->where('id', $timesheetId)->where('entityId', $entityId)->first();
            if ($sheet === null || !in_array($sheet->status, ['draft', 'submitted', 'returned'], true)) {
                throw TrpcException::badRequest('This timesheet can no longer be adjusted');
            }

            $entry = DB::table('timesheetEntries')->where('id', $entryId)->where('timesheetId', (int) $sheet->id)->first();
            if ($entry === null) {
                throw TrpcException::badRequest('Timesheet entry not found');
            }

            $totalMinutes = 0;
            foreach (DB::table('timesheetEntries')->where('timesheetId', (int) $sheet->id)->get(['id', 'minutes']) as $item) {
                $totalMinutes += (int) $item->id === (int) $entry->id ? $minutes : (int) $item->minutes;
            }

            // An adjusted sheet goes back to the worker: somebody changed their
            // recorded hours, and they are entitled to see it before it is paid.
            DB::transaction(static function () use ($entry, $sheet, $minutes, $reason, $totalMinutes, $ctx): void {
                DB::table('timesheetEntries')->where('id', (int) $entry->id)->update([
                    'originalMinutes' => $entry->originalMinutes ?? (int) $entry->minutes,
                    'minutes' => $minutes,
                    'exceptionType' => 'manual_adjustment',
                    'adjustmentReason' => $reason,
                    'adjustedBy' => $ctx->userId(),
                    'adjustedAt' => Dates::nowMillis(),
                ]);

                DB::table('timesheets')->where('id', (int) $sheet->id)
                    ->update(['totalMinutes' => $totalMinutes, 'status' => 'returned']);
            });

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'timesheet.adjust', 'resourceType' => 'timesheet', 'resourceId' => (int) $sheet->id,
                'sensitivity' => 'hr', 'result' => 'success',
                'metadata' => [
                    'entryId' => (int) $entry->id,
                    'originalMinutes' => (int) $entry->minutes,
                    'adjustedMinutes' => $minutes,
                ],
            ]);

            return ['success' => true, 'totalMinutes' => $totalMinutes];
        });

        $registry->mutation('operations.submitTimesheet', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $id = Validate::id($input['id'] ?? null, 'id');

            Authz::assertEntityCapability($ctx->userId(), $entityId, 'shift.read');

            $sheet = DB::table('timesheets')
                ->where('id', $id)->where('entityId', $entityId)->where('userId', $ctx->userId())->first();

            if ($sheet === null || !in_array($sheet->status, ['draft', 'returned'], true)) {
                throw TrpcException::badRequest('Only your draft or returned timesheet can be submitted');
            }

            DB::table('timesheets')->where('id', (int) $sheet->id)
                ->update(['status' => 'submitted', 'submittedAt' => Dates::nowMillis()]);

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'timesheet.submit', 'resourceType' => 'timesheet', 'resourceId' => (int) $sheet->id,
                'sensitivity' => 'hr', 'result' => 'success',
            ]);

            return ['success' => true];
        });

        $registry->mutation('operations.reviewTimesheet', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $id = Validate::id($input['id'] ?? null, 'id');
            $decision = Validate::enum($input['decision'] ?? null, ['approved', 'returned'], 'decision');

            Authz::assertEntityCapability($ctx->userId(), $entityId, 'shift.write');

            $sheet = DB::table('timesheets')->where('id', $id)->where('entityId', $entityId)->first();
            if ($sheet === null || $sheet->status !== 'submitted') {
                throw TrpcException::badRequest('Only submitted timesheets can be reviewed');
            }
            if ((int) $sheet->userId === $ctx->userId() && $decision === 'approved') {
                throw TrpcException::badRequest('You cannot approve your own timesheet');
            }

            DB::table('timesheets')->where('id', (int) $sheet->id)->update([
                'status' => $decision,
                'approvedAt' => $decision === 'approved' ? Dates::nowMillis() : null,
                'approvedBy' => $decision === 'approved' ? $ctx->userId() : null,
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => "timesheet.$decision", 'resourceType' => 'timesheet', 'resourceId' => (int) $sheet->id,
                'sensitivity' => 'hr', 'result' => 'success',
            ]);

            return ['success' => true];
        });

        $registry->mutation('operations.generateTimesheet', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $periodStart = Validate::int($input['periodStart'] ?? null, 'periodStart');
            $periodEnd = Validate::int($input['periodEnd'] ?? null, 'periodEnd');

            AgePolicy::assertDateRange($periodStart, $periodEnd, 'Timesheet period', 'periodEnd');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'shift.read');

            $events = DB::table('clockEvents')
                ->where('entityId', $entityId)->where('userId', $ctx->userId())
                ->where('occurredAt', '>=', $periodStart)->where('occurredAt', '<=', $periodEnd)
                ->orderBy('occurredAt')
                ->get()->all();

            // A clock-in with no matching clock-out is left at zero minutes and
            // flagged, never guessed at, because a guessed hour is a paid hour.
            $entries = [];
            foreach ($events as $clockIn) {
                if ($clockIn->eventType !== 'clock_in') {
                    continue;
                }

                $clockOut = null;
                foreach ($events as $candidate) {
                    if ($candidate->eventType === 'clock_out'
                        && (int) $candidate->occurredAt > (int) $clockIn->occurredAt
                        && $candidate->shiftId === $clockIn->shiftId
                    ) {
                        $clockOut = $candidate;
                        break;
                    }
                }

                $offSite = $clockIn->locationState === 'off_site' || ($clockOut !== null && $clockOut->locationState === 'off_site');

                $entries[] = [
                    'shiftId' => $clockIn->shiftId === null ? null : (int) $clockIn->shiftId,
                    'clockInEventId' => (int) $clockIn->id,
                    'clockOutEventId' => $clockOut === null ? null : (int) $clockOut->id,
                    'minutes' => $clockOut === null
                        ? 0
                        : max(0, (int) round(((int) $clockOut->occurredAt - (int) $clockIn->occurredAt) / 60000)),
                    'exceptionType' => $clockOut === null ? 'missing_clock' : ($offSite ? 'off_site' : 'none'),
                ];
            }

            $totalMinutes = array_sum(array_column($entries, 'minutes'));

            $sheetId = DB::transaction(static function () use ($entityId, $periodStart, $periodEnd, $totalMinutes, $entries, $ctx): int {
                DB::table('timesheets')->upsert([[
                    'entityId' => $entityId,
                    'userId' => $ctx->userId(),
                    'periodStart' => $periodStart,
                    'periodEnd' => $periodEnd,
                    'totalMinutes' => $totalMinutes,
                    'status' => 'draft',
                ]], ['entityId', 'userId', 'periodStart', 'periodEnd'], ['totalMinutes', 'status']);

                $sheet = DB::table('timesheets')
                    ->where('entityId', $entityId)->where('userId', $ctx->userId())
                    ->where('periodStart', $periodStart)->where('periodEnd', $periodEnd)
                    ->first('id');

                if ($sheet === null) {
                    throw TrpcException::badRequest('Timesheet could not be created');
                }

                $sheetId = (int) $sheet->id;
                DB::table('timesheetEntries')->where('timesheetId', $sheetId)->delete();

                if ($entries !== []) {
                    DB::table('timesheetEntries')->insert(array_map(
                        static fn (array $entry) => $entry + ['timesheetId' => $sheetId],
                        $entries,
                    ));
                }

                return $sheetId;
            });

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'timesheet.generate', 'resourceType' => 'timesheet', 'resourceId' => $sheetId,
                'result' => 'success',
                'metadata' => [
                    'totalMinutes' => $totalMinutes,
                    'exceptions' => count(array_filter($entries, static fn (array $entry) => $entry['exceptionType'] !== 'none')),
                ],
            ]);

            return ['id' => $sheetId, 'totalMinutes' => $totalMinutes, 'entries' => count($entries)];
        });

        $registry->query('operations.payrollExport', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'shift.write');

            $rows = DB::table('timesheets')
                ->where('entityId', $entityId)->whereIn('status', ['approved', 'exported'])->get()->all();

            $lines = ['timesheet_id,user_id,period_start,period_end,total_minutes,total_hours,status'];
            foreach ($rows as $row) {
                $lines[] = implode(',', [
                    (int) $row->id,
                    (int) $row->userId,
                    self::isoMillis((int) $row->periodStart),
                    self::isoMillis((int) $row->periodEnd),
                    (int) $row->totalMinutes,
                    number_format((int) $row->totalMinutes / 60, 2, '.', ''),
                    $row->status,
                ]);
            }

            if ($rows !== []) {
                DB::table('timesheets')->whereIn('id', array_map(static fn ($row) => (int) $row->id, $rows))
                    ->update(['status' => 'exported', 'exportReference' => 'PAY-' . Dates::nowMillis()]);
            }

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'payroll.export', 'resourceType' => 'timesheet',
                'sensitivity' => 'hr', 'result' => 'success', 'metadata' => ['records' => count($rows)],
            ]);

            return [
                'fileName' => "payroll-$entityId-" . gmdate('Y-m-d') . '.csv',
                'csv' => implode("\n", $lines),
            ];
        });
    }

    // -------------------------------------------------------------- shared

    /**
     * Overlaps, short rest and a missing qualification. These are warnings a
     * manager sees and can still act on; the hard working-time blocks come
     * from the policy check in {@see self::schedulabilityWarnings()}.
     *
     * @param array{id?: int|null, startsAt: int, endsAt: int, requiredRole?: string|null} $candidate
     * @return array<int, string>
     */
    private static function assignmentWarnings(int $entityId, int $userId, array $candidate): array
    {
        $warnings = [];
        $assigned = DB::table('shifts')->where('entityId', $entityId)->where('assignedUserId', $userId)->get();

        foreach ($assigned as $other) {
            if ((int) $other->id === ($candidate['id'] ?? null) || $other->status === 'cancelled') {
                continue;
            }

            $otherStart = (int) $other->startsAt;
            $otherEnd = (int) $other->endsAt;

            if ($candidate['startsAt'] < $otherEnd && $candidate['endsAt'] > $otherStart) {
                $warnings[] = "Overlaps shift #{$other->id}";

                continue;
            }

            $restBefore = $candidate['startsAt'] >= $otherEnd ? $candidate['startsAt'] - $otherEnd : PHP_INT_MAX;
            $restAfter = $otherStart >= $candidate['endsAt'] ? $otherStart - $candidate['endsAt'] : PHP_INT_MAX;

            if (min($restBefore, $restAfter) < 11 * self::HOUR_MS) {
                $warnings[] = "Less than 11 hours rest around shift #{$other->id}";
            }
        }

        $requiredRole = $candidate['requiredRole'] ?? null;
        if ($requiredRole !== null && trim($requiredRole) !== '') {
            $profile = DB::table('staffProfiles')->where('entityId', $entityId)->where('userId', $userId)->first('id');
            $checks = $profile === null
                ? []
                : DB::table('workforceChecks')->where('staffProfileId', (int) $profile->id)->get()->all();

            $term = mb_strtolower($requiredRole);
            $qualified = false;
            foreach ($checks as $check) {
                $haystack = mb_strtolower(trim($check->title . ' ' . ($check->level ?? '')));
                if (in_array($check->checkType, ['qualification', 'training'], true)
                    && $check->status === 'valid'
                    && str_contains($haystack, $term)
                ) {
                    $qualified = true;
                    break;
                }
            }

            if (!$qualified) {
                $warnings[] = "No valid qualification or training record matched \u{201C}$requiredRole\u{201D}";
            }
        }

        return $warnings;
    }

    /**
     * Everything that decides whether this person may take this shift:
     * membership, property scope, the assignment warnings, and the entity's
     * working-time policy.
     *
     * @param array{id?: int|null, startsAt: int, endsAt: int, requiredRole?: string|null} $candidate
     * @return array<int, string>
     */
    private static function schedulabilityWarnings(int $entityId, int $propertyId, int $userId, array $candidate): array
    {
        $now = Dates::nowMillis();

        $membership = DB::table('entityMemberships')
            ->where('entityId', $entityId)->where('userId', $userId)->where('status', 'active')
            ->where(fn ($q) => $q->whereNull('startsAt')->orWhere('startsAt', '<=', $now))
            ->where(fn ($q) => $q->whereNull('endsAt')->orWhere('endsAt', '>', $now))
            ->first();

        if ($membership === null || $membership->operationalRole !== 'support_worker') {
            throw TrpcException::badRequest('Choose an active Key Worker belonging to this entity.');
        }

        if (!$membership->allProperties) {
            $grant = DB::table('propertyAssignments')
                ->where('entityId', $entityId)->where('propertyId', $propertyId)->where('userId', $userId)
                ->where('assignmentType', 'worker')
                ->where(fn ($q) => $q->whereNull('startsAt')->orWhere('startsAt', '<=', $now))
                ->where(fn ($q) => $q->whereNull('endsAt')->orWhere('endsAt', '>', $now))
                ->first('id');

            if ($grant === null) {
                throw TrpcException::badRequest('This Key Worker is not assigned to the selected property. Choose an authorised worker or update their property assignment first.');
            }
        }

        $warnings = self::assignmentWarnings($entityId, $userId, $candidate);

        $policy = DB::table('workingTimePolicies')
            ->where('entityId', $entityId)->where('status', 'active')
            ->orderByDesc('effectiveFrom')->first();

        if ($policy !== null) {
            $all = [];
            foreach (DB::table('shifts')->where('entityId', $entityId)->where('assignedUserId', $userId)->get() as $item) {
                if ($item->assignedUserId === null || $item->status === 'cancelled') {
                    continue;
                }

                $all[] = [
                    'id' => (int) $item->id,
                    'userId' => (int) $item->assignedUserId,
                    'startsAt' => (int) $item->startsAt,
                    'endsAt' => (int) $item->endsAt,
                ];
            }

            $profile = DB::table('staffProfiles')->where('entityId', $entityId)->where('userId', $userId)->first('id');
            $availability = [];
            if ($profile !== null) {
                $rows = DB::table('staffAvailability')
                    ->where('staffProfileId', (int) $profile->id)->whereIn('status', ['active', 'approved'])->get();

                foreach ($rows as $item) {
                    $availability[] = [
                        'userId' => $userId,
                        'startsAt' => (int) $item->startsAt,
                        'endsAt' => (int) $item->endsAt,
                        'availabilityType' => $item->availabilityType,
                        'status' => $item->status,
                    ];
                }
            }

            $issues = RotaRules::evaluateWorkingTime(
                [
                    'id' => $candidate['id'] ?? -1,
                    'userId' => $userId,
                    'startsAt' => $candidate['startsAt'],
                    'endsAt' => $candidate['endsAt'],
                ],
                $all,
                $availability,
                [
                    'minimumRestHours' => (float) $policy->minimumRestHours,
                    'maximumShiftHours' => (float) $policy->maximumShiftHours,
                    'maximumWeeklyHours' => (float) $policy->maximumWeeklyHours,
                    'maximumNightHours' => (float) $policy->maximumNightHours,
                    'breakAfterHours' => (float) $policy->breakAfterHours,
                ],
            );

            foreach ($issues as $issue) {
                $warnings[] = ($issue['severity'] === 'block' ? 'Block' : 'Warning') . ": {$issue['detail']}";
            }
        }

        return array_values(array_unique($warnings));
    }

    /** A warning that stops the assignment rather than merely noting it. */
    private static function isBlocked(array $warnings): bool
    {
        foreach ($warnings as $warning) {
            if (str_starts_with($warning, 'Overlaps shift #') || str_starts_with($warning, 'Block:')) {
                return true;
            }
        }

        return false;
    }

    /**
     * Recalculates the coverage state of every live shift at a property after
     * the rota moves, so the calendar colours match what was just saved.
     */
    private static function refreshPropertyCoverage(int $propertyId): void
    {
        $property = DB::table('properties')->where('id', $propertyId)->first(['id', 'minimumStaffing']);
        if ($property === null) {
            return;
        }

        $active = [];
        foreach (DB::table('shifts')->where('propertyId', $propertyId)->get() as $row) {
            if ($row->status !== 'cancelled') {
                $active[] = $row;
            }
        }

        foreach ($active as $item) {
            if ($item->assignedUserId === null) {
                DB::table('shifts')->where('id', (int) $item->id)->update(['coverageState' => 'uncovered']);

                continue;
            }

            $concurrent = 0;
            foreach ($active as $other) {
                if ($other->assignedUserId !== null
                    && (int) $item->startsAt < (int) $other->endsAt
                    && (int) $item->endsAt > (int) $other->startsAt
                ) {
                    $concurrent++;
                }
            }

            $warnings = self::assignmentWarnings((int) $item->entityId, (int) $item->assignedUserId, [
                'id' => (int) $item->id,
                'startsAt' => (int) $item->startsAt,
                'endsAt' => (int) $item->endsAt,
                'requiredRole' => $item->requiredRole,
            ]);

            $atRisk = $concurrent < (int) $property->minimumStaffing || $warnings !== [];
            DB::table('shifts')->where('id', (int) $item->id)
                ->update(['coverageState' => $atRisk ? 'at_risk' : 'covered']);
        }
    }

    /**
     * Active Key Workers who may be rostered at one property, either because
     * they cover every property or because they hold a live worker assignment.
     *
     * @return array<int, array<string, mixed>>
     */
    private static function eligibleWorkers(int $entityId, int $propertyId, bool $requireLiveGrant): array
    {
        $now = Dates::nowMillis();

        $workers = DB::table('entityMemberships as m')
            ->join('users as u', 'u.id', '=', 'm.userId')
            ->where('m.entityId', $entityId)
            ->where('m.operationalRole', 'support_worker')
            ->where('m.status', 'active')
            ->where('u.accountStatus', 'active')
            ->where(fn ($q) => $q->whereNull('m.startsAt')->orWhere('m.startsAt', '<=', $now))
            ->where(fn ($q) => $q->whereNull('m.endsAt')->orWhere('m.endsAt', '>', $now))
            ->get(['m.userId', 'u.name', 'u.email', 'm.allProperties']);

        $grantQuery = DB::table('propertyAssignments')
            ->where('entityId', $entityId)->where('propertyId', $propertyId)->where('assignmentType', 'worker');

        if ($requireLiveGrant) {
            $grantQuery
                ->where(fn ($q) => $q->whereNull('startsAt')->orWhere('startsAt', '<=', $now))
                ->where(fn ($q) => $q->whereNull('endsAt')->orWhere('endsAt', '>', $now));
        }

        $granted = [];
        foreach ($grantQuery->get(['userId']) as $grant) {
            $granted[(int) $grant->userId] = true;
        }

        $eligible = [];
        foreach ($workers as $worker) {
            if (!$worker->allProperties && !isset($granted[(int) $worker->userId])) {
                continue;
            }

            $eligible[] = [
                'userId' => (int) $worker->userId,
                'name' => $worker->name,
                'email' => $worker->email,
                'allProperties' => (bool) $worker->allProperties,
            ];
        }

        return $eligible;
    }

    /**
     * Raises the in-app nudges a worker sees while their shift is running: read
     * the previous handover, and clock in or out. Both are upserted on a dedupe
     * key so a repeated page load does not repeat the notification.
     *
     * @param array<int, int> $propertyIds
     * @param array<int, array<string, mixed>> $shifts
     */
    private static function raiseShiftReminders(int $userId, int $entityId, array $propertyIds, array $shifts): void
    {
        $now = Dates::nowMillis();
        $active = array_values(array_filter($shifts, static fn (array $shift) => $shift['assignedUserId'] === $userId
            && $shift['status'] !== 'cancelled'
            && $shift['startsAt'] <= $now
            && $shift['endsAt'] >= $now));

        $handovers = DB::table('handovers')
            ->where('entityId', $entityId)->whereIn('propertyId', $propertyIds)
            ->get(['id', 'entityId', 'propertyId', 'shiftId', 'createdBy', 'createdAt'])
            ->map(static fn ($row) => [
                'id' => (int) $row->id,
                'entityId' => (int) $row->entityId,
                'propertyId' => (int) $row->propertyId,
                'shiftId' => $row->shiftId === null ? null : (int) $row->shiftId,
                'createdBy' => (int) $row->createdBy,
                'createdAt' => (Dates::fromDatabase($row->createdAt)?->getTimestamp() ?? 0) * 1000,
            ])->all();

        $acknowledgements = DB::table('handoverAcknowledgements')->where('userId', $userId)
            ->get(['handoverId', 'shiftId', 'userId'])
            ->map(static fn ($row) => [
                'handoverId' => (int) $row->handoverId,
                'shiftId' => (int) $row->shiftId,
                'userId' => (int) $row->userId,
            ])->all();

        $reminders = ShiftReminders::pendingHandovers($now, $userId, $active, $handovers, $acknowledgements);

        $existingKeys = [];
        if ($reminders !== []) {
            $keys = array_map(static fn (array $reminder) => $reminder['dedupeKey'], $reminders);
            foreach (DB::table('notifications')->where('userId', $userId)->whereIn('dedupeKey', $keys)->get(['dedupeKey']) as $row) {
                $existingKeys[$row->dedupeKey] = true;
            }
        }

        foreach ($reminders as $reminder) {
            $dueAt = null;
            foreach ($active as $shift) {
                if ($shift['id'] === $reminder['shiftId']) {
                    $dueAt = $shift['startsAt'];
                    break;
                }
            }

            DB::table('notifications')->insertOrIgnore([[
                'entityId' => $reminder['entityId'],
                'userId' => $reminder['recipientUserId'],
                'type' => 'handover_acknowledgement',
                'title' => 'Incoming handover acknowledgement',
                'message' => 'Read and acknowledge the previous-shift handover before continuing this shift.',
                'severity' => 'warning',
                'resourceType' => 'handover',
                'resourceId' => $reminder['handoverId'],
                'deepLink' => '/keyworker-app',
                'dueAt' => $dueAt,
                'acknowledgementRequired' => 1,
                'escalationDueAt' => Dates::nowMillis() + 900000,
                'dedupeKey' => $reminder['dedupeKey'],
            ]]);

            if (!isset($existingKeys[$reminder['dedupeKey']])) {
                Audit::write([
                    'actorType' => 'system',
                    'entityId' => $reminder['entityId'],
                    'propertyId' => $reminder['propertyId'],
                    'action' => 'handover.shift_start_reminder',
                    'resourceType' => 'handover',
                    'resourceId' => $reminder['handoverId'],
                    'sensitivity' => 'general',
                    'result' => 'success',
                    'metadata' => ['shiftId' => $reminder['shiftId'], 'recipientUserId' => $reminder['recipientUserId']],
                ]);
            }
        }

        $clockEvents = DB::table('clockEvents')
            ->where('entityId', $entityId)->where('userId', $userId)
            ->get(['shiftId', 'eventType'])
            ->map(static fn ($row) => [
                'shiftId' => $row->shiftId === null ? null : (int) $row->shiftId,
                'eventType' => $row->eventType,
            ])->all();

        foreach (ShiftReminders::dueAttendance($now, $userId, $shifts, $clockEvents) as $reminder) {
            DB::table('notifications')->upsert([[
                'entityId' => $reminder['entityId'],
                'userId' => $reminder['recipientUserId'],
                'type' => 'shift_attendance',
                'title' => $reminder['title'],
                'message' => $reminder['message'],
                'severity' => 'warning',
                'resourceType' => 'shift',
                'resourceId' => $reminder['shiftId'],
                'deepLink' => '/keyworker-app',
                'dueAt' => $reminder['dueAt'],
                'acknowledgementRequired' => 1,
                'resolvedAt' => null,
                'readAt' => null,
                'dedupeKey' => $reminder['dedupeKey'],
            ]], ['userId', 'dedupeKey'], ['resolvedAt', 'readAt']);
        }
    }

    /**
     * Only the worker on the shift, only for their own property, only a
     * handover somebody else wrote before the shift began. Mirrors
     * server/services/handoverAcknowledgementRules.ts.
     */
    private static function assertHandoverCanBeAcknowledged(object $shift, object $handover, int $userId): void
    {
        $message = match (true) {
            (int) $shift->assignedUserId !== $userId => 'Only the worker assigned to this shift can acknowledge its handover notes.',
            (int) $handover->propertyId !== (int) $shift->propertyId => 'Only a handover for your current property can be acknowledged.',
            (int) $handover->createdBy === $userId || (int) $handover->shiftId === (int) $shift->id => 'You cannot acknowledge a handover from your own current shift.',
            (Dates::fromDatabase($handover->createdAt)?->getTimestamp() ?? 0) * 1000 > (int) $shift->startsAt => 'Only a previous shift handover can be acknowledged.',
            default => null,
        };

        if ($message !== null) {
            throw TrpcException::forbidden($message);
        }
    }

    /** The operational role this user holds inside one company. */
    private static function roleFor(int $userId, int $entityId): ?string
    {
        $access = Authz::userAccess($userId);
        if ($access['user']['operationalRole'] === 'owner') {
            return 'owner';
        }

        foreach ($access['memberships'] as $membership) {
            if ($membership['entityId'] === $entityId) {
                return (string) $membership['operationalRole'];
            }
        }

        return null;
    }

    /**
     * @return array<string, mixed>
     */
    private static function contact(object $row, string $relationship): array
    {
        return [
            'id' => (int) $row->id,
            'name' => ($row->name ?? '') !== '' ? $row->name : 'Authorised colleague',
            'relationship' => $relationship,
            'jobTitle' => $row->jobTitle ?? null,
            'email' => $row->email ?? null,
            'phone' => $row->phone ?? $row->profilePhone ?? null,
        ];
    }

    /** A shift row with its numeric columns and timestamps in the client's shapes. */
    private static function shiftRow(object $row): array
    {
        return self::timestamps(RotaCoverage::normaliseShift($row));
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private static function timestamps(array $row): array
    {
        foreach (['createdAt', 'updatedAt'] as $field) {
            if (array_key_exists($field, $row)) {
                $row[$field] = Dates::fromDatabase($row[$field]);
            }
        }

        return $row;
    }

    /** The ISO form Date#toISOString produces, for the payroll CSV. */
    private static function isoMillis(int $millis): string
    {
        return gmdate('Y-m-d\TH:i:s', intdiv($millis, 1000)) . '.' . str_pad((string) ($millis % 1000), 3, '0', STR_PAD_LEFT) . 'Z';
    }
}
