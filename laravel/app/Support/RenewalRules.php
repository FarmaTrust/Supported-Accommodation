<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Renewal banding for certificates and staff checks, mirroring
 * server/services/complianceRenewalRules.ts.
 *
 * A gas certificate or a DBS is either current, coming up, or expired, and the
 * band decides how loudly the workspace says so. The boundaries are what make a
 * renewal reach someone in time, so they are written plainly here and tested
 * against the Node implementation at each edge.
 */
final class RenewalRules
{
    private const DAY = 86400000;

    /** @var array<int, string> */
    public const STAFF_CATEGORIES = [
        'dbs', 'right_to_work', 'safeguarding', 'first_aid', 'medication',
        'fire_safety', 'food_hygiene', 'manual_handling', 'other_training',
    ];

    /** @var array<string, string> */
    public const STAFF_LABELS = [
        'dbs' => 'DBS certificate',
        'right_to_work' => 'Right to Work',
        'safeguarding' => 'Safeguarding training',
        'first_aid' => 'First aid training',
        'medication' => 'Medication training',
        'fire_safety' => 'Fire safety training',
        'food_hygiene' => 'Food hygiene training',
        'manual_handling' => 'Manual handling training',
        'other_training' => 'Other certificate / training',
    ];

    /** The bands that are worth chasing; "current" and a missing date are not. */
    public const ACTIONABLE_BANDS = ['overdue', 'one_month', 'two_months', 'three_months'];

    /**
     * @return array{band: string, daysRemaining: int|null, ragStatus: string, label: string, severity: string}
     */
    public static function band(?int $dueAt, ?int $nowMs = null): array
    {
        if ($dueAt === null || $dueAt === 0) {
            // A record with no renewal date is a gap in its own right, so it is
            // reported rather than treated as current.
            return [
                'band' => 'missing_date', 'daysRemaining' => null, 'ragStatus' => 'grey',
                'label' => 'Renewal date missing', 'severity' => 'warning',
            ];
        }

        $now = $nowMs ?? Dates::nowMillis();
        $days = (int) ceil(($dueAt - $now) / self::DAY);

        if ($dueAt < $now) {
            $overdueBy = max(1, abs($days));

            return [
                'band' => 'overdue', 'daysRemaining' => $days, 'ragStatus' => 'red',
                'label' => "Overdue by $overdueBy day" . (abs($days) === 1 ? '' : 's'),
                'severity' => 'urgent',
            ];
        }

        if ($days <= 30) {
            return [
                'band' => 'one_month', 'daysRemaining' => $days, 'ragStatus' => 'red',
                'label' => "Due in $days day" . ($days === 1 ? '' : 's'),
                'severity' => 'urgent',
            ];
        }

        if ($days <= 60) {
            return [
                'band' => 'two_months', 'daysRemaining' => $days, 'ragStatus' => 'amber',
                'label' => 'Due within 2 months', 'severity' => 'warning',
            ];
        }

        if ($days <= 90) {
            return [
                'band' => 'three_months', 'daysRemaining' => $days, 'ragStatus' => 'amber',
                'label' => 'Due within 3 months', 'severity' => 'warning',
            ];
        }

        return [
            'band' => 'current', 'daysRemaining' => $days, 'ragStatus' => 'green',
            'label' => 'Current', 'severity' => 'info',
        ];
    }

    /**
     * Which kind of property certificate a record is. The stored kind wins; the
     * record type is a fallback for rows written before the kind was captured.
     */
    public static function propertyCategory(string $recordType, string $title, mixed $details): ?string
    {
        $details = is_string($details) ? json_decode($details, true) : $details;
        $kind = is_array($details) ? ($details['propertyComplianceKind'] ?? null) : null;

        if (is_string($kind) && in_array($kind, Rules::PROPERTY_COMPLIANCE_KINDS, true)) {
            return $kind;
        }

        return match ($recordType) {
            'gas_safety' => 'gas_safety',
            'electrical_safety' => 'electrical_safety',
            'fire_risk' => 'fire_safety',
            'insurance' => 'insurance',
            'licence' => str_contains(strtolower($title), 'hmo') ? 'hmo_licence' : 'ofsted_registration',
            'certificate' => 'other_certificate',
            default => null,
        };
    }

    public static function staffCategory(string $checkType, ?string $level): ?string
    {
        if ($level !== null && in_array($level, self::STAFF_CATEGORIES, true)) {
            return $level;
        }

        return match ($checkType) {
            'dbs' => 'dbs',
            'right_to_work' => 'right_to_work',
            'training', 'qualification' => 'other_training',
            default => null,
        };
    }

    /**
     * One alert per record, per band, per recipient. Keying on the band is what
     * makes a certificate raise a fresh alert as it moves from three months to
     * one month to overdue, instead of one that is easy to leave read.
     */
    public static function dedupeKey(string $resourceType, int $resourceId, string $band, int $userId): string
    {
        return "renewal:$resourceType:$resourceId:$band:user:$userId";
    }

    public static function outboxDedupeKey(string $resourceType, int $resourceId, string $band, int $userId): string
    {
        return "renewal-email:$resourceType:$resourceId:$band:user:$userId";
    }
}
