<?php

declare(strict_types=1);

namespace App\Support;

use App\Trpc\TrpcException;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Role and capability checks, mirroring server/authz.ts.
 *
 * Almost every procedure passes through here, so the shape is deliberately
 * plain: resolve what the user may do inside one company, decide, and record the
 * decision. Both the allow and the deny are written to the audit trail, because
 * an inspection needs to show who was refused as well as who was let in.
 */
final class Authz
{
    /** @var array<int, string> */
    public const ALL_CAPABILITIES = [
        'entity.read', 'entity.write', 'property.read', 'property.write', 'staff.read', 'staff.write',
        'staff.sensitive', 'young_person.read', 'young_person.write', 'shift.read', 'shift.write',
        'compliance.read', 'compliance.write', 'document.read', 'document.write', 'incident.read',
        'incident.write', 'incident.review', 'frontline.write', 'medication.write', 'resident_finance.write',
        'staff.self_service', 'supervision.read', 'finance.read', 'finance.write', 'finance.issue', 'pack.read',
        'pack.write', 'audit.read', 'data_rights.read', 'data_rights.write', 'analytics.read', 'analytics.write',
        'config.write',
    ];

    /** @var array<string, array<int, string>> */
    private const ROLE_CAPABILITIES = [
        'platform_admin' => ['config.write'],
        // Filled from ALL_CAPABILITIES in capabilitiesFor().
        'owner' => ['*'],
        'registered_manager' => [
            'entity.read', 'property.read', 'property.write', 'staff.read', 'staff.write', 'staff.sensitive',
            'young_person.read', 'young_person.write', 'shift.read', 'shift.write', 'compliance.read',
            'compliance.write', 'document.read', 'document.write', 'incident.read', 'incident.write',
            'incident.review', 'frontline.write', 'medication.write', 'resident_finance.write', 'staff.self_service',
            'supervision.read', 'finance.read', 'pack.read', 'pack.write', 'audit.read', 'data_rights.read',
            'data_rights.write', 'analytics.read', 'analytics.write',
        ],
        'support_worker' => [
            'property.read', 'young_person.read', 'young_person.write', 'shift.read', 'incident.read',
            'incident.write', 'frontline.write', 'medication.write', 'resident_finance.write', 'staff.self_service',
            'supervision.read', 'compliance.read', 'document.read',
        ],
        'hr_compliance' => [
            'entity.read', 'property.read', 'staff.read', 'staff.write', 'staff.sensitive', 'shift.read',
            'compliance.read', 'compliance.write', 'document.read', 'document.write', 'pack.read',
            'data_rights.read', 'data_rights.write', 'analytics.read',
        ],
        'finance' => [
            'entity.read', 'property.read', 'finance.read', 'finance.write', 'finance.issue', 'pack.read',
            'pack.write', 'document.read',
        ],
        'read_only' => [
            'entity.read', 'property.read', 'staff.read', 'shift.read', 'compliance.read', 'document.read',
            'finance.read',
        ],
    ];

    /** @return array<int, string> */
    public static function capabilitiesFor(string $role): array
    {
        $capabilities = self::ROLE_CAPABILITIES[$role] ?? [];

        return $capabilities === ['*'] ? self::ALL_CAPABILITIES : $capabilities;
    }

    public static function roleHasCapability(string $role, string $capability): bool
    {
        return in_array($capability, self::capabilitiesFor($role), true);
    }

    /**
     * A denial always wins, so an administrator-defined role can narrow a base
     * role without any chance of widening it by accident.
     *
     * @param array<int, string> $extraCapabilities
     * @param array<int, string> $deniedCapabilities
     */
    public static function capabilityAllowed(
        string $role,
        string $capability,
        array $extraCapabilities = [],
        array $deniedCapabilities = [],
    ): bool {
        if (in_array($capability, $deniedCapabilities, true)) {
            return false;
        }

        return self::roleHasCapability($role, $capability)
            || in_array($capability, $extraCapabilities, true);
    }

