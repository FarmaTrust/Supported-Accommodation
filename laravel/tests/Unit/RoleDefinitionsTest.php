<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\RoleDefinitions;
use App\Trpc\TrpcException;
use PHPUnit\Framework\TestCase;

/**
 * A defined role is a preset over a built-in one. The point of these checks is
 * that a preset can only ever narrow: it cannot grant a capability outside the
 * managed list, cannot show a page its base role could not reach, and cannot
 * take config.write off the company administrator, which would lock everybody
 * out of this screen for good.
 */
final class RoleDefinitionsTest extends TestCase
{
    /** @return array<string, mixed> */
    private function validate(array $overrides = []): array
    {
        return RoleDefinitions::validate(
            $overrides['name'] ?? 'Night manager',
            $overrides['baseRole'] ?? 'registered_manager',
            $overrides['granted'] ?? [],
            $overrides['denied'] ?? [],
            array_key_exists('visiblePaths', $overrides) ? $overrides['visiblePaths'] : null,
            $overrides['builtInSlug'] ?? null,
        );
    }

    public function test_a_role_name_becomes_its_slug(): void
    {
        $this->assertSame('night-manager', $this->validate()['slug']);
        $this->assertSame('a-b-c', RoleDefinitions::slugify('  A / B / C  '));
    }

    public function test_a_name_with_no_letters_or_numbers_is_refused(): void
    {
        $this->expectException(TrpcException::class);
        RoleDefinitions::slugify('///');
    }

    public function test_only_grantable_capabilities_can_be_granted(): void
    {
        $this->assertSame(['compliance.read'], $this->validate(['granted' => ['compliance.read']])['grantedCapabilities']);

        $this->expectExceptionMessageMatches('/cannot be granted/');
        $this->validate(['granted' => ['audit.read']]);
    }

    public function test_an_unknown_capability_cannot_be_denied(): void
    {
        $this->expectExceptionMessageMatches('/is not a known capability/');
        $this->validate(['denied' => ['nonsense.write']]);
    }

    public function test_a_capability_cannot_be_granted_and_denied_at_once(): void
    {
        $this->expectExceptionMessageMatches('/a denial always wins/');
        $this->validate(['granted' => ['compliance.read'], 'denied' => ['compliance.read']]);
    }

    public function test_the_company_administrator_keeps_config_write(): void
    {
        $this->expectExceptionMessageMatches('/no one could manage roles and access again/');
        $this->validate(['baseRole' => 'owner', 'builtInSlug' => 'owner', 'denied' => ['config.write']]);
    }

    public function test_a_built_in_role_cannot_be_re_based(): void
    {
        $this->expectExceptionMessageMatches('/cannot be re-based/');
        $this->validate(['baseRole' => 'finance', 'builtInSlug' => 'owner']);
    }

    public function test_navigation_can_be_narrowed_but_never_widened(): void
    {
        $narrowed = $this->validate(['baseRole' => 'finance', 'visiblePaths' => ['/finance', '/documents']]);
        $this->assertSame(['/documents', '/finance'], $narrowed['visiblePaths']);

        // Finance cannot reach safeguarding, so a menu entry for it would fail
        // its own permission check the moment somebody clicked it.
        $this->expectExceptionMessageMatches("/outside the finance role's navigation/");
        $this->validate(['baseRole' => 'finance', 'visiblePaths' => ['/safeguarding']]);
    }

    public function test_an_empty_page_list_is_refused_but_an_unset_one_inherits(): void
    {
        $this->assertNull($this->validate()['visiblePaths']);

        $this->expectExceptionMessageMatches('/Select at least one page/');
        $this->validate(['visiblePaths' => []]);
    }

    public function test_the_delta_reports_only_real_changes(): void
    {
        // read_only already has compliance.read, so granting it changes nothing,
        // and denying a capability it never had removes nothing.
        $delta = RoleDefinitions::capabilityDelta('read_only', ['compliance.read', 'document.write'], ['finance.write', 'document.read']);

        $this->assertSame(['document.write'], $delta['added']);
        $this->assertSame(['document.read'], $delta['removed']);
    }
}
