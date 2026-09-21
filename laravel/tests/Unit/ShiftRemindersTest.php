<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\ShiftReminders;
use PHPUnit\Framework\TestCase;

/**
 * A handover receipt is evidence that a particular person read a particular
 * note before taking over a house. That is why an acknowledgement by somebody
 * else, or for a different shift, must never silence the reminder — the point
 * is not that the note was read, but that this worker read it.
 */
final class ShiftRemindersTest extends TestCase
{
    private const HOUR = 3600000;

    /** Sunday 2026-09-20 14:00 UTC, four hours into an eight-hour shift. */
    private const NOW = 1789912800000;

    /** @return array<string, mixed> */
    private function shift(int $id = 1, int $userId = 11, string $status = 'assigned'): array
    {
        return [
            'id' => $id,
            'entityId' => 3,
            'propertyId' => 7,
            'assignedUserId' => $userId,
            'startsAt' => self::NOW - 4 * self::HOUR,
            'endsAt' => self::NOW + 4 * self::HOUR,
            'status' => $status,
        ];
    }

    /** @return array<string, mixed> */
    private function handover(int $id, int $createdBy = 12, ?int $shiftId = 9, int $hoursBefore = 5): array
    {
        return [
            'id' => $id,
            'entityId' => 3,
            'propertyId' => 7,
            'shiftId' => $shiftId,
            'createdBy' => $createdBy,
            'createdAt' => self::NOW - $hoursBefore * self::HOUR,
        ];
    }

    public function test_a_previous_shift_handover_is_pending_for_the_worker_on_duty(): void
    {
        $reminders = ShiftReminders::pendingHandovers(self::NOW, 11, [$this->shift()], [$this->handover(4)], []);

        self::assertCount(1, $reminders);
        self::assertSame('handover-shift-start:4:1:11', $reminders[0]['dedupeKey']);
        self::assertSame(7, $reminders[0]['propertyId']);
    }

    public function test_a_worker_is_never_asked_to_acknowledge_their_own_note(): void
    {
        $reminders = ShiftReminders::pendingHandovers(self::NOW, 11, [$this->shift()], [
            $this->handover(4, 11),
            $this->handover(5, 12, 1),
        ], []);

        self::assertSame([], $reminders);
    }

    public function test_a_note_written_after_the_shift_began_is_not_a_previous_handover(): void
    {
        $reminders = ShiftReminders::pendingHandovers(self::NOW, 11, [$this->shift()], [
            $this->handover(4, 12, 9, -1),
        ], []);

        self::assertSame([], $reminders);
    }

    public function test_somebody_elses_acknowledgement_does_not_clear_the_reminder(): void
    {
        $other = ShiftReminders::pendingHandovers(self::NOW, 11, [$this->shift()], [$this->handover(4)], [
            ['handoverId' => 4, 'shiftId' => 1, 'userId' => 99],
        ]);

        self::assertCount(1, $other);

        $wrongShift = ShiftReminders::pendingHandovers(self::NOW, 11, [$this->shift()], [$this->handover(4)], [
            ['handoverId' => 4, 'shiftId' => 2, 'userId' => 11],
        ]);

        self::assertCount(1, $wrongShift);

        $cleared = ShiftReminders::pendingHandovers(self::NOW, 11, [$this->shift()], [$this->handover(4)], [
            ['handoverId' => 4, 'shiftId' => 1, 'userId' => 11],
        ]);

        self::assertSame([], $cleared);
    }

    public function test_only_the_most_recent_notes_are_raised(): void
    {
        $handovers = [];
        foreach ([9, 8, 7, 6, 5] as $index => $hoursBefore) {
            $handovers[] = $this->handover(10 + $index, 12, 9, $hoursBefore);
        }

        $reminders = ShiftReminders::pendingHandovers(self::NOW, 11, [$this->shift()], $handovers, []);

        self::assertCount(3, $reminders);
        self::assertSame([14, 13, 12], array_column($reminders, 'handoverId'));
    }

    public function test_a_cancelled_or_unassigned_shift_raises_nothing(): void
    {
        self::assertSame([], ShiftReminders::pendingHandovers(self::NOW, 11, [$this->shift(1, 11, 'cancelled')], [$this->handover(4)], []));
        self::assertSame([], ShiftReminders::pendingHandovers(self::NOW, 11, [$this->shift(1, 12)], [$this->handover(4)], []));
    }

    public function test_clock_in_is_prompted_around_the_start_and_not_once_recorded(): void
    {
        $shift = $this->shift();
        $atStart = $shift['startsAt'];

        $due = ShiftReminders::dueAttendance($atStart, 11, [$shift], []);
        self::assertCount(1, $due);
        self::assertSame('clock_in', $due[0]['eventType']);
        self::assertSame('shift-attendance:1:11:clock-in', $due[0]['dedupeKey']);
        self::assertSame($atStart, $due[0]['dueAt']);

        $recorded = ShiftReminders::dueAttendance($atStart, 11, [$shift], [['shiftId' => 1, 'eventType' => 'clock_in']]);
        self::assertSame([], $recorded);
    }

    public function test_clock_out_is_prompted_only_after_a_clock_in(): void
    {
        $shift = $this->shift();
        $atEnd = $shift['endsAt'];

        self::assertSame([], ShiftReminders::dueAttendance($atEnd, 11, [$shift], []));

        $due = ShiftReminders::dueAttendance($atEnd, 11, [$shift], [['shiftId' => 1, 'eventType' => 'clock_in']]);
        self::assertCount(1, $due);
        self::assertSame('clock_out', $due[0]['eventType']);
        self::assertSame('shift-attendance:1:11:clock-out', $due[0]['dedupeKey']);

        $finished = ShiftReminders::dueAttendance($atEnd, 11, [$shift], [
            ['shiftId' => 1, 'eventType' => 'clock_in'],
            ['shiftId' => 1, 'eventType' => 'clock_out'],
        ]);
        self::assertSame([], $finished);
    }

    public function test_nothing_is_prompted_outside_the_half_hour_window(): void
    {
        $shift = $this->shift();

        self::assertSame([], ShiftReminders::dueAttendance($shift['startsAt'] - 31 * 60000, 11, [$shift], []));
        self::assertCount(1, ShiftReminders::dueAttendance($shift['startsAt'] - 30 * 60000, 11, [$shift], []));
        self::assertCount(1, ShiftReminders::dueAttendance($shift['startsAt'] + 30 * 60000, 11, [$shift], []));
        self::assertSame([], ShiftReminders::dueAttendance($shift['startsAt'] + 31 * 60000, 11, [$shift], []));
    }

    public function test_the_dedupe_key_matches_the_one_the_clock_resolves(): void
    {
        self::assertSame('shift-attendance:1:11:clock-in', ShiftReminders::attendanceDedupeKey(1, 11, 'clock_in'));
        self::assertSame('shift-attendance:1:11:clock-out', ShiftReminders::attendanceDedupeKey(1, 11, 'clock_out'));
    }
}
