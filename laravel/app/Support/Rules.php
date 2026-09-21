<?php

declare(strict_types=1);

namespace App\Support;

use App\Trpc\TrpcException;

/**
 * Shared calculations, mirroring server/services/rules.ts and
 * server/services/propertyComplianceRules.ts.
 *
 * These drive what the workspace shows as overdue, so they are kept as plain
 * functions with the same thresholds rather than being folded into the queries
 * that use them.
 */
final class Rules
{
    /** @var array<int, string> */
    public const PROPERTY_COMPLIANCE_KINDS = [
        'hmo_licence', 'ofsted_registration', 'gas_safety', 'electrical_safety',
        'fire_safety', 'insurance', 'other_certificate',
    ];

    /** @var array<string, string> */
    public const PROPERTY_COMPLIANCE_LABELS = [
        'hmo_licence' => 'HMO licence',
        'ofsted_registration' => 'Ofsted registration / renewal',
        'gas_safety' => 'Gas safety certificate',
        'electrical_safety' => 'Electrical safety certificate',
        'fire_safety' => 'Fire safety certificate',
        'insurance' => 'Property insurance certificate',
        'other_certificate' => 'Other legal / regulatory certificate',
    ];

    /** @var array<string, string> */
    public const PROPERTY_COMPLIANCE_RECORD_TYPES = [
        'hmo_licence' => 'licence',
        'ofsted_registration' => 'licence',
        'gas_safety' => 'gas_safety',
        'electrical_safety' => 'electrical_safety',
        'fire_safety' => 'fire_risk',
        'insurance' => 'insurance',
        'other_certificate' => 'certificate',
    ];

    private const DAY_MS = 86400000;

    /** Red when overdue, amber inside the lead time, green otherwise, grey with no date. */
    public static function ragStatus(?int $dueAt, ?int $completedAt = null, int $leadDays = 30, ?int $nowMs = null): string
    {
        if ($completedAt) {
            return 'green';
        }
        if (!$dueAt) {
            return 'grey';
        }

        $now = $nowMs ?? Dates::nowMillis();
        if ($dueAt < $now) {
            return 'red';
        }
        if ($dueAt <= $now + $leadDays * self::DAY_MS) {
            return 'amber';
        }

        return 'green';
    }

    /**
     * A property record is only valid once its evidence is approved, so a record
     * with a future date but no approved document still reads as action
     * required rather than green.
     *
     * @return array{status: string, ragStatus: string}
     */
    public static function propertyRecordState(int $dueAt, bool $evidenceApproved, int $leadDays = 30, ?int $nowMs = null): array
    {
        $rag = self::ragStatus($dueAt, null, $leadDays, $nowMs);

        if ($rag === 'red') {
            return ['status' => 'expired', 'ragStatus' => 'red'];
        }
        if (!$evidenceApproved) {
            return ['status' => 'action_required', 'ragStatus' => 'red'];
        }
        if ($rag === 'amber') {
            return ['status' => 'due_soon', 'ragStatus' => 'amber'];
        }

        return ['status' => 'valid', 'ragStatus' => 'green'];
    }

    /**
     * A property obligation is red while its certificate has no evidence
     * attached, whatever its date says. A renewal nobody can produce a
     * certificate for is not green because it is not due yet.
     */
    public static function propertyObligationRag(?string $sourceType, ?int $evidenceDocumentId, ?int $dueAt, ?int $completedAt, int $leadDays, ?int $nowMs = null): string
    {
        if ($sourceType === 'property_evidence' && $evidenceDocumentId === null) {
            return 'red';
        }

        return self::ragStatus($dueAt, $completedAt, $leadDays, $nowMs);
    }

    /** The obligation status that pairs with a rag colour. */
    /** Where a deadline sits relative to now and its lead time. */
    public static function classifyDeadline(int $dueAt, int $leadDays, ?int $nowMs = null): string
    {
        $now = $nowMs ?? Dates::nowMillis();

        if ($dueAt < $now) {
            return 'overdue';
        }

        return $dueAt <= $now + $leadDays * self::DAY_MS ? 'due' : 'not_due';
    }

    public static function obligationStatusFor(string $ragStatus): string
    {
        return match ($ragStatus) {
            'red' => 'overdue',
            'amber' => 'due_soon',
            default => 'not_due',
        };
    }

    public static function assertPropertyRecordDates(int $issuedAt, int $dueAt): void
    {
        if ($dueAt <= $issuedAt) {
            throw TrpcException::badRequest(
                'Expiry or review date must be after the issue date. Correct the date before saving.'
            );
        }
    }

    /**
     * Invoice arithmetic, rounded to pence at each step so a total never drifts
     * from the sum of its lines.
     *
     * @return array{net: float, vat: float, gross: float}
     */
    public static function invoiceLine(float $quantity, float $unitPrice, float $vatRate): array
    {
        $net = round($quantity * $unitPrice, 2);
        $vat = round($net * ($vatRate / 100), 2);

        return ['net' => $net, 'vat' => $vat, 'gross' => round($net + $vat, 2)];
    }

    /** Compares addresses ignoring case, spacing and punctuation. */
    public static function normaliseForComparison(string $value): string
    {
        return (string) preg_replace('/[^a-z0-9]/', '', strtolower($value));
    }
}