    /**
     * @param array<int, int> $assignedPropertyIds
     */
    public static function propertyScopeAllows(string $role, bool $allProperties, array $assignedPropertyIds, int $propertyId): bool
    {
        return $role === 'owner' || $allProperties || in_array($propertyId, $assignedPropertyIds, true);
    }

    public static function roleRequiresPlacementAssignment(string $role): bool
    {
        return $role === 'support_worker';
    }

    /**
     * The user's active memberships, with the capabilities their
     * administrator-defined role grants or removes.
     *
     * A custom role is read live, so editing one applies to every holder
     * immediately rather than needing each membership rewritten.
     *
     * @return array{user: array<string, mixed>, memberships: array<int, array<string, mixed>>}
     */
    public static function userAccess(int $userId): array
    {
        $row = Users::byId($userId);
        if ($row === null || $row['accountStatus'] !== 'active') {
            throw TrpcException::forbidden('Account is not active');
        }

        $user = Users::withResolvedRole($row);
        $now = Dates::nowMillis();

        $rows = DB::table('entityMemberships as m')
            ->leftJoin('roles as r', function ($join): void {
                $join->on('r.id', '=', 'm.roleId')->where('r.status', '=', 'active');
            })
            ->where('m.userId', $userId)
            ->where('m.status', 'active')
            ->where(fn ($q) => $q->whereNull('m.startsAt')->orWhere('m.startsAt', '<=', $now))
            ->where(fn ($q) => $q->whereNull('m.endsAt')->orWhere('m.endsAt', '>', $now))
            ->select([
                'm.*',
                'r.slug as customRoleSlug',
                'r.grantedCapabilities as customGranted',
                'r.deniedCapabilities as customDenied',
            ])
            ->get();

        $memberships = [];
        foreach ($rows as $membership) {
            $memberships[] = [
                'id' => (int) $membership->id,
                'entityId' => (int) $membership->entityId,
                'operationalRole' => $membership->operationalRole,
                'allProperties' => (int) $membership->allProperties === 1,
                'customRoleSlug' => $membership->customRoleSlug,
                // Managed grants from the membership and from its custom role, merged.
                'grantedCapabilities' => self::mergeStringLists($membership->extraCapabilities, $membership->customGranted),
                'deniedCapabilities' => self::mergeStringLists($membership->customDenied),
            ];
        }

        return ['user' => $user, 'memberships' => $memberships];
    }

    /**
     * Confirms the user may exercise a capability inside a company.
     *
     * @return array{role: string, allProperties: bool, customRoleSlug: string|null, entityId: int}
     */
    public static function assertEntityCapability(int $userId, int $entityId, string $capability): array
    {
        $access = self::userAccess($userId);

        $entity = DB::table('entities')->where('id', $entityId)->first('id');
        if ($entity === null) {
            self::recordDecision($userId, null, 'denied', "entity_missing:$capability", $entityId);
            throw TrpcException::forbidden('Entity access denied');
        }

        $membership = null;
        foreach ($access['memberships'] as $candidate) {
            if ($candidate['entityId'] === $entityId) {
                $membership = $candidate;
                break;
            }
        }

        if ($membership === null) {
            self::recordDecision($userId, $entityId, 'denied', "membership_missing:$capability", $entityId);
            throw TrpcException::forbidden('Entity access denied');
        }

        $role = (string) $membership['operationalRole'];
        $label = $membership['customRoleSlug'] !== null ? "{$membership['customRoleSlug']}($role)" : $role;

        if (!self::capabilityAllowed($role, $capability, $membership['grantedCapabilities'], $membership['deniedCapabilities'])) {
            self::recordDecision($userId, $entityId, 'denied', "role:$label:$capability", $entityId);
            throw TrpcException::forbidden('Action is outside your role');
        }

        self::recordDecision($userId, $entityId, 'allowed', "role:$label:$capability", $entityId);

        return [
            'role' => $role,
            'allProperties' => $membership['allProperties'],
            'customRoleSlug' => $membership['customRoleSlug'],
            'entityId' => $entityId,
        ];
    }

