<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Sensitivity-aware access checks, mirroring server/services/workspaceGuards.ts.
 *
 * The staff workspace holds records of very different weight in one place: a
 * maintenance job sits beside a safeguarding disclosure and a resident's cash
 * balance. Rather than each procedure choosing a capability by hand, a record
 * declares how sensitive it is and the capability follows from that, so a new
 * procedure cannot accidentally check a weaker one.
 */
final class WorkspaceGuards
{
    /**
     * Records about one young person go through the placement check, which is
     * what confines a support worker to the people they are assigned to.
     *
     * @return array<string, mixed>
     */
    public static function assertSensitiveAccess(
        int $userId,
        int $entityId,
        string $sensitivity,
        string $mode = 'read',
        ?int $placementId = null,
    ): array {
        if ($placementId !== null && in_array($sensitivity, ['safeguarding', 'restricted', 'medication', 'finance'], true)) {
            $capability = match ($sensitivity) {
                'medication' => $mode === 'write' ? 'medication.write' : 'young_person.read',
                'finance' => $mode === 'write' ? 'resident_finance.write' : 'young_person.read',
                default => $mode === 'write' ? 'incident.write' : 'incident.read',
            };

            $access = Authz::assertPlacementCapability($userId, $placementId, $capability)['access'];

            if ($sensitivity === 'restricted') {
                WorkspacePolicy::assertManagerRole((string) $access['role']);
            }

            return $access;
        }

        $capability = match ($sensitivity) {
            'hr' => $mode === 'write' ? 'staff.write' : 'staff.sensitive',
            'finance', 'bank' => $mode === 'write' ? 'finance.write' : 'finance.read',
            'safeguarding', 'restricted' => $mode === 'write' ? 'incident.review' : 'incident.read',
            default => 'entity.read',
        };

        $access = Authz::assertEntityCapability($userId, $entityId, $capability);

        // Bank details and restricted records need a manager on top of the
        // capability, because the capability alone can be granted to a custom
        // role.
        if ($sensitivity === 'bank' || $sensitivity === 'restricted') {
            WorkspacePolicy::assertManagerRole((string) $access['role']);
        }

        return $access;
    }

    /**
     * Someone reading their own HR record needs self-service, not the wider
     * permission to read colleagues' records.
     *
     * @return array<string, mixed>
     */
    public static function assertHrAccess(int $userId, int $entityId, int $subjectUserId, string $mode = 'read'): array
    {
        if ($userId === $subjectUserId) {
            return Authz::assertEntityCapability($userId, $entityId, 'staff.self_service');
        }

        return self::assertSensitiveAccess($userId, $entityId, 'hr', $mode);
    }

    /**
     * A manager inside one company. Used where a capability alone is not enough
     * because the action reviews somebody else's work.
     *
     * @return array<string, mixed>
     */
    public static function assertManager(int $userId, int $entityId): array
    {
        $access = Authz::assertEntityCapability($userId, $entityId, 'staff.write');

        if (!WorkspacePolicy::isManagerRole($access['role'] ?? null)) {
            throw \App\Trpc\TrpcException::forbidden('Manager access required');
        }

        return $access;
    }

    /**
     * A placement reached through a property must actually belong to that
     * property, or a worker on shift at one house could open records belonging
     * to another.
     *
     * @return array{placement: array<string, mixed>, access: array<string, mixed>}
     */
    public static function assertPlacementScope(int $userId, int $entityId, int $propertyId, int $placementId, string $capability): array
    {
        $result = Authz::assertCurrentShiftPlacementCapability($userId, $placementId, $capability);

        if ((int) $result['placement']['entityId'] !== $entityId
            || (int) ($result['placement']['propertyId'] ?? 0) !== $propertyId) {
            throw \App\Trpc\TrpcException::forbidden('Placement scope does not match the selected property');
        }

        return $result;
    }
}
