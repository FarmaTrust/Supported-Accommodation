<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Coverage alerting across a span of operating days, mirroring
 * server/services/rotaCoverageMonitoring.ts and rotaCoverageAlerts.ts.
 *
 * An alert stays open until the exact uncovered interval it names is gone,
 * which is why the dedupe key carries the interval and the shortfall. Filling
 * part of a gap produces a different key, so the manager sees the remaining
 * hole rather than a stale alert they have already read past. The message
 * carries rota timings only — never anything about the people living there.
 */
final class RotaCoverage
{
    /**
     * @param array{propertyId: int, startsAt: int, endsAt: int, deficit: int} $gap
     */
    public static function alertDedupeKey(int $entityId, array $gap, int $userId): string
    {
        return "rota-coverage:$entityId:{$gap['propertyId']}:{$gap['startsAt']}:{$gap['endsAt']}:{$gap['deficit']}:$userId";
    }

    /**
     * @param array<int, array<string, mixed>> $gaps
     * @param array<int, int> $recipientUserIds
     * @return array<int, array<string, mixed>>
     */
    public static function alerts(int $entityId, array $gaps, array $recipientUserIds): array
    {
        $alerts = [];
        foreach ($gaps as $gap) {
            foreach ($recipientUserIds as $userId) {
                $alerts[] = [
                    'userId' => $userId,
                    'dedupeKey' => self::alertDedupeKey($entityId, $gap, $userId),
                    'title' => "Coverage gap: {$gap['propertyName']}",
                    'message' => sprintf(
                        '%d Key Worker cover is missing from %s to %s. Open the rota to assign safe cover.',
                        $gap['deficit'],
                        gmdate('H:i', intdiv($gap['startsAt'], 1000)),
                        gmdate('H:i', intdiv($gap['endsAt'], 1000)),
                    ),
                    'severity' => 'urgent',
                    'propertyId' => $gap['propertyId'],
                    'dueAt' => $gap['startsAt'],
                    'deepLink' => '/rota?day=' . gmdate('Y-m-d', intdiv($gap['startsAt'], 1000)) . "&property={$gap['propertyId']}",
                ];
            }
        }

        return $alerts;
    }

