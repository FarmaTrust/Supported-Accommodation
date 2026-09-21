<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\Authz;
use PHPUnit\Framework\TestCase;

/**
 * The capability matrix decides who may read a safeguarding record and who may
 * issue an invoice, so it is compared against the sets exported from
 * server/authz.ts rather than against a reading of the source. A capability
 * added on one side and missed on the other fails here.
 */
final class AuthzMatrixTest extends TestCase
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

    public function test_the_capability_list_matches_the_node_source(): void
    {
        $expected = $this->fixture()['allCapabilities'];

        sort($expected);
        $actual = Authz::ALL_CAPABILITIES;
        sort($actual);

        $this->assertSame($expected, $actual);
    }

    public function test_every_role_grants_exactly_what_the_node_source_grants(): void
    {
        foreach ($this->fixture()['roleCapabilities'] as $role => $expected) {
            $actual = Authz::capabilitiesFor($role);
            sort($actual);
            sort($expected);

            $this->assertSame($expected, $actual, "Capabilities differ for the \"$role\" role");
        }
    }

    public function test_an_unknown_role_grants_nothing(): void
    {
        $this->assertSame([], Authz::capabilitiesFor('not_a_role'));
        $this->assertFalse(Authz::roleHasCapability('not_a_role', 'entity.read'));
    }

    public function test_a_denial_beats_a_grant(): void
    {
        // Deny always wins, so an administrator-defined role can narrow a base
        // role but never widen it by accident.
        $this->assertFalse(
            Authz::capabilityAllowed('owner', 'finance.write', ['finance.write'], ['finance.write'])
        );
        $this->assertTrue(Authz::capabilityAllowed('owner', 'finance.write'));
    }

    public function test_an_extra_capability_can_add_to_a_base_role(): void
    {
        $this->assertFalse(Authz::capabilityAllowed('read_only', 'finance.write'));
        $this->assertTrue(Authz::capabilityAllowed('read_only', 'finance.write', ['finance.write']));
    }

    public function test_property_scope_needs_an_assignment_unless_the_role_is_broad(): void
    {
        $this->assertTrue(Authz::propertyScopeAllows('owner', false, [], 7), 'an owner reaches every property');
        $this->assertTrue(Authz::propertyScopeAllows('support_worker', true, [], 7), 'allProperties reaches every property');
        $this->assertTrue(Authz::propertyScopeAllows('support_worker', false, [7], 7), 'an assignment reaches its property');
        $this->assertFalse(Authz::propertyScopeAllows('support_worker', false, [8], 7), 'another property is refused');
        $this->assertFalse(Authz::propertyScopeAllows('read_only', false, [], 7), 'no assignment is refused');
    }

    public function test_platform_admin_is_confined_to_configuration(): void
    {
        // A platform administrator configures the workspace; it is deliberately
        // not a way into operational records.
        $this->assertTrue(Authz::roleHasCapability('platform_admin', 'config.write'));
        $this->assertFalse(Authz::roleHasCapability('platform_admin', 'young_person.read'));
        $this->assertFalse(Authz::roleHasCapability('platform_admin', 'staff.sensitive'));
    }

    public function test_support_workers_cannot_reach_finance_or_sensitive_staff_records(): void
    {
        $this->assertFalse(Authz::roleHasCapability('support_worker', 'finance.read'));
        $this->assertFalse(Authz::roleHasCapability('support_worker', 'staff.sensitive'));
        $this->assertFalse(Authz::roleHasCapability('support_worker', 'config.write'));
        $this->assertTrue(Authz::roleHasCapability('support_worker', 'young_person.write'));
    }

    public function test_read_only_grants_no_write_capability(): void
    {
        foreach (Authz::capabilitiesFor('read_only') as $capability) {
            $this->assertStringEndsNotWith('.write', $capability, "read_only must not grant $capability");
        }
    }
}
