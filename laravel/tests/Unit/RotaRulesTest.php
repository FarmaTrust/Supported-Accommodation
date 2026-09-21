<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\RotaRules;
use App\Trpc\TrpcException;
use PHPUnit\Framework\TestCase;

/**
 * These rules decide whether a person can be put on a shift. A block exists for
 * the worker's safety — rest, a maximum day, a weekly ceiling, leave already
 * booked — and a warning is a judgement a manager can override in writing. The
 * tests are about which of the two each rule produces, because getting that
 * backwards either blocks a legal rota or lets an unsafe one through.
 */
final class RotaRulesTest extends TestCase
{
    private const HOUR = 3600000;

    /** Thursday 2026-09-17 08:00 UTC. */
    private const THURSDAY_0800 = 1789891200000;

    /** @return array<string, float> */
    private function policy(): array
    {
        return [
            'minimumRestHours' => 11.0,
            'maximumShiftHours' => 12.0,
            'maximumWeeklyHours' => 48.0,
            'maximumNightHours' => 8.0,
            'breakAfterHours' => 6.0,
        ];
    }

    /** @return array{id: int, userId: int, startsAt: int, endsAt: int} */
    private function shift(int $id, int $startsAt, float $hours, int $userId = 1): array
    {
        return ['id' => $id, 'userId' => $userId, 'startsAt' => $startsAt, 'endsAt' => $startsAt + (int) ($hours * self::HOUR)];
    }

    /** @param array<int, array<string, mixed>> $issues */
    private function types(array $issues): array
    {
        return array_column($issues, 'exceptionType');
    }

    public function test_an_ordinary_shift_raises_nothing(): void
    {
        $target = $this->shift(1, self::THURSDAY_0800, 6);

        $this->assertSame([], RotaRules::evaluateWorkingTime($target, [$target], [], $this->policy()));
    }

    public function test_a_shift_longer_than_the_policy_maximum_is_blocked(): void
    {
        $target = $this->shift(1, self::THURSDAY_0800, 13);
        $issues = RotaRules::evaluateWorkingTime($target, [$target], [], $this->policy());

        $this->assertContains('maximum_shift', $this->types($issues));
        $this->assertSame('block', $issues[0]['severity']);
        $this->assertStringContainsString('13.00 hours', $issues[0]['detail']);
    }

    public function test_overlapping_shifts_for_the_same_person_are_blocked(): void
    {
        $target = $this->shift(1, self::THURSDAY_0800, 6);
        $other = $this->shift(2, self::THURSDAY_0800 + 2 * self::HOUR, 6);

        $issues = RotaRules::evaluateWorkingTime($target, [$target, $other], [], $this->policy());

        $this->assertContains('overlap', $this->types($issues));
    }

    public function test_two_people_on_the_same_hours_do_not_overlap(): void
    {
        $target = $this->shift(1, self::THURSDAY_0800, 6, 1);
        $colleague = $this->shift(2, self::THURSDAY_0800, 6, 2);

        $issues = RotaRules::evaluateWorkingTime($target, [$target, $colleague], [], $this->policy());

        $this->assertNotContains('overlap', $this->types($issues));
    }

    public function test_too_little_rest_since_the_last_shift_is_blocked(): void
    {
        $target = $this->shift(1, self::THURSDAY_0800, 6);
        // Ended eight hours before this one starts; the policy asks for eleven.
        $previous = $this->shift(2, self::THURSDAY_0800 - 12 * self::HOUR, 4);

        $issues = RotaRules::evaluateWorkingTime($target, [$target, $previous], [], $this->policy());

        $this->assertContains('minimum_rest', $this->types($issues));
    }

    public function test_enough_rest_since_the_last_shift_raises_nothing(): void
    {
        $target = $this->shift(1, self::THURSDAY_0800, 6);
        $previous = $this->shift(2, self::THURSDAY_0800 - 18 * self::HOUR, 4);

        $issues = RotaRules::evaluateWorkingTime($target, [$target, $previous], [], $this->policy());

        $this->assertNotContains('minimum_rest', $this->types($issues));
    }

    public function test_the_weekly_ceiling_counts_the_whole_week(): void
    {
        $target = $this->shift(1, self::THURSDAY_0800, 10);
        $all = [$target];
        // Four more ten-hour days in the same Monday-to-Monday week.
        for ($i = 1; $i <= 4; $i++) {
            $all[] = $this->shift($i + 1, self::THURSDAY_0800 - $i * 24 * self::HOUR, 10);
        }

        $issues = RotaRules::evaluateWorkingTime($target, $all, [], $this->policy());

        $this->assertContains('maximum_weekly', $this->types($issues));
    }

    public function test_booked_leave_blocks_the_shift(): void
    {
        $target = $this->shift(1, self::THURSDAY_0800, 6);
        $availability = [[
            'userId' => 1, 'startsAt' => self::THURSDAY_0800 - self::HOUR,
            'endsAt' => self::THURSDAY_0800 + 8 * self::HOUR,
            'availabilityType' => 'annual_leave', 'status' => 'approved',
        ]];

        $issues = RotaRules::evaluateWorkingTime($target, [$target], $availability, $this->policy());

        $this->assertContains('availability', $this->types($issues));
    }

