<?php

declare(strict_types=1);

namespace App\Support;

/**
 * One operating day of the rota, mirroring server/services/rotaOverview.ts.
 *
 * A rota day runs 06:00 to 06:00 so a night shift belongs to the day it began
 * on. The part that matters is the coverage gap: not a count of open shift
 * rows, but the actual intervals in which fewer people are rostered than the
 * property's minimum staffing. A property can have no open shifts at all and
 * still be uncovered from 02:00 to 06:00.
 */
final class RotaOverview
{
    public const DAY_MS = 86400000;

    public const START_HOUR = 6;

    /** The 06:00 boundary of the operating day that contains $value. */
    public static function operationalDayStart(int $value): int
    {
        $offset = self::START_HOUR * 3600000;

        return (int) floor(($value - $offset) / self::DAY_MS) * self::DAY_MS + $offset;
    }

    /**
     * @param array{startsAt: int, endsAt: int} $shift
     */
    public static function isWithinDay(array $shift, int $rotaDayStart): bool
    {
        return $shift['startsAt'] < $rotaDayStart + self::DAY_MS && $shift['endsAt'] > $rotaDayStart;
    }

    /**
     * Uncovered intervals for one property in one operating day.
     *
     * Every shift edge inside the day becomes a boundary, and each resulting
     * interval is measured against minimum staffing. Adjacent intervals with
     * the same shortfall are merged so a manager sees "02:00–06:00, one short"
     * rather than four separate alerts for the same hole.
     *
     * @param array<int, array<string, mixed>> $shifts
     * @param array{id: int, name: string, minimumStaffing: int} $property
     * @return array<int, array<string, mixed>>
     */
    public static function coverageGaps(int $rotaDayStart, array $property, array $shifts): array
    {
        $rotaDayEnd = $rotaDayStart + self::DAY_MS;
        $propertyShifts = array_values(array_filter($shifts, static fn (array $shift) => $shift['propertyId'] === $property['id']
            && $shift['status'] !== 'cancelled'
            && self::isWithinDay($shift, $rotaDayStart)));

        $boundaries = [$rotaDayStart, $rotaDayEnd];
        foreach ($propertyShifts as $shift) {
            $boundaries[] = max($rotaDayStart, $shift['startsAt']);
            $boundaries[] = min($rotaDayEnd, $shift['endsAt']);
        }
        $boundaries = array_values(array_unique($boundaries));
        sort($boundaries);

        $raw = [];
        for ($index = 0; $index < count($boundaries) - 1; $index++) {
            $startsAt = $boundaries[$index];
            $endsAt = $boundaries[$index + 1];
            if ($endsAt <= $startsAt) {
                continue;
            }

            $active = array_values(array_filter(
                $propertyShifts,
                static fn (array $shift) => $shift['startsAt'] < $endsAt && $shift['endsAt'] > $startsAt,
            ));
            $workers = [];
            foreach ($active as $shift) {
                if ($shift['assignedUserId'] !== null) {
                    $workers[$shift['assignedUserId']] = true;
                }
            }

            $allocated = count($workers);
            $deficit = max(0, $property['minimumStaffing'] - $allocated);
            if ($deficit === 0) {
                continue;
            }

            $activeIds = array_map(static fn (array $shift) => $shift['id'], $active);
            $last = $raw === [] ? null : array_key_last($raw);

            if ($last !== null && $raw[$last]['endsAt'] === $startsAt
                && $raw[$last]['allocatedStaffing'] === $allocated
                && $raw[$last]['deficit'] === $deficit
            ) {
                $raw[$last]['endsAt'] = $endsAt;
                $raw[$last]['relatedShiftIds'] = array_values(array_unique(
                    array_merge($raw[$last]['relatedShiftIds'], $activeIds),
                ));

                continue;
            }

            $raw[] = [
                'propertyId' => $property['id'],
                'propertyName' => $property['name'],
                'startsAt' => $startsAt,
                'endsAt' => $endsAt,
                'requiredStaffing' => $property['minimumStaffing'],
                'allocatedStaffing' => $allocated,
                'deficit' => $deficit,
                'relatedShiftIds' => $activeIds,
            ];
        }

        return array_map(static function (array $gap): array {
            $gap['key'] = "{$gap['propertyId']}:{$gap['startsAt']}:{$gap['endsAt']}:{$gap['deficit']}";

            return $gap;
        }, $raw);
    }

