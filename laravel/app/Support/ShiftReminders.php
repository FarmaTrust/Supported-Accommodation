<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Nudges for the worker who is on shift right now, mirroring
 * server/services/handoverShiftStartReminders.ts and shiftAttendanceReminders.ts.
 *
 * Both rules are deliberately narrow. Neither decides access or reveals any
 * content: they answer only "should this person be reminded", and the caller
 * still has to pass the usual permission checks before showing anything. An
 * acknowledgement by a different worker, or for a different shift, never
 * counts — that is the whole point of a handover receipt.
 */
final class ShiftReminders
{
    private const ATTENDANCE_WINDOW_MS = 1800000;

    /**
     * Unacknowledged previous-shift handovers for a worker whose shift is running.
     *
     * @param array<int, array<string, mixed>> $shifts
     * @param array<int, array<string, mixed>> $handovers
     * @param array<int, array<string, mixed>> $acknowledgements
     * @return array<int, array<string, mixed>>
     */
    public static function pendingHandovers(
        int $now,
        int $userId,
        array $shifts,
        array $handovers,
        array $acknowledgements,
        int $maxPerShift = 3,
    ): array {
        $acknowledged = [];
        foreach ($acknowledgements as $item) {
            if ((int) $item['userId'] === $userId) {
                $acknowledged["{$item['handoverId']}:{$item['shiftId']}:{$item['userId']}"] = true;
            }
        }

        $reminders = [];
        foreach ($shifts as $shift) {
            if ($shift['assignedUserId'] !== $userId || $shift['status'] === 'cancelled') {
                continue;
            }
            if ($shift['startsAt'] > $now || $shift['endsAt'] < $now) {
                continue;
            }

            $relevant = array_values(array_filter($handovers, static fn (array $handover) => $handover['entityId'] === $shift['entityId']
                && $handover['propertyId'] === $shift['propertyId']
                && $handover['shiftId'] !== $shift['id']
                && $handover['createdBy'] !== $userId
                && $handover['createdAt'] <= $shift['startsAt']
                && ! isset($acknowledged["{$handover['id']}:{$shift['id']}:$userId"])));

            usort($relevant, static fn (array $left, array $right) => $right['createdAt'] <=> $left['createdAt']);

            foreach (array_slice($relevant, 0, $maxPerShift) as $handover) {
                $reminders[] = [
                    'shiftId' => $shift['id'],
                    'handoverId' => $handover['id'],
                    'entityId' => $shift['entityId'],
                    'propertyId' => $shift['propertyId'],
                    'recipientUserId' => $userId,
                    'dedupeKey' => "handover-shift-start:{$handover['id']}:{$shift['id']}:$userId",
                ];
            }
        }

        return $reminders;
    }

    /**
     * Clock-in and clock-out nudges within half an hour either side of a shift edge.
     *
     * @param array<int, array<string, mixed>> $shifts
     * @param array<int, array<string, mixed>> $clockEvents
     * @return array<int, array<string, mixed>>
     */
    public static function dueAttendance(int $now, int $userId, array $shifts, array $clockEvents): array
    {
        $clockedIn = [];
        $clockedOut = [];
        foreach ($clockEvents as $event) {
            if ($event['shiftId'] === null) {
                continue;
            }
            if ($event['eventType'] === 'clock_in') {
                $clockedIn[$event['shiftId']] = true;
            }
            if ($event['eventType'] === 'clock_out') {
                $clockedOut[$event['shiftId']] = true;
            }
        }

        $reminders = [];
        foreach ($shifts as $shift) {
            if ($shift['assignedUserId'] !== $userId || ! in_array($shift['status'], ['assigned', 'confirmed', 'in_progress'], true)) {
                continue;
            }

            $in = isset($clockedIn[$shift['id']]);
            $out = isset($clockedOut[$shift['id']]);

            if (! $in && self::nearEdge($now, $shift['startsAt'])) {
                $reminders[] = self::reminder($shift, $userId, 'clock_in', $shift['startsAt'],
                    'Clock in for your shift',
                    'Your assigned shift is starting. Record attendance before continuing with operational tasks.');
            }
            if ($in && ! $out && self::nearEdge($now, $shift['endsAt'])) {
                $reminders[] = self::reminder($shift, $userId, 'clock_out', $shift['endsAt'],
                    'Clock out at shift end',
                    'Your assigned shift is ending. Record clock-out once your handover and duties are complete.');
            }
        }

        return $reminders;
    }

    public static function attendanceDedupeKey(int $shiftId, int $userId, string $eventType): string
    {
        return "shift-attendance:$shiftId:$userId:" . ($eventType === 'clock_in' ? 'clock-in' : 'clock-out');
    }

    private static function nearEdge(int $now, int $edge): bool
    {
        return $now >= $edge - self::ATTENDANCE_WINDOW_MS && $now <= $edge + self::ATTENDANCE_WINDOW_MS;
    }

    /**
     * @param array<string, mixed> $shift
     * @return array<string, mixed>
     */
    private static function reminder(array $shift, int $userId, string $eventType, int $dueAt, string $title, string $message): array
    {
        return [
            'entityId' => $shift['entityId'],
            'propertyId' => $shift['propertyId'],
            'recipientUserId' => $userId,
            'shiftId' => $shift['id'],
            'eventType' => $eventType,
            'title' => $title,
            'message' => $message,
            'dueAt' => $dueAt,
            'dedupeKey' => self::attendanceDedupeKey($shift['id'], $userId, $eventType),
        ];
    }
}
