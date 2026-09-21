<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\AssuranceRules;
use PHPUnit\Framework\TestCase;

/**
 * The audit receipt is the second copy that makes a deleted audit row visible.
 * These pin the distinction the verifier depends on: a receipt that is absent
 * is a different finding from one that is present but wrong.
 */
final class AssuranceRulesTest extends TestCase
{
    public function test_a_receipt_naming_the_same_event_and_hash_verifies(): void
    {
        $body = ['schemaVersion' => 1, 'auditEventId' => 42, 'eventHash' => 'abc'];

        $this->assertSame('verified', AssuranceRules::auditReceiptBodyStatus($body, 42, 'abc'));
    }

    public function test_a_receipt_for_another_event_or_hash_is_a_mismatch(): void
    {
        $this->assertSame('mismatch', AssuranceRules::auditReceiptBodyStatus(['auditEventId' => 41, 'eventHash' => 'abc'], 42, 'abc'));
        $this->assertSame('mismatch', AssuranceRules::auditReceiptBodyStatus(['auditEventId' => 42, 'eventHash' => 'xyz'], 42, 'abc'));
    }

    public function test_anything_that_is_not_a_receipt_is_a_mismatch_not_an_absence(): void
    {
        // A file that is there but unreadable is the more serious finding, so it
        // must not be reported as merely missing.
        $this->assertSame('mismatch', AssuranceRules::auditReceiptBodyStatus(null, 42, 'abc'));
        $this->assertSame('mismatch', AssuranceRules::auditReceiptBodyStatus('not json', 42, 'abc'));
        $this->assertSame('mismatch', AssuranceRules::auditReceiptBodyStatus([], 42, 'abc'));
    }

    public function test_only_a_failed_or_quarantined_scan_can_be_resubmitted(): void
    {
        $this->assertTrue(AssuranceRules::scanRetryAllowed('failed'));
        $this->assertTrue(AssuranceRules::scanRetryAllowed('quarantined'));

        foreach (['queued', 'submitted', 'clean', 'overridden', 'cancelled'] as $status) {
            $this->assertFalse(AssuranceRules::scanRetryAllowed($status), $status);
        }
    }

    public function test_a_notification_that_is_not_needed_is_still_a_recorded_decision(): void
    {
        $this->assertSame('exempt', AssuranceRules::notificationStatusForDecision('same_authority_exempt'));
        $this->assertSame('exempt', AssuranceRules::notificationStatusForDecision('not_required'));
        $this->assertSame('decision_recorded', AssuranceRules::notificationStatusForDecision('notified'));
    }

    public function test_a_restriction_under_review_still_blocks_sharing(): void
    {
        $this->assertTrue(AssuranceRules::blocksSharing([['restrictionType' => 'sharing', 'status' => 'review_due']]));
        $this->assertTrue(AssuranceRules::blocksSharing([['restrictionType' => 'all_processing', 'status' => 'active']]));
        $this->assertTrue(AssuranceRules::blocksSharing([['restrictionType' => 'export', 'status' => 'active']]));
    }

    public function test_a_lifted_restriction_or_an_unrelated_one_does_not_block(): void
    {
        $this->assertFalse(AssuranceRules::blocksSharing([['restrictionType' => 'sharing', 'status' => 'lifted']]));
        $this->assertFalse(AssuranceRules::blocksSharing([['restrictionType' => 'marketing', 'status' => 'active']]));
        $this->assertFalse(AssuranceRules::blocksSharing([]));
    }
}
