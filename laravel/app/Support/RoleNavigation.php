<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Which workspace paths a role sees, mirroring
 * client/src/lib/roleNavigation.ts and server/services/roleDefinitions.ts.
 *
 * The sidebar asks the server rather than working this out from the role name,
 * because an administrator-defined role can narrow the menu. Navigation is a
 * convenience, not a control: every path behind it still checks its own
 * capability, so hiding an entry never stands in for a permission.
 */
final class RoleNavigation
{
    /** @var array<int, string> */
    private const ALL_BUSINESS_PATHS = [
        '/', '/properties', '/workforce', '/access-control', '/manager-app', '/staff', '/placements',
        '/rota', '/rota-controls', '/compliance-dashboard', '/compliance', '/governance', '/work-plans',
        '/finance', '/documents', '/assurance', '/quality-reviews', '/regulation-28', '/care',
        '/safeguarding', '/keyworker-app', '/nominated-individual', '/role-management',
    ];

    /** @return array<int, string> */
    public static function pathsFor(?string $role): array
    {
        if ($role === null) {
            return [];
        }

        return match ($role) {
            // The platform administrator account in the test environment holds an
            // explicit owner membership, so it keeps the operational view.
            'platform_admin', 'owner' => self::ALL_BUSINESS_PATHS,
            'registered_manager' => array_values(array_diff(
                self::ALL_BUSINESS_PATHS,
                ['/access-control', '/rota-controls', '/nominated-individual', '/role-management'],
            )),
            'support_worker' => ['/keyworker-app', '/properties', '/care', '/staff'],
            'hr_compliance' => [
                '/', '/properties', '/workforce', '/staff', '/rota', '/compliance-dashboard',
                '/compliance', '/governance', '/documents', '/assurance', '/quality-reviews', '/regulation-28',
            ],
            'finance' => ['/', '/properties', '/compliance-dashboard', '/compliance', '/finance', '/documents'],
            'read_only' => ['/', '/properties', '/workforce', '/rota', '/compliance-dashboard', '/compliance', '/documents'],
            default => [],
        };
    }

    /**
     * Keeps only capabilities this system actually knows about, so a stale or
     * hand-edited column cannot grant something unnamed.
     *
     * @return array<int, string>
     */
    public static function cleanCapabilityList(mixed $value): array
    {
        $value = is_string($value) ? json_decode($value, true) : $value;
        if (!is_array($value)) {
            return [];
        }

        $clean = [];
        foreach ($value as $item) {
            if (is_string($item) && in_array($item, Authz::ALL_CAPABILITIES, true) && !in_array($item, $clean, true)) {
                $clean[] = $item;
            }
        }
        sort($clean);

        return $clean;
    }

    /** @return array<int, string>|null */
    public static function cleanPathList(mixed $value): ?array
    {
        $value = is_string($value) ? json_decode($value, true) : $value;
        if (!is_array($value)) {
            return null;
        }

        $clean = [];
        foreach ($value as $item) {
            if (is_string($item) && !in_array($item, $clean, true)) {
                $clean[] = $item;
            }
        }
        sort($clean);

        return $clean;
    }

    /**
     * The capabilities a custom role actually grants: its base role, plus what
     * it adds, minus what it removes.
     *
     * @param array<int, string> $granted
     * @param array<int, string> $denied
     * @return array<int, string>
     */
    public static function effectiveCapabilities(string $baseRole, array $granted, array $denied): array
    {
        $capabilities = Authz::capabilitiesFor($baseRole);

        foreach ($granted as $capability) {
            if (!in_array($capability, $capabilities, true)) {
                $capabilities[] = $capability;
            }
        }

        $capabilities = array_values(array_diff($capabilities, $denied));
        sort($capabilities);

        return $capabilities;
    }

    /**
     * A custom role may set its own menu; otherwise it shows its base role's.
     *
     * @param array<int, string>|null $visiblePaths
     * @return array<int, string>
     */
    public static function effectivePaths(string $baseRole, ?array $visiblePaths): array
    {
        return $visiblePaths ?? self::pathsFor($baseRole);
    }
}