    public function test_availability_that_is_not_active_does_not_block(): void
    {
        $target = $this->shift(1, self::THURSDAY_0800, 6);
        $availability = [[
            'userId' => 1, 'startsAt' => self::THURSDAY_0800,
            'endsAt' => self::THURSDAY_0800 + 8 * self::HOUR,
            'availabilityType' => 'annual_leave', 'status' => 'declined',
        ]];

        $issues = RotaRules::evaluateWorkingTime($target, [$target], $availability, $this->policy());

        $this->assertNotContains('availability', $this->types($issues));
    }

    public function test_a_long_night_shift_warns_rather_than_blocks(): void
    {
        // Starts at midnight UTC and runs ten hours.
        $target = $this->shift(1, self::THURSDAY_0800 - 8 * self::HOUR, 10);

        $issues = RotaRules::evaluateWorkingTime($target, [$target], [], $this->policy());
        $night = array_values(array_filter($issues, static fn ($i) => $i['exceptionType'] === 'night_work'));

        $this->assertNotSame([], $night, 'a ten-hour night shift should be raised');
        $this->assertSame('warning', $night[0]['severity'], 'night work is lawful; it is a judgement, not a block');
    }

    public function test_a_shift_past_the_break_threshold_warns(): void
    {
        $target = $this->shift(1, self::THURSDAY_0800, 8);

        $issues = RotaRules::evaluateWorkingTime($target, [$target], [], $this->policy());
        $break = array_values(array_filter($issues, static fn ($i) => $i['exceptionType'] === 'break'));

        $this->assertNotSame([], $break);
        $this->assertSame('warning', $break[0]['severity']);
    }

    public function test_a_replacement_moves_the_shift_and_extra_cover_adds_one(): void
    {
        $this->assertSame('reassign_existing', RotaRules::staffingChangeStrategy('replacement'));
        $this->assertSame('create_linked_shift', RotaRules::staffingChangeStrategy('additional'));
        $this->assertSame('create_linked_shift', RotaRules::staffingChangeStrategy('emergency'));
    }

    public function test_a_replacement_also_tells_the_person_taken_off(): void
    {
        // Otherwise somebody turns up to a shift that is no longer theirs.
        $this->assertSame([9, 4], RotaRules::staffingAcknowledgementRecipients('replacement', 4, 9));
        $this->assertSame([9], RotaRules::staffingAcknowledgementRecipients('additional', 4, 9));
        $this->assertSame([9], RotaRules::staffingAcknowledgementRecipients('replacement', 9, 9));
        $this->assertSame([9], RotaRules::staffingAcknowledgementRecipients('replacement', null, 9));
    }

    public function test_a_shift_with_no_clock_record_is_held_back_from_payroll(): void
    {
        $this->assertSame(
            ['exceptionState' => 'missing_clock', 'payrollState' => 'not_ready'],
            RotaRules::workedSummaryState(null),
        );
        $this->assertSame(
            ['exceptionState' => 'none', 'payrollState' => 'ready'],
            RotaRules::workedSummaryState(480),
        );
    }

    public function test_a_stale_calendar_version_is_detected_within_a_tolerance(): void
    {
        $this->assertFalse(RotaRules::isStaleCalendarVersion(null, 1000));
        $this->assertFalse(RotaRules::isStaleCalendarVersion(1000, 1500), 'half a second is within tolerance');
        $this->assertTrue(RotaRules::isStaleCalendarVersion(1000, 5000));
    }

    public function test_warnings_need_a_written_override(): void
    {
        $this->assertFalse(RotaRules::requireCalendarOverride([], null), 'nothing to override');

        try {
            RotaRules::requireCalendarOverride(['Overlaps shift #4'], null);
            $this->fail('a warning with no reason should be refused');
        } catch (TrpcException $error) {
            $this->assertStringContainsString('Overlaps shift #4', $error->getMessage());
        }

        $this->expectException(TrpcException::class);
        RotaRules::requireCalendarOverride(['Overlaps shift #4'], 'too short');
    }

    public function test_a_full_override_reason_is_accepted(): void
    {
        $this->assertTrue(RotaRules::requireCalendarOverride(
            ['Overlaps shift #4'],
            'Agreed with the worker to cover an emergency absence tonight',
        ));
    }

    public function test_distance_is_measured_in_metres(): void
    {
        $this->assertSame(0.0, round(RotaRules::distanceMetres(51.5, -0.12, 51.5, -0.12), 2));

        // Roughly a kilometre north.
        $km = RotaRules::distanceMetres(51.5, -0.12, 51.509, -0.12);
        $this->assertGreaterThan(950, $km);
        $this->assertLessThan(1050, $km);
    }
}