    /**
     * @param array<int, array<string, mixed>> $shifts full shift rows with propertyName and workerName attached
     * @param array<int, array{id: int, name: string, minimumStaffing: int}>|null $properties
     * @return array<string, mixed>
     */
    public static function build(int $rotaDayStart, array $shifts, ?array $properties = null): array
    {
        $shifts = array_values(array_filter(
            $shifts,
            static fn (array $shift) => $shift['status'] !== 'cancelled' && self::isWithinDay($shift, $rotaDayStart),
        ));
        usort($shifts, static fn (array $left, array $right) => $left['startsAt'] <=> $right['startsAt']
            ?: strcmp((string) $left['propertyName'], (string) $right['propertyName']));

        $invalidWindows = array_values(array_map(
            static fn (array $shift) => $shift['id'],
            array_filter($shifts, static fn (array $shift) => $shift['endsAt'] <= $shift['startsAt']),
        ));

        // A worker rostered in two places at once is a data fault, not a
        // staffing one, so it surfaces as an integrity flag rather than a gap.
        $byWorker = [];
        foreach ($shifts as $shift) {
            if ($shift['assignedUserId'] !== null) {
                $byWorker[$shift['assignedUserId']][] = $shift;
            }
        }

        $overlapping = [];
        foreach ($byWorker as $workerShifts) {
            $count = count($workerShifts);
            for ($index = 0; $index < $count; $index++) {
                for ($comparison = $index + 1; $comparison < $count; $comparison++) {
                    $left = $workerShifts[$index];
                    $right = $workerShifts[$comparison];
                    if ($left['startsAt'] < $right['endsAt'] && $right['startsAt'] < $left['endsAt']) {
                        $overlapping[$left['id']] = true;
                        $overlapping[$right['id']] = true;
                    }
                }
            }
        }

        if ($properties === null) {
            $derived = [];
            foreach ($shifts as $shift) {
                $derived[$shift['propertyId']] ??= [
                    'id' => $shift['propertyId'],
                    'name' => $shift['propertyName'],
                    'minimumStaffing' => 1,
                ];
            }
            $properties = array_values($derived);
        }

        $colleagues = [];
        foreach ($shifts as $shift) {
            if ($shift['assignedUserId'] !== null) {
                $colleagues[$shift['assignedUserId']] ??= [
                    'id' => $shift['assignedUserId'],
                    'name' => $shift['workerName'] ?? "Key Worker {$shift['assignedUserId']}",
                ];
            }
        }

        $coverageGaps = [];
        foreach ($properties as $property) {
            foreach (self::coverageGaps($rotaDayStart, $property, $shifts) as $gap) {
                $coverageGaps[] = $gap;
            }
        }

        $propertySummary = array_map(static function (array $property) use ($shifts, $coverageGaps): array {
            $propertyShifts = array_filter($shifts, static fn (array $shift) => $shift['propertyId'] === $property['id']);
            $gaps = array_filter($coverageGaps, static fn (array $gap) => $gap['propertyId'] === $property['id']);

            return $property + [
                'total' => count($propertyShifts),
                'covered' => count(array_filter($propertyShifts, static fn (array $shift) => $shift['assignedUserId'] !== null && $shift['coverageState'] === 'covered')),
                'atRisk' => count(array_filter($propertyShifts, static fn (array $shift) => $shift['coverageState'] === 'at_risk')),
                'uncovered' => count($gaps),
                'missingMinutes' => self::missingMinutes($gaps),
            ];
        }, $properties);

        return [
            'rotaDayStart' => $rotaDayStart,
            'rotaDayEnd' => $rotaDayStart + self::DAY_MS,
            'shifts' => $shifts,
            'properties' => array_values($properties),
            'colleagues' => array_values($colleagues),
            'coverage' => [
                'total' => count($shifts),
                'covered' => count(array_filter($shifts, static fn (array $shift) => $shift['assignedUserId'] !== null && $shift['coverageState'] === 'covered')),
                'atRisk' => count(array_filter($shifts, static fn (array $shift) => $shift['coverageState'] === 'at_risk')),
                'uncovered' => count($coverageGaps),
                'missingMinutes' => self::missingMinutes($coverageGaps),
            ],
            'coverageGaps' => $coverageGaps,
            'propertySummary' => array_values($propertySummary),
            'groups' => self::groups($shifts),
            'integrity' => [
                'state' => $invalidWindows !== [] || $overlapping !== [] ? 'needs_review' : 'checked',
                'invalidWindowShiftIds' => $invalidWindows,
                'overlappingShiftIds' => array_values(array_map('intval', array_keys($overlapping))),
            ],
        ];
    }

