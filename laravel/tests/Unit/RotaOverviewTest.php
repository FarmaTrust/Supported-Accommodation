<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\RotaOverview;
use PHPUnit\Framework\TestCase;

/**
 * A coverage gap is the claim that nobody safe was in the house between two
 * times. It has to be exact in both directions: a gap invented where cover
 * existed wastes a manager's night, and a gap missed where cover did not is
 * the failure the whole rota exists to prevent. These tests pin the interval
 * arithmetic, including the merging that turns four adjacent shortfalls into
 * the one hole a person would describe.
 */
final class RotaOverviewTest extends TestCase
{
    private const HOUR = 3600000;

    /** Thursday 2026-09-17 06:00 UTC, the start of an operating day. */
    private const DAY_START = 1789884000000;

    /** @return array<string, mixed> */
    private function shift(int $id, ?int $userId, float $fromHour, float $toHour, string $status = 'assigned', int $propertyId = 7): array
    {
        return [
            'id' => $id,
            'propertyId' => $propertyId,
            'propertyName' => "House $propertyId",
            'assignedUserId' => $userId,
            'workerName' => $userId === null ? null : "Worker $userId",
            'title' => 'Support shift',
            'startsAt' => self::DAY_START + (int) ($fromHour * self::HOUR),
            'endsAt' => self::DAY_START + (int) ($toHour * self::HOUR),
            'status' => $status,
            'coverageState' => $userId === null ? 'uncovered' : 'covered',
        ];
    }

    /** @return array{id: int, name: string, minimumStaffing: int} */
    private function property(int $minimumStaffing, int $id = 7): array
    {
        return ['id' => $id, 'name' => "House $id", 'minimumStaffing' => $minimumStaffing];
    }

    public function test_operational_day_starts_at_six_and_night_belongs_to_the_day_it_began(): void
    {
        self::assertSame(self::DAY_START, RotaOverview::operationalDayStart(self::DAY_START));
        self::assertSame(self::DAY_START, RotaOverview::operationalDayStart(self::DAY_START + 2 * self::HOUR));

        // 03:00 is the middle of the night shift that started the previous evening.
        self::assertSame(self::DAY_START, RotaOverview::operationalDayStart(self::DAY_START + 21 * self::HOUR));
        self::assertSame(self::DAY_START + RotaOverview::DAY_MS, RotaOverview::operationalDayStart(self::DAY_START + 25 * self::HOUR));
    }

    public function test_staffed_to_the_minimum_produces_no_gap(): void
    {
        $gaps = RotaOverview::coverageGaps(self::DAY_START, $this->property(1), [
            $this->shift(1, 11, 0, 12),
            $this->shift(2, 12, 12, 24),
        ]);

        self::assertSame([], $gaps);
    }

    public function test_adjacent_intervals_with_the_same_shortfall_merge_into_one_gap(): void
    {
        $gaps = RotaOverview::coverageGaps(self::DAY_START, $this->property(2), [
            $this->shift(1, 11, 0, 6),
            $this->shift(2, 11, 6, 12),
        ]);

        self::assertCount(2, $gaps);

        // 06:00–18:00 is one hole one person short, not two touching ones.
        self::assertSame(self::DAY_START, $gaps[0]['startsAt']);
        self::assertSame(self::DAY_START + 12 * self::HOUR, $gaps[0]['endsAt']);
        self::assertSame(1, $gaps[0]['deficit']);
        self::assertSame([1, 2], $gaps[0]['relatedShiftIds']);

        // The empty evening is a different shortfall, so it stays separate.
        self::assertSame(2, $gaps[1]['deficit']);
        self::assertSame([], $gaps[1]['relatedShiftIds']);
    }

    public function test_a_gap_key_names_the_interval_and_the_shortfall(): void
    {
        $gaps = RotaOverview::coverageGaps(self::DAY_START, $this->property(1), [$this->shift(1, 11, 0, 12)]);

        self::assertCount(1, $gaps);
        self::assertSame(
            '7:' . (self::DAY_START + 12 * self::HOUR) . ':' . (self::DAY_START + 24 * self::HOUR) . ':1',
            $gaps[0]['key'],
        );
    }