    /**
     * @param array{entityId: int, from: int, to: int, propertyIds?: array<int, int>, actorUserId?: int|null, actorType?: string|null} $input
     * @return array{evaluatedDays: int, gapCount: int, notificationsUpserted: int, notificationsResolved: int}
     */
    public static function evaluate(array $input): array
    {
        $entityId = $input['entityId'];
        $from = RotaOverview::operationalDayStart($input['from']);
        $to = RotaOverview::operationalDayStart($input['to']);

        if ($to <= $from) {
            throw new RuntimeException('Coverage evaluation end must be after the start of the selected operational day.');
        }
        if ($to - $from > 31 * RotaOverview::DAY_MS) {
            throw new RuntimeException('Coverage checks can review up to 31 operational days at once.');
        }

        $propertyQuery = DB::table('properties')
            ->where('entityId', $entityId)
            ->where('status', 'active');
        if (($input['propertyIds'] ?? []) !== []) {
            $propertyQuery->whereIn('id', $input['propertyIds']);
        }

        $properties = $propertyQuery->get(['id', 'name', 'minimumStaffing'])
            ->map(static fn ($row) => [
                'id' => (int) $row->id,
                'name' => (string) $row->name,
                'minimumStaffing' => (int) $row->minimumStaffing,
            ])->all();

        if ($properties === []) {
            return ['evaluatedDays' => 0, 'gapCount' => 0, 'notificationsUpserted' => 0, 'notificationsResolved' => 0];
        }

        $propertyIds = array_map(static fn (array $property) => $property['id'], $properties);
        $shifts = self::overviewShifts($entityId, $propertyIds, $from, $to);

        $gaps = [];
        for ($rotaDayStart = $from; $rotaDayStart < $to; $rotaDayStart += RotaOverview::DAY_MS) {
            foreach (RotaOverview::build($rotaDayStart, $shifts, $properties)['coverageGaps'] as $gap) {
                $gaps[] = $gap;
            }
        }

        $now = Dates::nowMillis();
        $managers = DB::table('entityMemberships as m')
            ->join('users as u', 'u.id', '=', 'm.userId')
            ->where('m.entityId', $entityId)
            ->where('m.status', 'active')
            ->whereIn('m.operationalRole', ['owner', 'registered_manager'])
            ->where('u.accountStatus', 'active')
            ->where(fn ($q) => $q->whereNull('m.startsAt')->orWhere('m.startsAt', '<=', $now))
            ->where(fn ($q) => $q->whereNull('m.endsAt')->orWhere('m.endsAt', '>', $now))
            ->get(['m.userId', 'm.allProperties'])->all();

        $managerIds = array_map(static fn ($manager) => (int) $manager->userId, $managers);
        $granted = [];
        if ($managerIds !== []) {
            $grants = DB::table('propertyAssignments')
                ->where('entityId', $entityId)
                ->whereIn('userId', $managerIds)
                ->whereIn('propertyId', $propertyIds)
                ->where('assignmentType', 'manager')
                ->where(fn ($q) => $q->whereNull('startsAt')->orWhere('startsAt', '<=', $now))
                ->where(fn ($q) => $q->whereNull('endsAt')->orWhere('endsAt', '>', $now))
                ->get(['userId', 'propertyId']);

            foreach ($grants as $grant) {
                $granted[(int) $grant->userId][(int) $grant->propertyId] = true;
            }
        }

        // A manager is alerted only about the properties they are responsible
        // for; a rota hole elsewhere is not theirs to fill.
        $alerts = [];
        foreach ($managers as $manager) {
            $managerId = (int) $manager->userId;
            $visible = array_values(array_filter(
                $gaps,
                static fn (array $gap) => (bool) $manager->allProperties || isset($granted[$managerId][$gap['propertyId']]),
            ));

            foreach (self::alerts($entityId, $visible, [$managerId]) as $alert) {
                $alerts[] = $alert;
            }
        }

        $activeKeys = [];
        foreach ($alerts as $alert) {
            $activeKeys[$alert['dedupeKey']] = true;

            $overdue = Dates::nowMillis() > $alert['dueAt'];
            DB::table('notifications')->upsert([[
                'entityId' => $entityId,
                'userId' => $alert['userId'],
                'type' => 'rota_coverage_gap',
                'title' => $alert['title'],
                'message' => $alert['message'],
                'severity' => $alert['severity'],
                'resourceType' => 'rota_coverage_gap',
                'resourceId' => $alert['propertyId'],
                'deepLink' => $alert['deepLink'],
                'dueAt' => $alert['dueAt'],
                'acknowledgementRequired' => 1,
                'escalationDueAt' => $alert['dueAt'] + 3600000,
                'escalationState' => $overdue ? 'escalated' : 'none',
                'escalationCount' => $overdue ? 1 : 0,
                'resolvedAt' => null,
                'dedupeKey' => $alert['dedupeKey'],
            ]], ['userId', 'dedupeKey'], [
                'title', 'message', 'severity', 'deepLink', 'dueAt',
                'escalationDueAt', 'escalationState', 'escalationCount', 'resolvedAt',
            ]);
        }

        $existing = DB::table('notifications')
            ->where('entityId', $entityId)
            ->where('type', 'rota_coverage_gap')
            ->where('dueAt', '>=', $from)
            ->where('dueAt', '<', $to)
            ->whereNull('resolvedAt')
            ->get(['id', 'dedupeKey']);

        $resolvedIds = [];
        foreach ($existing as $notification) {
            if ($notification->dedupeKey !== null && ! isset($activeKeys[$notification->dedupeKey])) {
                $resolvedIds[] = (int) $notification->id;
            }
        }

        if ($resolvedIds !== []) {
            DB::table('notifications')->whereIn('id', $resolvedIds)
                ->update(['resolvedAt' => Dates::nowMillis(), 'escalationState' => 'resolved']);
        }

        if (($input['actorUserId'] ?? null) !== null || ($input['actorType'] ?? null) !== null) {
            Audit::write([
                'actorUserId' => $input['actorUserId'] ?? null,
                'actorType' => $input['actorType'] ?? 'system',
                'entityId' => $entityId,
                'action' => 'rota.coverage_evaluate',
                'resourceType' => 'rota_coverage',
                'result' => 'success',
                'metadata' => [
                    'from' => $from,
                    'to' => $to,
                    'propertyCount' => count($properties),
                    'gapCount' => count($gaps),
                    'notificationsUpserted' => count($alerts),
                    'notificationsResolved' => count($resolvedIds),
                ],
            ]);
        }

        return [
            'evaluatedDays' => (int) round(($to - $from) / RotaOverview::DAY_MS),
            'gapCount' => count($gaps),
            'notificationsUpserted' => count($alerts),
            'notificationsResolved' => count($resolvedIds),
        ];
    }

    /**
     * Shift rows with the property and worker names the overview needs.
     *
     * @param array<int, int> $propertyIds
     * @return array<int, array<string, mixed>>
     */
    public static function overviewShifts(int $entityId, array $propertyIds, int $from, int $to): array
    {
        if ($propertyIds === []) {
            return [];
        }

        return DB::table('shifts as s')
            ->join('properties as p', 'p.id', '=', 's.propertyId')
            ->leftJoin('users as u', 'u.id', '=', 's.assignedUserId')
            ->where('s.entityId', $entityId)
            ->whereIn('s.propertyId', $propertyIds)
            ->where('s.startsAt', '<', $to)
            ->where('s.endsAt', '>', $from)
            ->orderBy('s.startsAt')
            ->get(['s.*', 'p.name as propertyName', 'u.name as workerName'])
            ->map(static fn ($row) => self::normaliseShift($row))->all();
    }

    /**
     * Timestamps arrive from MariaDB as strings; the rota compares them as
     * numbers, so the cast happens once here rather than at each comparison.
     *
     * @return array<string, mixed>
     */
    public static function normaliseShift(object $row): array
    {
        $shift = (array) $row;
        foreach (['id', 'entityId', 'propertyId', 'startsAt', 'endsAt', 'coverageGapSlot', 'assignedUserId', 'createdBy'] as $field) {
            if (array_key_exists($field, $shift) && $shift[$field] !== null) {
                $shift[$field] = (int) $shift[$field];
            }
        }

        return $shift;
    }
}
