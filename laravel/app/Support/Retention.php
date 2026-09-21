<?php

declare(strict_types=1);

namespace App\Support;

/**
 * When a record may be destroyed, mirroring server/services/retention.ts.
 *
 * Two safeguards, and both exist because deletion cannot be undone. Nobody
 * approves their own deletion request, so a mistake or a single bad actor is
 * not enough on its own. And a legal hold beats every approval: if a record is
 * wanted by an inquiry, a court or a safeguarding review, the retention
 * schedule does not get to overrule that.
 */
final class Retention
{
    public const DECISIONS = ['hold', 'approved_delete', 'approved_transfer', 'cancelled'];

    /**
     * @return array{allowed: bool, reason: string}
     */
    public static function validateDecision(int $requestedBy, int $decidedBy, bool $legalHold, string $decision): array
    {
        if ($requestedBy === $decidedBy && in_array($decision, ['approved_delete', 'approved_transfer'], true)) {
            return ['allowed' => false, 'reason' => 'independent_approval_required'];
        }

        if ($legalHold && $decision === 'approved_delete') {
            return ['allowed' => false, 'reason' => 'legal_hold'];
        }

        return ['allowed' => true, 'reason' => 'valid'];
    }

    public static function canCompleteDeletion(string $status, bool $legalHold, string $resourceType): bool
    {
        return $status === 'approved_delete' && !$legalHold && $resourceType === 'document';
    }

    public static function queueState(int $retentionUntil, int $reviewDueAt, bool $legalHold, ?int $now = null): string
    {
        $now ??= Dates::nowMillis();

        return match (true) {
            $legalHold => 'hold',
            $reviewDueAt <= $now => 'review_due',
            $retentionUntil <= $now => 'eligible',
            default => 'scheduled',
        };
    }
}
