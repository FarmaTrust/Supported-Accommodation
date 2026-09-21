<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Workflow rules for data-rights cases and regulatory regimes, mirroring
 * server/services/governanceRules.ts.
 *
 * A data-rights case is a statutory request — somebody asking for their records,
 * or asking that they be corrected or erased. The path it takes is what makes
 * the response defensible, so the moves are written out rather than left to
 * whichever procedure happens to set the status.
 */
final class GovernanceRules
{
    /** @var array<string, array<int, string>> */
    private const DATA_RIGHTS_TRANSITIONS = [
        'received' => ['identity_check', 'withdrawn'],
        'identity_check' => ['scoping', 'refused', 'withdrawn'],
        'scoping' => ['collecting', 'restricted', 'refused', 'withdrawn'],
        'collecting' => ['redacting', 'awaiting_approval', 'restricted', 'refused', 'withdrawn'],
        'redacting' => ['awaiting_approval', 'restricted', 'refused', 'withdrawn'],
        'restricted' => ['collecting', 'awaiting_approval', 'closed'],
        'ready' => ['delivered', 'restricted'],
        'delivered' => ['closed'],
        // An overdue case can rejoin the path at whatever stage it had reached,
        // so missing the deadline does not also mean starting again.
        'overdue' => [
            'collecting', 'redacting', 'awaiting_approval', 'ready',
            'delivered', 'restricted', 'refused', 'withdrawn',
        ],
    ];

    /** @var array<string, array<int, string>> */
    private const REGIME_TRANSITIONS = [
        'draft' => ['in_review', 'withdrawn'],
        'in_review' => ['approved', 'withdrawn'],
        'approved' => ['active', 'withdrawn'],
        'active' => ['superseded', 'withdrawn'],
    ];

    public static function dataRightsTransitionAllowed(string $from, string $to): bool
    {
        return in_array($to, self::DATA_RIGHTS_TRANSITIONS[$from] ?? [], true);
    }

    public static function regimeTransitionAllowed(string $from, string $to): bool
    {
        return in_array($to, self::REGIME_TRANSITIONS[$from] ?? [], true);
    }

    /** @return array<int, string> */
    public static function dataRightsStatuses(): array
    {
        return array_keys(self::DATA_RIGHTS_TRANSITIONS);
    }

    /** @return array<int, string> */
    public static function regimeStatuses(): array
    {
        return array_keys(self::REGIME_TRANSITIONS);
    }

    /**
     * Whether the person approving had no hand in writing what they are
     * approving. Any author matching the approver fails it, so a case worked on
     * by several people still needs someone outside that set.
     *
     * @param array<int, int|null> $authors
     */
    public static function independentlyApprovedBy(int $actorId, array $authors): bool
    {
        foreach ($authors as $author) {
            if ($author !== null && (int) $author === $actorId) {
                return false;
            }
        }

        return true;
    }

    public static function validObservationPeriod(int $periodStart, int $periodEnd): bool
    {
        return $periodEnd > $periodStart;
    }
}