    /**
     * Confirms the user may exercise a capability against one property.
     *
     * @return array{role: string, allProperties: bool, customRoleSlug: string|null, entityId: int}
     */
    public static function assertPropertyCapability(int $userId, int $entityId, int $propertyId, string $capability): array
    {
        $access = self::assertEntityCapability($userId, $entityId, $capability);

        $property = DB::table('properties')
            ->where('id', $propertyId)
            ->where('entityId', $entityId)
            ->first('id');

        if ($property === null) {
            self::recordDecision($userId, $entityId, 'denied', "property_missing:$capability", $propertyId, 'property', $propertyId);
            throw TrpcException::notFound('Property not found');
        }

        if (self::propertyScopeAllows($access['role'], $access['allProperties'], [], $propertyId)) {
            self::recordDecision($userId, $entityId, 'allowed', "{$access['role']}:all_properties:$capability", $propertyId, 'property', $propertyId);

            return $access;
        }

        $grant = DB::table('propertyAssignments')
            ->where('propertyId', $propertyId)
            ->where('userId', $userId)
            ->first('propertyId');

        $assigned = $grant === null ? [] : [(int) $grant->propertyId];

        if (!self::propertyScopeAllows($access['role'], $access['allProperties'], $assigned, $propertyId)) {
            self::recordDecision($userId, $entityId, 'denied', "assignment_missing:$capability", $propertyId, 'property', $propertyId);
            throw TrpcException::forbidden('Property access denied');
        }

        self::recordDecision($userId, $entityId, 'allowed', "active_assignment:$capability", $propertyId, 'property', $propertyId);

        return $access;
    }

    /**
     * Every property id the user may reach inside a company with a capability.
     *
     * @return array<int, int>
     */
    public static function accessiblePropertyIds(int $userId, int $entityId, string $capability): array
    {
        $access = self::assertEntityCapability($userId, $entityId, $capability);

        if ($access['role'] === 'owner' || $access['allProperties']) {
            return DB::table('properties')->where('entityId', $entityId)->pluck('id')
                ->map(static fn ($id) => (int) $id)->all();
        }

        return DB::table('propertyAssignments')
            ->where('entityId', $entityId)
            ->where('userId', $userId)
            ->pluck('propertyId')
            ->map(static fn ($id) => (int) $id)->all();
    }

    /**
     * Merges JSON string lists, skipping anything that is not a string so a
     * malformed column cannot grant an unnamed capability.
     *
     * @return array<int, string>
     */
    private static function mergeStringLists(mixed ...$lists): array
    {
        $merged = [];

        foreach ($lists as $list) {
            if (is_string($list)) {
                $list = json_decode($list, true);
            }
            if (!is_array($list)) {
                continue;
            }
            foreach ($list as $item) {
                if (is_string($item) && !in_array($item, $merged, true)) {
                    $merged[] = $item;
                }
            }
        }

        return $merged;
    }

    /**
     * A permission decision that cannot be written must not stop the request:
     * the check itself already happened, and losing the request would turn an
     * audit outage into an outage of the whole service.
     */
    private static function recordDecision(
        int $userId,
        ?int $entityId,
        string $result,
        string $reasonCode,
        int|string $resourceId,
        string $resourceType = 'entity',
        ?int $propertyId = null,
    ): void {
        try {
            Audit::write([
                'actorUserId' => $userId,
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'action' => $resourceType === 'property' ? 'permission.property' : 'permission.entity',
                'resourceType' => $resourceType,
                'resourceId' => $resourceId,
                'result' => $result,
                'reasonCode' => $reasonCode,
            ]);
        } catch (Throwable $error) {
            report($error);
        }
    }
}