    /**
     * Who is on together, so a manager can see lone working at a glance.
     *
     * @param array<int, array<string, mixed>> $shifts
     * @return array<int, array<string, mixed>>
     */
    private static function groups(array $shifts): array
    {
        $assigned = array_values(array_filter($shifts, static fn (array $shift) => $shift['assignedUserId'] !== null));
        $groups = [];

        $exact = [];
        foreach ($assigned as $shift) {
            $exact["{$shift['propertyId']}:{$shift['startsAt']}:{$shift['endsAt']}"][] = $shift;
        }

        foreach ($exact as $group) {
            $workerIds = array_unique(array_map(static fn (array $shift) => $shift['assignedUserId'], $group));
            if (count($workerIds) < 2) {
                continue;
            }

            $groups[] = [
                'kind' => 'working_together',
                'propertyId' => $group[0]['propertyId'],
                'propertyName' => $group[0]['propertyName'],
                'startsAt' => $group[0]['startsAt'],
                'endsAt' => $group[0]['endsAt'],
                'workerNames' => array_values(array_unique(array_map(static fn (array $shift) => self::workerName($shift), $group))),
                'shiftIds' => array_map(static fn (array $shift) => $shift['id'], $group),
            ];
        }

        // A short overlap at either end is a handover window, worth showing
        // separately from a full shared shift.
        $count = count($assigned);
        for ($index = 0; $index < $count; $index++) {
            for ($comparison = $index + 1; $comparison < $count; $comparison++) {
                $left = $assigned[$index];
                $right = $assigned[$comparison];
                if ($left['propertyId'] !== $right['propertyId'] || $left['assignedUserId'] === $right['assignedUserId']) {
                    continue;
                }

                $overlapStart = max($left['startsAt'], $right['startsAt']);
                $overlapEnd = min($left['endsAt'], $right['endsAt']);
                $overlap = $overlapEnd - $overlapStart;
                if ($overlap <= 0 || $overlap > 2 * 3600000) {
                    continue;
                }
                if ($left['startsAt'] === $right['startsAt'] && $left['endsAt'] === $right['endsAt']) {
                    continue;
                }

                $groups[] = [
                    'kind' => 'close_overlap',
                    'propertyId' => $left['propertyId'],
                    'propertyName' => $left['propertyName'],
                    'startsAt' => $overlapStart,
                    'endsAt' => $overlapEnd,
                    'workerNames' => array_values(array_unique([self::workerName($left), self::workerName($right)])),
                    'shiftIds' => [$left['id'], $right['id']],
                ];
            }
        }

        usort($groups, static fn (array $left, array $right) => $left['startsAt'] <=> $right['startsAt']);

        return $groups;
    }

    /** @param array<string, mixed> $shift */
    private static function workerName(array $shift): string
    {
        return $shift['workerName'] ?? "Key Worker {$shift['assignedUserId']}";
    }

    /** @param iterable<array<string, mixed>> $gaps */
    private static function missingMinutes(iterable $gaps): int
    {
        $total = 0;
        foreach ($gaps as $gap) {
            $total += (int) round((($gap['endsAt'] - $gap['startsAt']) / 60000) * $gap['deficit']);
        }

        return $total;
    }
}
