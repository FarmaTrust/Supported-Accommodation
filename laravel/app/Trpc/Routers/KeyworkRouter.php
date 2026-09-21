<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Support\Authz;
use App\Support\Dates;
use App\Support\ReportCompletion;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * keywork.*, mirroring server/routers/keywork.ts.
 *
 * What a key worker does on shift: see the young people they are assigned to,
 * write the daily, weekly or monthly report, and raise an incident.
 *
 * Everything here is scoped by current shift rather than by standing grant. A
 * support worker also sees only their own assignments and, on the completion
 * board, only their own reports — the board exists so a manager can see the
 * spread of work, not so workers can compare each other.
 */
final class KeyworkRouter
{
    private const DAY_MS = 86400000;

    private const REPORT_TYPES = ['daily', 'weekly', 'monthly_review'];
    private const REPORT_STATUSES = ['draft', 'submitted'];

    private const INCIDENT_CATEGORIES = [
        'safeguarding', 'missing', 'exploitation', 'police', 'abuse_allegation',
        'child_protection_enquiry', 'restraint', 'health_safety', 'complaint', 'other',
    ];
    private const SEVERITIES = ['low', 'medium', 'high', 'critical'];

    /**
     * Categories that always go to a manager before anything else happens.
     * Everything here is either a notifiable event in its own right or the kind
     * of thing that turns into one.
     */
    private const NOTIFIABLE_CATEGORIES = [
        'exploitation', 'police', 'abuse_allegation', 'child_protection_enquiry', 'restraint',
    ];

    public static function register(Registry $registry): void
    {
        $registry->query('keywork.context', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyIds = Authz::currentShiftPropertyIds($ctx->userId(), $entityId, 'young_person.read');
            $role = self::roleIn($ctx, $entityId);

            $assignmentIds = $role === 'support_worker'
                ? self::liveAssignmentPlacementIds($ctx->userId(), $entityId)
                : [];

            // A support worker off shift, or with no live assignment, sees
            // nothing rather than an empty-looking whole company.
            if ($role === 'support_worker' && ($propertyIds === [] || $assignmentIds === [])) {
                return ['properties' => [], 'placements' => []];
            }

            $query = DB::table('placements as pl')
                ->join('youngPeople as yp', 'yp.id', '=', 'pl.youngPersonId')
                ->where('pl.entityId', $entityId);

            if ($propertyIds !== []) {
                $query->whereIn('pl.propertyId', $propertyIds);
            }
            if ($role === 'support_worker') {
                $query->whereIn('pl.id', $assignmentIds);
            }

            return [
                'properties' => $propertyIds === [] ? [] : DB::table('properties')->whereIn('id', $propertyIds)
                    ->get()->map(static fn ($r) => (array) $r)->all(),
                'placements' => $query->select([
                    'pl.id', 'pl.propertyId', 'yp.reference', 'yp.preferredName',
                    'pl.status', 'pl.updatedAt as placementUpdatedAt',
                ])->get()->map(static fn ($r) => (array) $r)->all(),
            ];
        });

        $registry->query('keywork.reports', Registry::USER, static function (Context $ctx, mixed $input): array {
            $placementId = Validate::id($input['placementId'] ?? null, 'placementId');
            Authz::assertCurrentShiftPlacementCapability($ctx->userId(), $placementId, 'young_person.read');

            return DB::table('keyWorkerReports')->where('placementId', $placementId)
                ->orderByDesc('reportDate')->get()->map(static fn ($r) => (array) $r)->all();
        });

