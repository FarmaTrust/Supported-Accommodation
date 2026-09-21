<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\WorkspacePolicy;
use App\Trpc\TrpcException;
use PHPUnit\Framework\TestCase;

/**
 * The workflow state machines decide what a manager may do to a record next:
 * whether a returned report can go straight to approved, whether a closed
 * investigation can be reopened. Rather than comparing tables by eye, the
 * fixture records what the Node guard actually permits for every state pair,
 * and this checks the PHP copy move by move in both directions.
 */
final class WorkspacePolicyTest extends TestCase
{
    /** @return array<string, mixed> */
    private function fixture(): array
    {
        $path = dirname(__DIR__, 3) . '/php/tests/fixture.json';
        if (!is_file($path)) {
            $this->markTestSkipped("No fixture at $path. Run: npx tsx php/tests/make-fixture.ts > php/tests/fixture.json");
        }

        return json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    }

    public function test_every_domain_in_the_node_source_exists_here(): void
    {
        $expected = array_keys($this->fixture()['workspaceTransitions']);
        $actual = WorkspacePolicy::domains();

        sort($expected);
        sort($actual);

        $this->assertSame($expected, $actual);
    }

    public function test_every_allowed_move_matches_the_node_source(): void
    {
        $checked = 0;

        foreach ($this->fixture()['workspaceTransitions'] as $domain => $states) {
            foreach ($states as $from => $allowed) {
                $actual = WorkspacePolicy::allowedTransitions($domain, $from);
                sort($allowed);
                sort($actual);

                $this->assertSame($allowed, $actual, "Allowed moves differ for $domain from \"$from\"");
                $checked++;
            }
        }

        $this->assertGreaterThan(50, $checked, 'the fixture should cover every state of every domain');
    }

    public function test_a_move_the_node_source_refuses_is_refused_here(): void
    {
        foreach ($this->fixture()['workspaceTransitions'] as $domain => $states) {
            $allStates = array_keys($states);

            foreach ($states as $from => $allowed) {
                foreach (array_diff($allStates, $allowed) as $refused) {
                    try {
                        WorkspacePolicy::assertTransition($domain, $from, $refused);
                        $this->fail("$domain allowed a move from \"$from\" to \"$refused\" that the Node source refuses");
                    } catch (TrpcException $error) {
                        $this->assertSame('CONFLICT', $error->trpcCode);
                    }
                }
            }
        }
    }

    public function test_a_terminal_state_allows_nothing(): void
    {
        // A locked report and a closed investigation are the end of the line;
        // reopening either has to start a new record.
        $this->assertSame([], WorkspacePolicy::allowedTransitions('report', 'locked'));
        $this->assertSame([], WorkspacePolicy::allowedTransitions('investigation', 'closed'));
        $this->assertSame([], WorkspacePolicy::allowedTransitions('staff_request', 'approved'));
    }

    public function test_an_unknown_domain_or_state_allows_nothing(): void
    {
        $this->assertSame([], WorkspacePolicy::allowedTransitions('not_a_domain', 'draft'));
        $this->assertSame([], WorkspacePolicy::allowedTransitions('report', 'not_a_state'));
    }

    public function test_a_version_mismatch_is_a_conflict_the_client_can_place(): void
    {
        WorkspacePolicy::assertExpectedVersion(3, 3);

        try {
            WorkspacePolicy::assertExpectedVersion(4, 3);
            $this->fail('a stale version should be refused');
        } catch (TrpcException $error) {
            $this->assertSame('CONFLICT', $error->trpcCode);
            $this->assertSame('record_version_conflict', $error->workspaceError['code']);
            $this->assertArrayHasKey('version', $error->workspaceError['fieldErrors']);
        }
    }

    public function test_nobody_reviews_their_own_record(): void
    {
        WorkspacePolicy::assertIndependentReviewer(7, 9);

        $this->expectException(TrpcException::class);
        WorkspacePolicy::assertIndependentReviewer(7, 7);
    }

