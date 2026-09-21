<?php

declare(strict_types=1);

namespace App\Support;

use App\Trpc\TrpcException;

/**
 * What a company administrator may hand out, mirroring
 * server/services/rbacRules.ts.
 *
 * Deliberately narrower than the full capability list: an administrator manages
 * packs, compliance, documents, supervision and self-service. The capabilities
 * that reach safeguarding records, staff files and money are set by the role
 * itself and are not on this menu.
 */
final class AccessRules
{
    /** @var array<int, string> */
    public const MANAGEABLE_ROLES = [
        'owner', 'registered_manager', 'support_worker', 'hr_compliance', 'finance', 'read_only',
    ];

    /** @var array<int, string> */
    public const MANAGEABLE_CAPABILITIES = [
        'pack.read', 'pack.write', 'compliance.read', 'compliance.write',
        'document.read', 'document.write', 'supervision.read', 'staff.self_service',
    ];

    /** @var array<string, string> */
    public const ROLE_LABELS = [
        'owner' => 'Company administrator',
        'registered_manager' => 'Registered manager',
        'support_worker' => 'Key Worker / support worker',
        'hr_compliance' => 'HR & compliance',
        'finance' => 'Finance',
        'read_only' => 'Read only',
    ];

    /** @var array<string, string> */
    public const CAPABILITY_LABELS = [
        'pack.read' => 'View provider and authority packs',
        'pack.write' => 'Create and update provider and authority packs',
        'compliance.read' => 'View compliance registers and alerts',
        'compliance.write' => 'Manage compliance records and renewals',
        'document.read' => 'View authorised documents',
        'document.write' => 'Upload and manage authorised documents',
        'supervision.read' => 'View supervision records',
        'staff.self_service' => 'Use personal staff self-service workflows',
    ];

    public static function propertyAssignmentTypeFor(string $role): string
    {
        return match ($role) {
            'registered_manager' => 'manager',
            'support_worker' => 'worker',
            'hr_compliance' => 'compliance',
            'finance' => 'finance',
            default => 'viewer',
        };
    }

    /**
     * Keeps only capabilities on the manageable list, so a crafted request
     * cannot grant one that is not on the menu.
     *
     * @param array<int, mixed> $capabilities
     * @return array<int, string>
     */
    public static function normaliseManaged(array $capabilities): array
    {
        $clean = [];
        foreach ($capabilities as $capability) {
            if (is_string($capability)
                && in_array($capability, self::MANAGEABLE_CAPABILITIES, true)
                && !in_array($capability, $clean, true)) {
                $clean[] = $capability;
            }
        }
        sort($clean);

        return $clean;
    }

    /**
     * An access change is a decision somebody may have to answer for later, so
     * the reason has to say something.
     */
    public static function requireMeaningfulReason(string $reason): string
    {
        if (strlen(trim($reason)) < 20) {
            throw TrpcException::badRequest(
                'Enter a clear access-change reason of at least 20 characters so the audit trail explains the decision.'
            );
        }

        return trim($reason);
    }

    /**
     * A company always keeps at least one administrator. Without this a
     * workspace can be left with nobody able to grant access back.
     */
    public static function canRemoveOwner(string $currentRole, string $nextRole, int $activeOwnerCount): bool
    {
        return !($currentRole === 'owner' && $nextRole !== 'owner' && $activeOwnerCount <= 1);
    }
}