        $registry->query('keywork.reportCompletion', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyIds = Authz::currentShiftPropertyIds($ctx->userId(), $entityId, 'young_person.read');

            $now = Dates::nowMillis();
            $from = Validate::optionalInt($input['from'] ?? null, 'from') ?? $now - 7 * self::DAY_MS;
            $to = Validate::optionalInt($input['to'] ?? null, 'to') ?? $now;

            if ($to < $from) {
                throw TrpcException::badRequest('Report completion end must be after the start of the selected period');
            }

            if ($propertyIds === []) {
                return ['from' => $from, 'to' => $to, 'properties' => []];
            }

            $role = self::roleIn($ctx, $entityId);

            $query = DB::table('keyWorkerReports as r')
                ->join('properties as p', 'p.id', '=', 'r.propertyId')
                ->join('users as u', 'u.id', '=', 'r.authorUserId')
                ->where('r.entityId', $entityId)
                ->whereIn('r.propertyId', $propertyIds)
                ->where('r.reportDate', '>=', $from)
                ->where('r.reportDate', '<=', $to);

            // A worker sees their own record on this board, not their
            // colleagues'.
            if ($role === 'support_worker') {
                $query->where('r.authorUserId', $ctx->userId());
            }

            $rows = [];
            foreach ($query->select([
                'r.id', 'r.propertyId', 'p.name as propertyName',
                'r.authorUserId', 'u.name as authorName', 'r.status', 'r.reportDate',
            ])->get() as $row) {
                $rows[] = [
                    'id' => (int) $row->id,
                    'propertyId' => (int) $row->propertyId,
                    'propertyName' => (string) $row->propertyName,
                    'authorUserId' => (int) $row->authorUserId,
                    'authorName' => $row->authorName,
                    'status' => (string) $row->status,
                    'reportDate' => (int) $row->reportDate,
                ];
            }

            $properties = ReportCompletion::summarise($rows);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'keywork.report_completion.read',
                'resourceType' => 'key_worker_report',
                'sensitivity' => 'general',
                'result' => 'success',
                'metadata' => [
                    'from' => $from, 'to' => $to,
                    'propertyCount' => count($properties),
                    'selfOnly' => $role === 'support_worker',
                ],
            ]);

            return ['from' => $from, 'to' => $to, 'properties' => $properties];
        });

        $registry->mutation('keywork.createReport', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            $placementId = Validate::id($input['placementId'] ?? null, 'placementId');

            $scope = Authz::assertCurrentShiftPlacementCapability($ctx->userId(), $placementId, 'young_person.write');
            $placement = $scope['placement'];

            // The report carries the property and company it was written for, so
            // both have to be the placement's own.
            if ((int) ($placement['propertyId'] ?? 0) !== $propertyId || (int) $placement['entityId'] !== $entityId) {
                throw TrpcException::forbidden('Placement scope does not match selected property');
            }

            $reportType = Validate::enum($input['reportType'] ?? null, self::REPORT_TYPES, 'reportType');
            $status = Validate::enum($input['status'] ?? 'draft', self::REPORT_STATUSES, 'status');

            $id = (int) DB::table('keyWorkerReports')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'placementId' => $placementId,
                'authorUserId' => $ctx->userId(),
                'reportType' => $reportType,
                'reportDate' => Validate::int($input['reportDate'] ?? null, 'reportDate'),
                'mood' => Validate::optionalString($input['mood'] ?? null, 'mood', 80),
                'attitude' => Validate::optionalString($input['attitude'] ?? null, 'attitude', 120),
                'learning' => Validate::optionalString($input['learning'] ?? null, 'learning', 8000),
                'enthusiasm' => Validate::optionalString($input['enthusiasm'] ?? null, 'enthusiasm', 120),
                'discussions' => Validate::optionalString($input['discussions'] ?? null, 'discussions', 8000),
                'pointsToNote' => Validate::optionalString($input['pointsToNote'] ?? null, 'pointsToNote', 8000),
                'plan' => Validate::optionalString($input['plan'] ?? null, 'plan', 8000),
                'nextReviewAt' => Validate::optionalInt($input['nextReviewAt'] ?? null, 'nextReviewAt'),
                'suggestions' => Validate::optionalString($input['suggestions'] ?? null, 'suggestions', 8000),
                'status' => $status,
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'action' => "keywork.$reportType.create",
                'resourceType' => 'key_worker_report',
                'resourceId' => $id,
                'sensitivity' => 'safeguarding',
                'result' => 'success',
                'metadata' => ['status' => $status],
            ]);

            return ['id' => $id];
        });

        $registry->query('keywork.incidents', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyIds = Authz::currentShiftPropertyIds($ctx->userId(), $entityId, 'incident.read');

            if ($propertyIds === []) {
                return [];
            }

            return DB::table('incidents')->whereIn('propertyId', $propertyIds)
                ->orderByDesc('occurredAt')->get()->map(static fn ($r) => (array) $r)->all();
        });

        $registry->mutation('keywork.createIncident', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            Authz::assertCurrentShiftPropertyCapability($ctx->userId(), $entityId, $propertyId, 'incident.write');

            $placementId = Validate::optionalId($input['placementId'] ?? null, 'placementId');
            if ($placementId !== null) {
                $scope = Authz::assertCurrentShiftPlacementCapability($ctx->userId(), $placementId, 'incident.write');
                $placement = $scope['placement'];
                if ((int) $placement['entityId'] !== $entityId || (int) ($placement['propertyId'] ?? 0) !== $propertyId) {
                    throw TrpcException::forbidden('Placement scope does not match the selected property');
                }
            }

            $category = Validate::enum($input['category'] ?? null, self::INCIDENT_CATEGORIES, 'category');
            $severity = Validate::enum($input['severity'] ?? null, self::SEVERITIES, 'severity');

            // Whether this has to be notified is decided here rather than left
            // to the person writing it up at the end of a shift.
            $requiresReview = in_array($category, self::NOTIFIABLE_CATEGORIES, true) || $severity === 'critical';

            $template = null;
            $templateId = Validate::optionalId($input['templateId'] ?? null, 'templateId');
            if ($templateId !== null) {
                $template = DB::table('documentTemplates')
                    ->where('id', $templateId)
                    ->where('entityId', $entityId)
                    ->where('category', 'incident_notification')
                    ->where('status', 'active')
                    ->first(['id', 'version']);
            }

            $now = Dates::nowMillis();

            $id = (int) DB::table('incidents')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'placementId' => $placementId,
                'category' => $category,
                'severity' => $severity,
                'occurredAt' => Validate::int($input['occurredAt'] ?? null, 'occurredAt'),
                'summary' => Validate::string($input['summary'] ?? null, 'summary', 5, 240),
                'details' => Validate::string($input['details'] ?? null, 'details', 20, 12000),
                'immediateActions' => Validate::optionalString($input['immediateActions'] ?? null, 'immediateActions', 8000),
                'createdBy' => $ctx->userId(),
                'notifiability' => $requiresReview ? 'unreviewed' : 'not_notifiable',
                // Due now, not in a few days: the point of the review is that it
                // shows up on the manager's list immediately.
                'notificationDueAt' => $requiresReview ? $now : null,
                'status' => $requiresReview ? 'under_review' : 'open',
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'action' => 'incident.create',
                'resourceType' => 'incident',
                'resourceId' => $id,
                'sensitivity' => 'safeguarding',
                'result' => 'success',
                'metadata' => [
                    'category' => $category,
                    'severity' => $severity,
                    'notificationReviewRequired' => $requiresReview,
                    'templateId' => $template === null ? null : (int) $template->id,
                    'templateVersion' => $template === null ? null : (int) $template->version,
                ],
            ]);

            return ['id' => $id, 'notificationReviewRequired' => $requiresReview];
        });
    }

    /**
     * The caller's operational role in this company.
     *
     * A platform owner answers as "owner" whatever their membership says, which
     * is how the Node side reads it.
     */
    private static function roleIn(Context $ctx, int $entityId): ?string
    {
        $access = Authz::userAccess($ctx->userId());

        if (($access['user']['operationalRole'] ?? null) === 'owner') {
            return 'owner';
        }

        foreach ($access['memberships'] as $membership) {
            if ($membership['entityId'] === $entityId) {
                return $membership['operationalRole'];
            }
        }

        return null;
    }

    /** @return array<int, int> */
    private static function liveAssignmentPlacementIds(int $userId, int $entityId): array
    {
        $now = Dates::nowMillis();

        return DB::table('workerAssignments')
            ->where('entityId', $entityId)
            ->where('userId', $userId)
            ->where(fn ($q) => $q->whereNull('startsAt')->orWhere('startsAt', '<=', $now))
            ->where(fn ($q) => $q->whereNull('endsAt')->orWhere('endsAt', '>', $now))
            ->pluck('placementId')->map(static fn ($id) => (int) $id)->all();
    }
}
