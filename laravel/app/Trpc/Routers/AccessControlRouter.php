<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\AccessRules;
use App\Support\Audit;
use App\Support\Authz;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * accessControl.*, mirroring server/routers/accessControl.ts.
 *
 * Who is in a company, what they may reach, and the support contact staff are
 * given when they cannot get in.
 */
final class AccessControlRouter
{
    public static function register(Registry $registry): void
    {
        $registry->query('accessControl.workspace', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertAdmin($ctx, $input);

            $entity = DB::table('entities')->where('id', $entityId)
                ->first(['supportContactName', 'supportEmail', 'supportPhone', 'supportGuidance']);

            $members = DB::table('entityMemberships as m')
                ->join('users as u', 'u.id', '=', 'm.userId')
                ->leftJoin('localAuthCredentials as c', 'c.userId', '=', 'u.id')
                ->where('m.entityId', $entityId)
                ->orderBy('u.name')
                ->select([
                    'm.id', 'm.userId', 'm.operationalRole as role', 'm.allProperties', 'm.extraCapabilities',
                    'm.status', 'm.startsAt', 'm.endsAt', 'm.updatedAt',
                    'u.name', 'u.email', 'u.accountStatus',
                    'c.userId as localCredentialUserId',
                ])->get();

            $grants = [];
            foreach (DB::table('propertyAssignments')->where('entityId', $entityId)
                ->select(['userId', 'propertyId', 'assignmentType'])->get() as $grant) {
                $grants[(int) $grant->userId][] = [
                    'propertyId' => (int) $grant->propertyId,
                    'assignmentType' => $grant->assignmentType,
                ];
            }

            $profiles = [];
            foreach (DB::table('staffProfiles')->where('entityId', $entityId)
                ->whereNotNull('userId')->select(['userId', 'jobTitle', 'status as staffStatus'])->get() as $profile) {
                $profiles[(int) $profile->userId] = (array) $profile;
            }

            return [
                'roles' => array_map(
                    static fn (string $value) => ['value' => $value, 'label' => AccessRules::ROLE_LABELS[$value]],
                    AccessRules::MANAGEABLE_ROLES,
                ),
                'capabilities' => array_map(
                    static fn (string $value) => ['value' => $value, 'label' => AccessRules::CAPABILITY_LABELS[$value]],
                    AccessRules::MANAGEABLE_CAPABILITIES,
                ),
                'supportContact' => $entity === null
                    ? ['supportContactName' => null, 'supportEmail' => null, 'supportPhone' => null, 'supportGuidance' => null]
                    : (array) $entity,
                'properties' => DB::table('properties')->where('entityId', $entityId)->orderBy('name')
                    ->select(['id', 'name', 'addressLine1', 'postcode', 'status'])->get()
                    ->map(static fn ($r) => (array) $r)->all(),
                'members' => $members->map(static function ($row) use ($grants, $profiles): array {
                    $member = (array) $row;
                    // Whether somebody can actually sign in, rather than only
                    // whether they hold a membership.
                    $member['hasLocalCredential'] = $row->localCredentialUserId !== null;
                    unset($member['localCredentialUserId']);
                    $member['allProperties'] = (int) $row->allProperties === 1;
                    $member['extraCapabilities'] = AccessRules::normaliseManaged(
                        is_string($row->extraCapabilities) ? (json_decode($row->extraCapabilities, true) ?? []) : ($row->extraCapabilities ?? [])
                    );
                    $member['propertyGrants'] = $grants[(int) $row->userId] ?? [];
                    $member['staffProfile'] = $profiles[(int) $row->userId] ?? null;

                    return $member;
                })->all(),
            ];
        });

