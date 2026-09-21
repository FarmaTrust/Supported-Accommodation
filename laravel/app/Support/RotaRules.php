<?php

declare(strict_types=1);

namespace App\Support;

use App\Trpc\TrpcException;
use DateTimeImmutable;
use DateTimeZone;

/**
 * Working-time and scheduling rules, mirroring
 * server/services/rotaPolicyRules.ts and server/services/rotaCalendarRules.ts.
 *
 * These decide whether a shift can be assigned to a particular person. A block
 * is a rule that exists for the worker's safety — rest between shifts, a
 * maximum day, a weekly ceiling, leave already booked. A warning is a matter of
 * judgement a manager can override with a reason on the record.
 */
final class RotaRules
{
    private const HOUR_MS = 3600000;
    private const DAY_MS = 86400000;
    private const MIN_OVERRIDE_REASON = 20;

    /** Availability that makes somebody unschedulable while it is in force. */
    private const BLOCKING_AVAILABILITY = [
        'unavailable', 'annual_leave', 'sickness', 'training', 'agency_constraint',
    ];

    /**
     * @param array{id: int, userId: int, startsAt: int, endsAt: int} $target
     * @param array<int, array{id: int, userId: int, startsAt: int, endsAt: int}> $all
     * @param array<int, array{userId: int, startsAt: int, endsAt: int, availabilityType: string, status: string}> $availability
     * @param array<string, float> $policy
     * @return array<int, array{exceptionType: string, severity: string, detail: string}>
     */
    public static function evaluateWorkingTime(array $target, array $all, array $availability, array $policy): array
    {
        $issues = [];
        $duration = self::hours($target['startsAt'], $target['endsAt']);

        if ($duration > $policy['maximumShiftHours']) {
            $issues[] = self::issue('maximum_shift', 'block', sprintf(
                'Shift is %.2f hours; policy maximum is %.2f hours.',
                $duration, $policy['maximumShiftHours'],
            ));
        }

        $theirs = array_values(array_filter(
            $all,
            static fn (array $s) => $s['id'] !== $target['id'] && $s['userId'] === $target['userId'],
        ));

        $clashes = array_filter($theirs, static fn (array $s) => self::overlaps($s, $target));
        if ($clashes !== []) {
            $count = count($clashes);
            $issues[] = self::issue('overlap', 'block', sprintf(
                'Shift overlaps %d other assigned shift%s.',
                $count, $count === 1 ? '' : 's',
            ));
        }

        // Rest is measured from the shift that ended most recently before this
        // one starts, not from any earlier shift.
        $before = array_filter($theirs, static fn (array $s) => $s['endsAt'] <= $target['startsAt']);
        usort($before, static fn (array $a, array $b) => $b['endsAt'] <=> $a['endsAt']);
        $previous = $before[0] ?? null;

        if ($previous !== null) {
            $rest = self::hours($previous['endsAt'], $target['startsAt']);
            if ($rest < $policy['minimumRestHours']) {
                $issues[] = self::issue('minimum_rest', 'block', sprintf(
                    'Rest is %.2f hours; policy minimum is %.2f hours.',
                    $rest, $policy['minimumRestHours'],
                ));
            }
        }

        // The week runs Monday to Monday in UTC, and a shift straddling the
        // boundary counts only the part inside the week.
        [$weekStart, $weekEnd] = self::weekBounds($target['startsAt']);
        $weekly = 0.0;
        foreach ($all as $shift) {
            if ($shift['userId'] !== $target['userId'] || $shift['startsAt'] >= $weekEnd || $shift['endsAt'] <= $weekStart) {
                continue;
            }
            $weekly += max(0, self::hours(
                max($shift['startsAt'], $weekStart),
                min($shift['endsAt'], $weekEnd),
            ));
        }

        if ($weekly > $policy['maximumWeeklyHours']) {
            $issues[] = self::issue('maximum_weekly', 'block', sprintf(
                'Assigned weekly hours total %.2f; policy maximum is %.2f.',
                $weekly, $policy['maximumWeeklyHours'],
            ));
        }

        foreach ($availability as $entry) {
            if ($entry['userId'] === $target['userId']
                && in_array($entry['status'], ['active', 'approved'], true)
                && in_array($entry['availabilityType'], self::BLOCKING_AVAILABILITY, true)
                && self::overlaps($entry, $target)) {
                $issues[] = self::issue('availability', 'block', sprintf(
                    'Shift overlaps active %s availability.',
                    str_replace('_', ' ', $entry['availabilityType']),
                ));
                break;
            }
        }

        $startHour = (int) self::utc($target['startsAt'])->format('G');
        $endHour = (int) self::utc($target['endsAt'])->format('G');

        // Night work is a warning rather than a block: it is lawful, but a long
        // night shift is worth a manager seeing.
        if (($startHour >= 23 || $startHour < 6 || $endHour <= 6) && $duration > $policy['maximumNightHours']) {
            $issues[] = self::issue('night_work', 'warning', sprintf(
                'Night shift is %.2f hours; night-work threshold is %.2f hours.',
                $duration, $policy['maximumNightHours'],
            ));
        }

        if ($duration > $policy['breakAfterHours']) {
            $issues[] = self::issue('break', 'warning', sprintf(
                'Shift exceeds %.2f hours; confirm the required break is planned and recorded.',
                $policy['breakAfterHours'],
            ));
        }

        return $issues;
    }