    public function test_a_cancelled_shift_does_not_count_as_cover(): void
    {
        $gaps = RotaOverview::coverageGaps(self::DAY_START, $this->property(1), [
            $this->shift(1, 11, 0, 24, 'cancelled'),
        ]);

        self::assertCount(1, $gaps);
        self::assertSame(1, $gaps[0]['deficit']);
    }

    public function test_two_shifts_for_one_worker_count_once_towards_staffing(): void
    {
        $gaps = RotaOverview::coverageGaps(self::DAY_START, $this->property(2), [
            $this->shift(1, 11, 0, 24),
            $this->shift(2, 11, 0, 24),
        ]);

        self::assertCount(1, $gaps);
        self::assertSame(1, $gaps[0]['allocatedStaffing']);
        self::assertSame(1, $gaps[0]['deficit']);
    }

    public function test_missing_minutes_counts_every_absent_person(): void
    {
        $overview = RotaOverview::build(self::DAY_START, [], [$this->property(3)]);

        // Nobody at all for 24 hours, three short: 1440 minutes × 3.
        self::assertSame(4320, $overview['coverage']['missingMinutes']);
        self::assertSame(4320, $overview['propertySummary'][0]['missingMinutes']);
        self::assertSame(1, $overview['coverage']['uncovered']);
    }

    public function test_a_worker_booked_in_two_places_at_once_flags_the_rota_for_review(): void
    {
        $overview = RotaOverview::build(self::DAY_START, [
            $this->shift(1, 11, 0, 8),
            $this->shift(2, 11, 4, 12, 'assigned', 8),
        ]);

        self::assertSame('needs_review', $overview['integrity']['state']);
        self::assertSame([1, 2], $overview['integrity']['overlappingShiftIds']);
    }

    public function test_a_clean_rota_reports_checked_integrity(): void
    {
        $overview = RotaOverview::build(self::DAY_START, [
            $this->shift(1, 11, 0, 8),
            $this->shift(2, 12, 8, 16),
        ]);

        self::assertSame('checked', $overview['integrity']['state']);
        self::assertSame([], $overview['integrity']['overlappingShiftIds']);
        self::assertCount(2, $overview['colleagues']);
    }

    public function test_the_same_window_for_two_people_is_working_together(): void
    {
        $overview = RotaOverview::build(self::DAY_START, [
            $this->shift(1, 11, 0, 8),
            $this->shift(2, 12, 0, 8),
        ]);

        self::assertCount(1, $overview['groups']);
        self::assertSame('working_together', $overview['groups'][0]['kind']);
        self::assertSame(['Worker 11', 'Worker 12'], $overview['groups'][0]['workerNames']);
    }

    public function test_a_short_overlap_is_a_handover_window_and_a_long_one_is_not(): void
    {
        $handover = RotaOverview::build(self::DAY_START, [
            $this->shift(1, 11, 0, 8),
            $this->shift(2, 12, 7, 15),
        ]);

        self::assertCount(1, $handover['groups']);
        self::assertSame('close_overlap', $handover['groups'][0]['kind']);
        self::assertSame(self::DAY_START + 7 * self::HOUR, $handover['groups'][0]['startsAt']);
        self::assertSame(self::DAY_START + 8 * self::HOUR, $handover['groups'][0]['endsAt']);

        $doubleShift = RotaOverview::build(self::DAY_START, [
            $this->shift(1, 11, 0, 8),
            $this->shift(2, 12, 5, 13),
        ]);

        self::assertSame([], $doubleShift['groups']);
    }

    public function test_a_shift_outside_the_operating_day_is_left_out(): void
    {
        $overview = RotaOverview::build(self::DAY_START, [
            $this->shift(1, 11, 24, 32),
            $this->shift(2, 12, 0, 8),
        ]);

        self::assertCount(1, $overview['shifts']);
        self::assertSame(2, $overview['shifts'][0]['id']);
    }
}
