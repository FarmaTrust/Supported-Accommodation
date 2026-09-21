<?php

declare(strict_types=1);

namespace App\Support;

use App\Trpc\TrpcException;

/**
 * Administrator-defined roles, mirroring server/services/roleDefinitions.ts.
 *
 * A defined role is a preset over a built-in one, never a replacement. It names
 * a base role, widens it with managed capabilities and narrows it with denials.
 * Every check in Authz still runs against the base role, so nothing defined here
 * can reach past what that role already allows: grants are bounded by the
 * managed list, denials only ever remove, and navigation can only be narrowed.
 *
 * Node throws a plain Error from validateCustomRole, which tRPC reports as an
 * internal error with the message attached. Here the same conditions raise
 * BAD_REQUEST, because every one of them is something the operator typed and
 * can fix.
 */
final class RoleDefinitions
{
    public static function slugify(string $name): string
    {
        $slug = strtolower(trim($name));
        $slug = trim((string) preg_replace('/[^a-z0-9]+/', '-', $slug), '-');
        $slug = substr($slug, 0, 120);

        if ($slug === '') {
            throw TrpcException::badRequest('Enter a role name that contains at least one letter or number.');
        }

        return $slug;
    }

    /**
     * Checks a definition before it is stored.
     *
     * @param array<int, string> $granted
     * @param array<int, string> $denied
     * @param array<int, string>|null $visiblePaths
     * @param string|null $builtInSlug set when editing one of the built-in rows, which may not change identity
     * @return array{name: string, slug: string, baseRole: string, grantedCapabilities: array<int, string>, deniedCapabilities: array<int, string>, visiblePaths: array<int, string>|null}
     */
    public static function validate(
        string $name,
        string $baseRole,
        array $granted,
        array $denied,
        ?array $visiblePaths,
        ?string $builtInSlug = null,
    ): array {
        $name = trim($name);
        if (strlen($name) < 2 || strlen($name) > 120) {
            throw TrpcException::badRequest('Role name must be between 2 and 120 characters.');
        }

        if (!in_array($baseRole, AccessRules::MANAGEABLE_ROLES, true)) {
            throw TrpcException::badRequest('Base role must be one of: ' . implode(', ', AccessRules::MANAGEABLE_ROLES));
        }

        // A built-in row's slug is its identity in Authz, so it cannot be moved
        // onto a different base.
        if ($builtInSlug !== null && $builtInSlug !== $baseRole) {
            throw TrpcException::badRequest('A built-in role cannot be re-based onto another role. Create a new role instead.');
        }

        // Without config.write on the company administrator, nobody could reach
        // this screen again to put it back.
        if ($builtInSlug === 'owner' && in_array('config.write', $denied, true)) {
            throw TrpcException::badRequest(
                'The company administrator must keep config.write, or no one could manage roles and access again.'
            );
        }

        foreach ($granted as $capability) {
            if (!in_array($capability, AccessRules::MANAGEABLE_CAPABILITIES, true)) {
                throw TrpcException::badRequest(
                    "\"$capability\" cannot be granted. Grantable capabilities: "
                    . implode(', ', AccessRules::MANAGEABLE_CAPABILITIES)
                );
            }
        }

        foreach ($denied as $capability) {
            if (!in_array($capability, Authz::ALL_CAPABILITIES, true)) {
                throw TrpcException::badRequest("\"$capability\" is not a known capability.");
            }
        }

        $overlap = array_values(array_intersect($granted, $denied));
        if ($overlap !== []) {
            throw TrpcException::badRequest(
                'Remove ' . implode(', ', $overlap) . ' from either the granted or the denied list — a denial always wins.'
            );
        }

        // Navigation may only be narrowed. A path the base role cannot reach
        // would render a menu entry that fails its permission check on click.
        $paths = $visiblePaths === null ? null : (RoleNavigation::cleanPathList($visiblePaths) ?? []);
        if ($paths !== null) {
            $basePaths = RoleNavigation::pathsFor($baseRole);
            $unreachable = array_values(array_diff($paths, $basePaths));

            if ($unreachable !== []) {
                throw TrpcException::badRequest(
                    implode(', ', $unreachable) . " is outside the $baseRole role's navigation. Pick a narrower page list."
                );
            }
            if ($paths === []) {
                throw TrpcException::badRequest(
                    'Select at least one page, or leave the page list unset to inherit the base role\'s navigation.'
                );
            }
        }

        return [
            'name' => $name,
            'slug' => $builtInSlug ?? self::slugify($name),
            'baseRole' => $baseRole,
            'grantedCapabilities' => RoleNavigation::cleanCapabilityList($granted, AccessRules::MANAGEABLE_CAPABILITIES),
            'deniedCapabilities' => RoleNavigation::cleanCapabilityList($denied),
            'visiblePaths' => $paths,
        ];
    }

    /**
     * What the preset changed relative to its base role, for the review screen.
     *
     * @param array<int, string> $granted
     * @param array<int, string> $denied
     * @return array{added: array<int, string>, removed: array<int, string>}
     */
    public static function capabilityDelta(string $baseRole, array $granted, array $denied): array
    {
        $base = Authz::capabilitiesFor($baseRole);

        $added = array_values(array_diff($granted, $base));
        $removed = array_values(array_intersect($denied, $base));
        sort($added);
        sort($removed);

        return ['added' => $added, 'removed' => $removed];
    }
}
