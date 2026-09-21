<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Small decisions the assurance and Regulation 28 workspaces share, mirroring
 * server/services/assuranceRules.ts.
 */
final class AssuranceRules
{
    /** Scan outcomes a person may resubmit. A clean or overridden job is done. */
    private const RETRYABLE_SCAN_STATUSES = ['failed', 'quarantined'];

    /** Restrictions that stop a record being shared or exported at all. */
    private const BLOCKING_RESTRICTIONS = ['all_processing', 'sharing', 'export'];

    /** A restriction still in force, or under review and therefore still in force. */
    private const LIVE_RESTRICTION_STATUSES = ['active', 'review_due'];

    /**
     * Whether a stored receipt still matches the audit row it was written for.
     *
     * Anything that is not a recognisable receipt naming the same event and the
     * same hash counts as a mismatch rather than as absent: a file that is there
     * but wrong is the more serious finding.
     *
     * @param mixed $body the decoded receipt JSON
     */
    public static function auditReceiptBodyStatus(mixed $body, int $eventId, string $eventHash): string
    {
        if (!is_array($body)) {
            return 'mismatch';
        }

        return ($body['auditEventId'] ?? null) === $eventId && ($body['eventHash'] ?? null) === $eventHash
            ? 'verified'
            : 'mismatch';
    }

    public static function scanRetryAllowed(string $status): bool
    {
        return in_array($status, self::RETRYABLE_SCAN_STATUSES, true);
    }

    /**
     * A Regulation 28 notification that does not need sending still needs its
     * decision recorded, so the two outcomes are told apart.
     */
    public static function notificationStatusForDecision(string $decision): string
    {
        return in_array($decision, ['same_authority_exempt', 'not_required'], true)
            ? 'exempt'
            : 'decision_recorded';
    }

    /**
     * Whether a live processing restriction stops this record being shared.
     *
     * A restriction under review counts as in force: the point of a restriction
     * is that the data does not move while the question is open.
     *
     * @param array<int, array{restrictionType: string, status: string}> $restrictions
     */
    public static function blocksSharing(array $restrictions): bool
    {
        foreach ($restrictions as $restriction) {
            if (in_array($restriction['status'], self::LIVE_RESTRICTION_STATUSES, true)
                && in_array($restriction['restrictionType'], self::BLOCKING_RESTRICTIONS, true)) {
                return true;
            }
        }

        return false;
    }
}