    /**
     * A replacement moves the existing shift to somebody else; extra or
     * emergency cover adds a shift beside it rather than taking the first
     * worker off.
     */
    public static function staffingChangeStrategy(string $type): string
    {
        return $type === 'replacement' ? 'reassign_existing' : 'create_linked_shift';
    }

    /**
     * Who has to be told. A replacement also tells the person taken off, so
     * nobody turns up to a shift that is no longer theirs.
     *
     * @return array<int, int>
     */
    public static function staffingAcknowledgementRecipients(string $type, ?int $originalUserId, int $newUserId): array
    {
        $recipients = [$newUserId];

        if ($type === 'replacement' && $originalUserId !== null && $originalUserId !== $newUserId) {
            $recipients[] = $originalUserId;
        }

        return array_values(array_unique($recipients));
    }

    /** @return array{exceptionState: string, payrollState: string} */
    public static function workedSummaryState(?int $clockedMinutes): array
    {
        // Nothing goes to payroll on an assumption: a shift with no clock record
        // is held rather than paid at its scheduled length.
        return $clockedMinutes === null
            ? ['exceptionState' => 'missing_clock', 'payrollState' => 'not_ready']
            : ['exceptionState' => 'none', 'payrollState' => 'ready'];
    }

    /** The caller edited a calendar that has since moved on. */
    public static function isStaleCalendarVersion(?int $expected, int $current, int $toleranceMs = 1000): bool
    {
        return $expected !== null && abs($current - $expected) > $toleranceMs;
    }

    /**
     * Warnings can be overridden, but only deliberately and in writing.
     *
     * @param array<int, string> $warnings
     */
    public static function requireCalendarOverride(array $warnings, ?string $reason): bool
    {
        if ($warnings === []) {
            return false;
        }

        if ($reason === null || trim($reason) === '') {
            throw TrpcException::badRequest(
                'This schedule change needs manager review: ' . implode(' ', $warnings)
                . ' Enter an override reason of at least ' . self::MIN_OVERRIDE_REASON
                . ' characters or correct the shift.'
            );
        }

        if (strlen(trim($reason)) < self::MIN_OVERRIDE_REASON) {
            throw TrpcException::badRequest(
                'Schedule override reason must contain at least ' . self::MIN_OVERRIDE_REASON . ' characters.'
            );
        }

        return true;
    }

    /**
     * Great-circle distance in metres, used to check a clock-in happened at the
     * property rather than somewhere else.
     */
    public static function distanceMetres(float $lat1, float $lon1, float $lat2, float $lon2): float
    {
        $radius = 6371000;
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);

        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;

        return $radius * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    /** @return array{0: int, 1: int} Monday 00:00 UTC and the Monday after. */
    private static function weekBounds(int $at): array
    {
        $date = self::utc($at);
        // ISO weekday: Monday is 1, so Monday's offset is 0.
        $offset = ((int) $date->format('N')) - 1;
        $weekStart = $date->setTime(0, 0)->modify("-$offset days")->getTimestamp() * 1000;

        return [$weekStart, $weekStart + 7 * self::DAY_MS];
    }

    private static function utc(int $millis): DateTimeImmutable
    {
        return (new DateTimeImmutable('@' . intdiv($millis, 1000)))->setTimezone(new DateTimeZone('UTC'));
    }

    private static function hours(int $start, int $end): float
    {
        return ($end - $start) / self::HOUR_MS;
    }

    /**
     * @param array{startsAt: int, endsAt: int} $a
     * @param array{startsAt: int, endsAt: int} $b
     */
    private static function overlaps(array $a, array $b): bool
    {
        return $a['startsAt'] < $b['endsAt'] && $b['startsAt'] < $a['endsAt'];
    }

    /** @return array{exceptionType: string, severity: string, detail: string} */
    private static function issue(string $type, string $severity, string $detail): array
    {
        return ['exceptionType' => $type, 'severity' => $severity, 'detail' => $detail];
    }
}