        $registry->mutation('accessControl.updateSupportContact', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertAdmin($ctx, $input);

            $name = self::blankToNull($input['supportContactName'] ?? null, 'supportContactName', 180);
            $email = ($input['supportEmail'] ?? '') === '' ? null : Validate::email($input['supportEmail']);
            $phone = self::blankToNull($input['supportPhone'] ?? null, 'supportPhone', 40);
            $guidance = self::blankToNull($input['supportGuidance'] ?? null, 'supportGuidance', 1200);

            // This contact is what a worker locked out of the system is told to
            // use, so it cannot be left with no way to reach anybody.
            if ($email === null && $phone === null) {
                throw TrpcException::badRequest(
                    'Add at least a support email address or telephone number so users have a clear route for help.'
                );
            }

            DB::table('entities')->where('id', $entityId)->update([
                'supportContactName' => $name,
                'supportEmail' => $email,
                'supportPhone' => $phone,
                'supportGuidance' => $guidance,
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'access_control.support_contact.update',
                'resourceType' => 'entity',
                'resourceId' => $entityId,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'metadata' => [
                    'hasSupportEmail' => $email !== null,
                    'hasSupportPhone' => $phone !== null,
                    'hasGuidance' => $guidance !== null,
                ],
            ]);

            return ['success' => true];
        });

        $registry->mutation('accessControl.updateMemberAccess', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertAdmin($ctx, $input);
            $targetUserId = Validate::id($input['targetUserId'] ?? null, 'targetUserId');
            $role = Validate::enum($input['role'] ?? null, AccessRules::MANAGEABLE_ROLES, 'role');
            $allProperties = Validate::bool($input['allProperties'] ?? null, 'allProperties');
            $reason = AccessRules::requireMeaningfulReason(Validate::string($input['reason'] ?? null, 'reason', 20, 1200));

            $membership = DB::table('entityMemberships')
                ->where('entityId', $entityId)->where('userId', $targetUserId)->first();

            if ($membership === null) {
                throw TrpcException::badRequest(
                    'This Key Worker is not an active member of the selected company. Add or reactivate their company membership first.'
                );
            }
            if ($membership->status !== 'active') {
                throw TrpcException::conflict('This member is not active. Reactivate their membership before changing access.');
            }

            // Removing your own administrator role would leave you unable to put
            // it back.
            if ($ctx->userId() === $targetUserId && $membership->operationalRole === 'owner' && $role !== 'owner') {
                throw TrpcException::forbidden(
                    'You cannot remove your own company administrator role. Ask another company administrator to make this change.'
                );
            }

            $activeOwners = DB::table('entityMemberships')
                ->where('entityId', $entityId)->where('operationalRole', 'owner')->where('status', 'active')
                ->count();

            if (!AccessRules::canRemoveOwner((string) $membership->operationalRole, $role, $activeOwners)) {
                throw TrpcException::conflict(
                    'This is the last active company administrator. Assign another active administrator before changing this role.'
                );
            }

            // An administrator always reaches every property and needs no extra
            // capabilities, so those inputs are ignored rather than stored.
            $nextAllProperties = $role === 'owner' ? true : $allProperties;
            $nextExtras = $role === 'owner' ? [] : AccessRules::normaliseManaged(
                Validate::arrayOf($input['extraCapabilities'] ?? [], 'extraCapabilities', count(AccessRules::MANAGEABLE_CAPABILITIES))
            );

            $nextPropertyIds = [];
            if (!$nextAllProperties) {
                foreach (Validate::arrayOf($input['propertyIds'] ?? [], 'propertyIds', 250) as $index => $propertyId) {
                    $id = Validate::id($propertyId, "propertyIds.$index");
                    if (!in_array($id, $nextPropertyIds, true)) {
                        $nextPropertyIds[] = $id;
                    }
                }
                sort($nextPropertyIds);

                if ($nextPropertyIds === []) {
                    throw TrpcException::badRequest('Select at least one property or enable access to all company properties.');
                }

                // Every named property must belong to this company, or a grant
                // here would reach into another one.
                $found = DB::table('properties')->where('entityId', $entityId)->whereIn('id', $nextPropertyIds)->count();
                if ($found !== count($nextPropertyIds)) {
                    throw TrpcException::badRequest(
                        'One or more selected properties do not belong to this company. Refresh the page and select authorised properties only.'
                    );
                }
            }

            $previousPropertyIds = DB::table('propertyAssignments')
                ->where('entityId', $entityId)->where('userId', $targetUserId)
                ->pluck('propertyId')->map(static fn ($id) => (int) $id)->all();
            sort($previousPropertyIds);

            $previous = [
                'role' => $membership->operationalRole,
                'allProperties' => (int) $membership->allProperties === 1,
                'extraCapabilities' => AccessRules::normaliseManaged(
                    is_string($membership->extraCapabilities) ? (json_decode($membership->extraCapabilities, true) ?? []) : ($membership->extraCapabilities ?? [])
                ),
                'propertyIds' => $previousPropertyIds,
            ];

            DB::transaction(static function () use ($ctx, $entityId, $targetUserId, $membership, $role, $nextAllProperties, $nextExtras, $nextPropertyIds): void {
                DB::table('entityMemberships')->where('id', $membership->id)->update([
                    'operationalRole' => $role,
                    'allProperties' => $nextAllProperties ? 1 : 0,
                    'extraCapabilities' => json_encode($nextExtras, JSON_UNESCAPED_SLASHES),
                ]);

                // Grants are replaced rather than merged, so what is shown on
                // screen is exactly what is stored.
                DB::table('propertyAssignments')
                    ->where('entityId', $entityId)->where('userId', $targetUserId)->delete();

                foreach ($nextPropertyIds as $propertyId) {
                    DB::table('propertyAssignments')->insert([
                        'entityId' => $entityId,
                        'propertyId' => $propertyId,
                        'userId' => $targetUserId,
                        'assignmentType' => AccessRules::propertyAssignmentTypeFor($role),
                        'createdBy' => $ctx->userId(),
                    ]);
                }
            });

            $next = [
                'role' => $role,
                'allProperties' => $nextAllProperties,
                'extraCapabilities' => $nextExtras,
                'propertyIds' => $nextPropertyIds,
            ];

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'access_control.member.update',
                'resourceType' => 'entity_membership',
                'resourceId' => (int) $membership->id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'reasonCode' => 'company_admin_access_change',
                // Both sides of the change are recorded, so an access review can
                // see what somebody used to be able to reach.
                'metadata' => ['targetUserId' => $targetUserId, 'reason' => $reason, 'previous' => $previous, 'next' => $next],
            ]);

            return ['success' => true, 'next' => $next];
        });
    }

    private static function assertAdmin(Context $ctx, mixed $input): int
    {
        $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
        Authz::assertEntityCapability($ctx->userId(), $entityId, 'config.write');

        return $entityId;
    }

    private static function blankToNull(mixed $value, string $field, int $max): ?string
    {
        if (!is_string($value) || trim($value) === '') {
            return null;
        }

        return Validate::string($value, $field, 1, $max);
    }
}
