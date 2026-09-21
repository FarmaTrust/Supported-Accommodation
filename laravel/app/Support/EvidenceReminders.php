<?php

declare(strict_types=1);

namespace App\Support;

use App\Trpc\TrpcException;

/**
 * Evidence-reminder settings, mirroring server/services/evidenceReminders.ts.
 *
 * Every value is clamped rather than trusted, so a hand-edited configuration
 * column cannot set a reminder window of zero hours or a year's lead time and
 * quietly turn the chasing off.
 */
final class EvidenceReminders
{
    /** @var array<string, mixed> */
    public const DEFAULTS = [
        'enabled' => true,
        'staffEvidenceReviewHours' => 48,
        'documentReviewLeadDays' => 30,
        'retentionReviewLeadDays' => 30,
        'runAtHourUtc' => 7,
    ];

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public static function normalise(array $input): array
    {
        return [
            'enabled' => (bool) ($input['enabled'] ?? self::DEFAULTS['enabled']),
            'staffEvidenceReviewHours' => self::clamp($input['staffEvidenceReviewHours'] ?? null, 1, 720, self::DEFAULTS['staffEvidenceReviewHours']),
            'documentReviewLeadDays' => self::clamp($input['documentReviewLeadDays'] ?? null, 1, 365, self::DEFAULTS['documentReviewLeadDays']),
            'retentionReviewLeadDays' => self::clamp($input['retentionReviewLeadDays'] ?? null, 1, 365, self::DEFAULTS['retentionReviewLeadDays']),
            'runAtHourUtc' => self::clamp($input['runAtHourUtc'] ?? null, 0, 23, self::DEFAULTS['runAtHourUtc']),
        ];
    }

    /** Whether something due at this time is close enough to chase. */
    public static function shouldNotifyByLeadTime(?int $dueAt, int $leadDays, ?int $nowMs = null): bool
    {
        if ($dueAt === null) {
            return false;
        }

        return $dueAt <= ($nowMs ?? Dates::nowMillis()) + $leadDays * 86400000;
    }

    /**
     * A five-field cron expression, the form the host's scheduler accepts. The
     * Node server used the six-field form the Manus heartbeat service wanted,
     * which is not what a shared-hosting cron entry takes.
     */
    public static function assertCron(string $cron): void
    {
        if (preg_match('/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/', trim($cron)) !== 1) {
            throw TrpcException::badRequest(
                'Enter a five-field cron expression, for example "0 7 * * *" for 07:00 daily.'
            );
        }
    }

    public static function cronForHour(int $hourUtc): string
    {
        if ($hourUtc < 0 || $hourUtc > 23) {
            throw TrpcException::badRequest('Reminder hour must be a whole UTC hour between 0 and 23');
        }

        return "0 $hourUtc * * *";
    }

    private static function clamp(mixed $value, int $min, int $max, int $fallback): int
    {
        if (!is_int($value) && !(is_float($value) && floor($value) === $value)) {
            return $fallback;
        }

        return max($min, min($max, (int) $value));
    }
}