    public function test_deposits_add_and_everything_else_subtracts(): void
    {
        $this->assertSame(25.0, WorkspacePolicy::signedAmount('deposit', 25.0));
        $this->assertSame(25.0, WorkspacePolicy::signedAmount('refund', 25.0));
        $this->assertSame(-25.0, WorkspacePolicy::signedAmount('withdrawal', 25.0));
        $this->assertSame(-25.0, WorkspacePolicy::signedAmount('purchase', 25.0));
        $this->assertSame(-25.0, WorkspacePolicy::signedAmount('adjustment', 25.0));
    }

    public function test_a_zero_or_negative_amount_is_refused(): void
    {
        foreach ([0.0, -1.0] as $amount) {
            try {
                WorkspacePolicy::signedAmount('deposit', $amount);
                $this->fail("an amount of $amount should be refused");
            } catch (TrpcException $error) {
                $this->assertSame('amount_invalid', $error->workspaceError['code']);
            }
        }
    }

    public function test_email_and_sms_are_reserved_for_urgent_alerts_with_a_live_provider(): void
    {
        $routine = WorkspacePolicy::notificationChannels(false, true, true);
        $this->assertTrue($routine['push']);
        $this->assertFalse($routine['email'], 'a routine alert must not leave the building');
        $this->assertFalse($routine['sms']);
        $this->assertFalse($routine['externalDeliveryPending']);

        $urgent = WorkspacePolicy::notificationChannels(true, true, true);
        $this->assertTrue($urgent['email']);
        $this->assertTrue($urgent['sms']);

        // An urgent alert with no provider is flagged as still owed rather than
        // being treated as delivered.
        $noProvider = WorkspacePolicy::notificationChannels(true, false, false);
        $this->assertFalse($noProvider['email']);
        $this->assertTrue($noProvider['externalDeliveryPending']);
    }

    public function test_a_notification_preview_names_nothing_confidential(): void
    {
        $preview = WorkspacePolicy::safeNotificationPreview('Safeguarding concern', 'Smoke House', true);

        $this->assertSame('Urgent action required', $preview['title']);
        $this->assertSame('Safeguarding concern at Smoke House. Open the Hub to view details.', $preview['body']);

        // The preview can appear on a lock screen, so it carries a category and
        // a building and nothing about a person.
        $this->assertStringNotContainsStringIgnoringCase('young person', $preview['body']);
        $this->assertStringContainsString('Open the Hub', $preview['body']);
    }

    public function test_clocking_in_away_from_site_has_to_say_why(): void
    {
        WorkspacePolicy::requireAttendanceOverride('on_site', null);

        foreach (['off_site', 'unavailable', 'manual'] as $state) {
            try {
                WorkspacePolicy::requireAttendanceOverride($state, '  ');
                $this->fail("$state without a reason should be refused");
            } catch (TrpcException $error) {
                $this->assertSame('override_reason_required', $error->workspaceError['code']);
            }
        }

        WorkspacePolicy::requireAttendanceOverride('off_site', 'Covering an appointment');
    }

    public function test_manager_role_check(): void
    {
        WorkspacePolicy::assertManagerRole('owner');
        WorkspacePolicy::assertManagerRole('registered_manager');

        $this->assertTrue(WorkspacePolicy::isManagerRole('owner'));
        $this->assertFalse(WorkspacePolicy::isManagerRole('support_worker'));
        $this->assertFalse(WorkspacePolicy::isManagerRole(null));

        $this->expectException(TrpcException::class);
        WorkspacePolicy::assertManagerRole('support_worker');
    }

    public function test_record_state_check_names_the_state_that_blocked_it(): void
    {
        WorkspacePolicy::assertRecordState('draft', ['draft', 'returned']);

        try {
            WorkspacePolicy::assertRecordState('locked', ['draft', 'returned']);
            $this->fail('a locked record should be refused');
        } catch (TrpcException $error) {
            $this->assertStringContainsString('locked', $error->getMessage());
            $this->assertSame('CONFLICT', $error->trpcCode);
        }
    }
}
