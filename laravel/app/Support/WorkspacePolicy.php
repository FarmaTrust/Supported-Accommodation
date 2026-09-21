<?php

declare(strict_types=1);

namespace App\Support;

use App\Trpc\TrpcException;

/**
 * Workflow rules for the staff workspace, mirroring
 * server/services/staffWorkspacePolicy.ts and
 * server/services/workspaceGuards.ts.
 *
 * Every record that a manager reviews moves through a state machine rather than
 * having its status set directly. Written out as data so the allowed moves can
 * be read, and tested, without following the procedure that performs them.
 *
 * Errors raised here carry a workspaceError alongside the message: the client
 * reads it to place the message against the field that caused it, rather than
 * showing a bare banner.
 */
final class WorkspacePolicy
{
    /** @var array<string, array<string, array<int, string>>> */
    private const TRANSITIONS = [
        'report' => [
            'draft' => ['submitted'],
            'submitted' => ['reviewed', 'returned', 'approved'],
            'reviewed' => ['returned', 'approved'],
            'returned' => ['submitted'],
            'approved' => ['locked'],
            'locked' => [],
        ],
        'incident' => [
            'pending' => ['in_review', 'returned', 'approved'],
            'in_review' => ['returned', 'approved', 'closed'],
            'returned' => ['in_review'],
            'approved' => ['closed'],
            'closed' => [],
        ],
        'property_check' => [
            'draft' => ['submitted'],
            'submitted' => ['reviewed', 'returned', 'closed'],
            'reviewed' => ['closed', 'returned'],
            'returned' => ['submitted'],
            'closed' => [],
        ],
        'maintenance' => [
            'reported' => ['triaged', 'cancelled'],
            'triaged' => ['assigned', 'scheduled', 'cancelled'],
            'assigned' => ['scheduled', 'in_progress', 'cancelled'],
            'scheduled' => ['in_progress', 'cancelled'],
            'in_progress' => ['completed', 'cancelled'],
            'completed' => ['verified', 'reopened'],
            'verified' => ['reopened'],
            'cancelled' => ['reopened'],
            'reopened' => ['triaged', 'assigned', 'in_progress'],
        ],
        'staff_request' => [
            'draft' => ['submitted', 'withdrawn'],
            'submitted' => ['approved', 'declined', 'returned', 'withdrawn'],
            'returned' => ['submitted', 'withdrawn'],
            'approved' => [],
            'declined' => [],
            'withdrawn' => [],
        ],
        'supervision' => [
            'scheduled' => ['draft', 'cancelled'],
            'draft' => ['submitted', 'cancelled'],
            'submitted' => ['acknowledged', 'completed'],
            'acknowledged' => ['completed'],
            'completed' => [],
            'cancelled' => [],
        ],
        'investigation' => [
            'open' => ['evidence_gathering', 'cancelled'],
            'evidence_gathering' => ['awaiting_response', 'review', 'action_plan', 'cancelled'],
            'awaiting_response' => ['evidence_gathering', 'review', 'action_plan'],
            'review' => ['evidence_gathering', 'action_plan', 'closed'],
            'action_plan' => ['review', 'closed'],
            'closed' => [],
            'cancelled' => [],
        ],
        'medication_discrepancy' => [
            'open' => ['under_review', 'action_required'],
            'under_review' => ['action_required', 'resolved'],
            'action_required' => ['under_review', 'resolved'],
            'resolved' => ['closed', 'under_review'],
            'closed' => [],
        ],
        'finance_transaction' => [
            'draft' => ['submitted'],
            'submitted' => ['approved', 'returned', 'reversed'],
            'returned' => ['submitted'],
            'approved' => ['reversed'],
            'reversed' => [],
        ],
        'finance_reconciliation' => [
            'draft' => ['submitted'],
            'submitted' => ['balanced', 'discrepancy', 'returned'],
            'returned' => ['submitted'],
            'balanced' => ['approved', 'returned'],
            'discrepancy' => ['returned', 'approved'],
            'approved' => [],
        ],
        'finance_discrepancy' => [
            'open' => ['under_review', 'action_required'],
            'under_review' => ['action_required', 'resolved'],
            'action_required' => ['under_review', 'resolved'],
            'resolved' => ['closed', 'under_review'],
            'closed' => [],
        ],
    ];

    /** @return array<int, string> */
    public static function allowedTransitions(string $domain, string $current): array
    {
        return self::TRANSITIONS[$domain][$current] ?? [];
    }

