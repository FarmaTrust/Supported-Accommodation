<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\CareRules;
use PHPUnit\Framework\TestCase;

/**
 * Escalation must not be left entirely to the worker filling in the form. These
 * check the outcomes that raise one on their own, and that a worker can always
 * raise one the rules would not have.
 */
final class CareRulesTest extends TestCase
{
    public function test_a_reading_outside_the_expected_range_escalates_on_its_own(): void
    {
        $this->assertTrue(CareRules::healthEscalationRequired('outside_expected'));
        $this->assertFalse(CareRules::healthEscalationRequired('within_expected'));
    }

    public function test_a_medicine_not_taken_escalates_on_its_own(): void
    {
        foreach (['refused', 'omitted', 'unavailable'] as $outcome) {
            $this->assertTrue(CareRules::medicationEscalationRequired($outcome), $outcome);
        }

        // Asleep and away are recorded, not escalated: they are expected gaps.
        $this->assertFalse(CareRules::medicationEscalationRequired('taken'));
        $this->assertFalse(CareRules::medicationEscalationRequired('asleep'));
        $this->assertFalse(CareRules::medicationEscalationRequired('away'));
    }

    public function test_a_young_person_who_did_not_come_home_escalates_on_its_own(): void
    {
        $this->assertTrue(CareRules::curfewEscalationRequired('absent'));
        $this->assertFalse(CareRules::curfewEscalationRequired('late'));
        $this->assertFalse(CareRules::curfewEscalationRequired('met'));
    }

    public function test_a_worker_can_always_raise_an_escalation_the_rules_would_not(): void
    {
        $this->assertTrue(CareRules::healthEscalationRequired('within_expected', true));
        $this->assertTrue(CareRules::medicationEscalationRequired('taken', true));
        $this->assertTrue(CareRules::curfewEscalationRequired('met', true));
    }

    public function test_a_medication_record_cannot_be_signed_off_by_its_author(): void
    {
        $this->assertFalse(CareRules::canManagerAcknowledgeMedication('registered_manager', 7, 7));
        $this->assertTrue(CareRules::canManagerAcknowledgeMedication('registered_manager', 7, 8));

        // A worker cannot sign one off at all, whoever wrote it.
        $this->assertFalse(CareRules::canManagerAcknowledgeMedication('support_worker', 7, 8));
    }

    public function test_an_activity_needs_acknowledgement_only_until_it_has_one(): void
    {
        $this->assertTrue(CareRules::scheduledActivityNeedsAcknowledgement(true, null));
        $this->assertFalse(CareRules::scheduledActivityNeedsAcknowledgement(true, 1789000000000));
        $this->assertFalse(CareRules::scheduledActivityNeedsAcknowledgement(false, null));
    }
}
