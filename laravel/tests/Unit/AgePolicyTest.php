<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\AgePolicy;
use App\Trpc\TrpcException;
use PHPUnit\Framework\TestCase;

/**
 * Placing a child below the registered minimum age is an exceptional decision.
 * The rule allows it rather than refusing outright, because a refusal pushes the
 * record out of the system entirely, but it has to be a manager's decision with
 * a reason somebody can read afterwards. These check that each of those
 * conditions actually holds.
 */
final class AgePolicyTest extends TestCase
{
    /** 2026-09-21, the reference date these cases are written against. */
    private const ON_DATE = 1789000000000;

    private function birthdayYearsBefore(int $years): int
    {
        return (int) (strtotime('-' . $years . ' years', intdiv(self::ON_DATE, 1000)) * 1000);
    }

    public function test_age_is_counted_in_whole_years(): void
    {
        $this->assertSame(16, AgePolicy::ageOnDate($this->birthdayYearsBefore(16), self::ON_DATE));
        $this->assertSame(0, AgePolicy::ageOnDate(self::ON_DATE, self::ON_DATE));
    }

    public function test_a_birthday_that_has_not_arrived_does_not_count(): void
    {
        // One day short of the fourteenth birthday is thirteen, not fourteen.
        $dayBefore = $this->birthdayYearsBefore(14) + 86400000;

        $this->assertSame(13, AgePolicy::ageOnDate($dayBefore, self::ON_DATE));
    }

    public function test_no_date_of_birth_is_allowed_and_reports_no_age(): void
    {
        // A referral often arrives before the date of birth is confirmed, so a
        // missing one is not a blocker.
        $this->assertSame(['overridden' => false, 'age' => null], AgePolicy::assert(null, self::ON_DATE, null, false));
    }

    public function test_someone_at_or_over_the_minimum_needs_no_override(): void
    {
        $result = AgePolicy::assert($this->birthdayYearsBefore(14), self::ON_DATE, null, false);

        $this->assertFalse($result['overridden']);
        $this->assertSame(14, $result['age']);
    }

    public function test_a_date_of_birth_in_the_future_is_refused(): void
    {
        $this->expectException(TrpcException::class);
        AgePolicy::assert(self::ON_DATE + 86400000, self::ON_DATE, null, true);
    }

    public function test_below_the_minimum_is_refused_without_a_reason(): void
    {
        try {
            AgePolicy::assert($this->birthdayYearsBefore(13), self::ON_DATE, null, true);
            $this->fail('a placement below the minimum age should be refused without a reason');
        } catch (TrpcException $error) {
            $this->assertSame('BAD_REQUEST', $error->trpcCode);
            $this->assertStringContainsString('minimum age is 14', $error->getMessage());
        }
    }

    public function test_only_an_owner_or_manager_may_override(): void
    {
        try {
            AgePolicy::assert($this->birthdayYearsBefore(13), self::ON_DATE, 'An exceptional emergency placement agreed with the authority', false);
            $this->fail('a worker without the role should not be able to override');
        } catch (TrpcException $error) {
            $this->assertSame('FORBIDDEN', $error->trpcCode);
        }
    }

    public function test_a_token_reason_is_not_enough(): void
    {
        // Short enough to be meaningless to whoever reviews it later.
        try {
            AgePolicy::assert($this->birthdayYearsBefore(13), self::ON_DATE, 'emergency', true);
            $this->fail('a very short reason should be refused');
        } catch (TrpcException $error) {
            $this->assertStringContainsString('at least 20 characters', $error->getMessage());
        }
    }

    public function test_a_manager_with_a_full_reason_may_override_and_it_is_recorded(): void
    {
        $result = AgePolicy::assert(
            $this->birthdayYearsBefore(13),
            self::ON_DATE,
            'Emergency out-of-hours placement agreed with the placing authority pending review',
            true,
        );

        $this->assertTrue($result['overridden'], 'the override has to be reported so it can be audited');
        $this->assertSame(13, $result['age']);
    }

    public function test_a_date_range_must_end_after_it_starts(): void
    {
        AgePolicy::assertDateRange(100, 200, 'Placement');
        AgePolicy::assertDateRange(null, 200, 'Placement');
        AgePolicy::assertDateRange(100, null, 'Placement');

        $this->expectException(TrpcException::class);
        AgePolicy::assertDateRange(200, 100, 'Placement');
    }
}
