<?php

declare(strict_types=1);

namespace App\Support;

use App\Trpc\TrpcException;
use DateTimeImmutable;
use DateTimeZone;

/**
 * The minimum-age policy for a placement, mirroring the age rules in
 * server/services/inputValidation.ts.
 *
 * Supported accommodation is not registered for children below the configured
 * age, so placing one is an exceptional decision. It is allowed, because
 * refusing outright would push the record out of the system altogether, but
 * only an Owner or Registered Manager may take it and only with a written
 * reason long enough to be reviewed later.
 */
final class AgePolicy
{
    public const MINIMUM_AGE = 14;
    private const MINIMUM_OVERRIDE_REASON = 20;

    /** Whole years on a given date, counting a birthday that has not arrived. */
    public static function ageOnDate(int $dateOfBirthMs, int $onDateMs): int
    {
        $utc = new DateTimeZone('UTC');
        $birth = (new DateTimeImmutable('@' . intdiv($dateOfBirthMs, 1000)))->setTimezone($utc);
        $at = (new DateTimeImmutable('@' . intdiv($onDateMs, 1000)))->setTimezone($utc);

        return (int) $birth->diff($at)->y;
    }

    /**
     * @return array{overridden: bool, age: int|null}
     */
    public static function assert(?int $dateOfBirth, int $onDate, ?string $overrideReason, bool $canOverride, int $minimumAge = self::MINIMUM_AGE): array
    {
        if ($dateOfBirth === null) {
            return ['overridden' => false, 'age' => null];
        }

        if ($dateOfBirth > $onDate) {
            throw TrpcException::badRequest(
                'Date of birth must be a valid date in the past. Correct the date before saving.'
            );
        }

        $age = self::ageOnDate($dateOfBirth, $onDate);

        if ($age >= $minimumAge) {
            return ['overridden' => false, 'age' => $age];
        }

        $message = "The young person will be $age on the placement or referral date. "
            . "The configured minimum age is $minimumAge. "
            . 'A registered manager or owner can override this policy with a recorded reason.';

        if ($overrideReason === null || trim($overrideReason) === '') {
            throw TrpcException::badRequest($message);
        }

        if (!$canOverride) {
            throw TrpcException::forbidden('Only an owner or registered manager can override the minimum-age policy.');
        }

        if (strlen(trim($overrideReason)) < self::MINIMUM_OVERRIDE_REASON) {
            throw TrpcException::badRequest(
                'Override reason must contain at least ' . self::MINIMUM_OVERRIDE_REASON
                . ' characters so the exceptional decision can be reviewed.'
            );
        }

        return ['overridden' => true, 'age' => $age];
    }

    /** A start and end that make sense together. */
    public static function assertDateRange(?int $start, ?int $end, string $label, string $endField = 'endsAt'): void
    {
        if ($start === null || $end === null) {
            return;
        }

        if ($end <= $start) {
            throw WorkspacePolicy::fieldError(
                'date_range_invalid',
                $endField,
                "$label end date/time must be after the start date/time. Update the end value before saving.",
            );
        }
    }
}