    /** @return array<int, string> */
    public static function domains(): array
    {
        return array_keys(self::TRANSITIONS);
    }

    public static function assertTransition(string $domain, string $current, string $next): void
    {
        if (!in_array($next, self::allowedTransitions($domain, $current), true)) {
            throw self::fieldError(
                'workflow_transition_invalid',
                'status',
                'Invalid ' . str_replace('_', ' ', $domain) . " transition from $current to $next",
                'CONFLICT',
            );
        }
    }

    /**
     * Optimistic locking. Two people editing the same record on two devices
     * would otherwise have the second silently overwrite the first.
     */
    public static function assertExpectedVersion(int $actual, int $expected): void
    {
        if ($actual !== $expected) {
            throw self::fieldError(
                'record_version_conflict',
                'version',
                'This record changed on another device. Refresh before trying again.',
                'CONFLICT',
            );
        }
    }

    /** Nobody reviews their own record; that is the point of the review. */
    public static function assertIndependentReviewer(?int $createdBy, int $reviewerUserId): void
    {
        if ($createdBy === $reviewerUserId) {
            throw self::fieldError(
                'independent_reviewer_required',
                'reviewer',
                'A different Manager must complete this review.',
                'FORBIDDEN',
            );
        }
    }

    /** Deposits and refunds add to a resident's balance; everything else takes from it. */
    public static function signedAmount(string $type, float $amount): float
    {
        if (!is_finite($amount) || $amount <= 0) {
            throw self::fieldError('amount_invalid', 'amount', 'Amount must be greater than zero.');
        }

        return in_array($type, ['deposit', 'refund'], true) ? $amount : -$amount;
    }

    /**
     * Which channels an alert goes out on. Email and SMS are reserved for
     * urgent alerts and only when a provider is actually connected.
     *
     * @return array<string, bool>
     */
    public static function notificationChannels(bool $urgent, bool $providerEmailActive, bool $providerSmsActive): array
    {
        return [
            'push' => true,
            'email' => $urgent && $providerEmailActive,
            'sms' => $urgent && $providerSmsActive,
            'externalDeliveryPending' => $urgent && (!$providerEmailActive || !$providerSmsActive),
        ];
    }

    /**
     * The text that leaves the building. A push or SMS preview can appear on a
     * lock screen, so it names the category and the property and nothing about
     * the young person or the incident.
     *
     * @return array{title: string, body: string}
     */
    public static function safeNotificationPreview(string $category, ?string $propertyLabel, bool $urgent): array
    {
        return [
            'title' => $urgent ? 'Urgent action required' : 'Action required',
            'body' => $category . ($propertyLabel !== null && $propertyLabel !== '' ? " at $propertyLabel" : '')
                . '. Open the Hub to view details.',
        ];
    }

    /** @param array<int, string> $allowed */
    public static function assertRecordState(string $status, array $allowed, string $field = 'status'): void
    {
        if (!in_array($status, $allowed, true)) {
            throw self::fieldError(
                'record_state_invalid',
                $field,
                "This action is not available while the record is $status.",
                'CONFLICT',
            );
        }
    }

    public static function assertManagerRole(string $role): void
    {
        if ($role !== 'owner' && $role !== 'registered_manager') {
            throw self::fieldError('manager_required', 'role', 'Manager access is required for this action.', 'FORBIDDEN');
        }
    }

    public static function isManagerRole(?string $role): bool
    {
        return $role === 'owner' || $role === 'registered_manager';
    }

    /**
     * Clocking in from anywhere other than on site has to say why, so an
     * attendance record cannot quietly become unverifiable.
     */
    public static function requireAttendanceOverride(string $locationState, ?string $overrideReason): void
    {
        if ($locationState !== 'on_site' && trim((string) $overrideReason) === '') {
            throw self::fieldError(
                'override_reason_required',
                'overrideReason',
                'An off-site, manual or unavailable location requires a reason.',
            );
        }
    }

    /**
     * An error the client can attach to one field. The shape matches the
     * errorFormatter in server/_core/trpc.ts.
     */
    public static function fieldError(string $code, string $field, string $message, string $trpcCode = 'BAD_REQUEST'): TrpcException
    {
        return new TrpcException($trpcCode, $message, [
            'code' => $code,
            'fieldErrors' => [$field => [$message]],
        ]);
    }
}
