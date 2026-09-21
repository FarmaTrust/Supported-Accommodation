<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\AccessRules;
use App\Support\Audit;
use App\Support\Authz;
use App\Support\Dates;
use App\Support\LocalAuth;
use App\Support\RoleDefinitions;
use App\Support\RoleNavigation;
use App\Support\Users;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * roleManagement.*, mirroring server/routers/roleManagement.ts.
 *
 * The screen a company administrator uses to decide who may do what: define a
 * role, edit one, retire one, create an account with its first membership, or
 * move somebody onto a different role.
 *
 * A defined role never widens past its base role — RoleDefinitions enforces that
 * — and the two rules that keep a company reachable are enforced here: a company
 * always keeps one active administrator, and nobody removes their own
 * administrator role.
 */
final class RoleManagementRouter
{
    /**
     * Every workspace page with the label the sidebar uses, so the client never
     * keeps its own copy of this list.
     *
     * @var array<int, array{path: string, label: string}>
     */
    private const WORKSPACE_PAGES = [
        ['path' => '/', 'label' => 'Overview'],
        ['path' => '/properties', 'label' => 'Properties'],
        ['path' => '/workforce', 'label' => 'Workforce'],
        ['path' => '/access-control', 'label' => 'Access control'],
        ['path' => '/role-management', 'label' => 'Roles & permissions'],
        ['path' => '/manager-app', 'label' => 'RSM App'],
        ['path' => '/nominated-individual', 'label' => 'Nominated Individual App'],
        ['path' => '/staff', 'label' => 'Staff workspace'],
        ['path' => '/placements', 'label' => 'Young people'],
        ['path' => '/rota', 'label' => 'Rota & shifts'],
        ['path' => '/rota-controls', 'label' => 'Rota controls'],
        ['path' => '/compliance-dashboard', 'label' => 'Compliance dashboard'],
        ['path' => '/compliance', 'label' => 'Compliance calendar'],
        ['path' => '/governance', 'label' => 'Governance & outcomes'],
        ['path' => '/work-plans', 'label' => 'Work plans'],
        ['path' => '/finance', 'label' => 'Finance'],
        ['path' => '/documents', 'label' => 'Documents'],
        ['path' => '/assurance', 'label' => 'Assurance'],
        ['path' => '/quality-reviews', 'label' => 'Quality reviews'],
        ['path' => '/regulation-28', 'label' => 'Regulation 28'],
        ['path' => '/care', 'label' => 'Care operations'],
        ['path' => '/safeguarding', 'label' => 'Safeguarding'],
        ['path' => '/keyworker-app', 'label' => 'Key Worker App'],
    ];

    public static function register(Registry $registry): void
    {
        $registry->query('roleManagement.workspace', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertAdmin($ctx, $input);

            // Built-in roles first, then the company's own, each alphabetical.
            $roleRows = DB::table('roles')
                ->where(fn ($q) => $q->whereNull('entityId')->orWhere('entityId', $entityId))
                ->orderByDesc('isBuiltIn')->orderBy('name')
                ->get();

            $memberships = DB::table('entityMemberships as m')
                ->join('users as u', 'u.id', '=', 'm.userId')
                ->leftJoin('localAuthCredentials as c', 'c.userId', '=', 'u.id')
                ->where('m.entityId', $entityId)
                ->orderBy('u.name')
                ->select([
                    'm.userId', 'm.operationalRole as role', 'm.roleId', 'm.allProperties',
                    'm.extraCapabilities', 'm.status',
                    'u.name', 'u.email', 'u.accountStatus',
                    'c.userId as credentialUserId',
                ])->get();

            $memberCountByRole = [];
            foreach ($memberships as $membership) {
                if ($membership->roleId !== null) {
                    $roleId = (int) $membership->roleId;
                    $memberCountByRole[$roleId] = ($memberCountByRole[$roleId] ?? 0) + 1;
                }
            }

            $propertiesByUser = [];
            foreach (DB::table('propertyAssignments')->where('entityId', $entityId)
                ->get(['userId', 'propertyId']) as $grant) {
                $propertiesByUser[(int) $grant->userId][] = (int) $grant->propertyId;
            }

            return [
                'roles' => $roleRows->map(static fn ($row) => self::presentRole($row, $memberCountByRole[(int) $row->id] ?? 0))->all(),
                'pages' => self::WORKSPACE_PAGES,
                'grantableCapabilities' => array_map(
                    static fn (string $value) => ['value' => $value, 'label' => AccessRules::CAPABILITY_LABELS[$value]],
                    AccessRules::MANAGEABLE_CAPABILITIES,
                ),
                'allCapabilities' => array_map(
                    static fn (string $value) => [
                        'value' => $value,
                        'label' => AccessRules::CAPABILITY_LABELS[$value] ?? $value,
                    ],
                    Authz::ALL_CAPABILITIES,
                ),
                'properties' => DB::table('properties')->where('entityId', $entityId)->orderBy('name')
                    ->get(['id', 'name', 'addressLine1'])->map(static fn ($r) => (array) $r)->all(),
                'members' => $memberships->map(static fn ($row) => [
                    'userId' => (int) $row->userId,
                    'name' => $row->name,
                    'email' => $row->email,
                    'role' => $row->role,
                    'roleId' => $row->roleId === null ? null : (int) $row->roleId,
                    'allProperties' => (int) $row->allProperties === 1,
                    'extraCapabilities' => RoleNavigation::cleanCapabilityList(
                        $row->extraCapabilities, AccessRules::MANAGEABLE_CAPABILITIES,
                    ),
                    'propertyIds' => $propertiesByUser[(int) $row->userId] ?? [],
                    'status' => $row->status,
                    'accountStatus' => $row->accountStatus,
                    // Whether they can actually sign in, not only whether they
                    // hold a membership.
                    'hasLocalCredential' => $row->credentialUserId !== null,
                ])->all(),
            ];
        });

        $registry->mutation('roleManagement.createRole', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertAdmin($ctx, $input);
            $definition = self::readDefinition($input, null);
            $reason = self::optionalReason($input['reason'] ?? null);

            $clash = DB::table('roles')
                ->where('entityId', $entityId)->where('slug', $definition['slug'])->first('id');
            if ($clash !== null) {
                throw TrpcException::conflict("A role named \"{$definition['name']}\" already exists in this company.");
            }

            $id = (int) DB::table('roles')->insertGetId([
                'entityId' => $entityId,
                'name' => $definition['name'],
                'slug' => $definition['slug'],
                'description' => Validate::optionalString($input['description'] ?? null, 'description', 600),
                'baseRole' => $definition['baseRole'],
                'grantedCapabilities' => self::json($definition['grantedCapabilities']),
                'deniedCapabilities' => self::json($definition['deniedCapabilities']),
                'visiblePaths' => self::json($definition['visiblePaths']),
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'role_management.role.create',
                'resourceType' => 'custom_role',
                'resourceId' => $id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'reasonCode' => 'custom_role_definition',
                'metadata' => [
                    'name' => $definition['name'], 'slug' => $definition['slug'], 'baseRole' => $definition['baseRole'],
                    'granted' => $definition['grantedCapabilities'], 'denied' => $definition['deniedCapabilities'],
                    'visiblePaths' => $definition['visiblePaths'], 'reason' => $reason,
                ],
            ]);

            return ['id' => $id, 'slug' => $definition['slug']];
        });

        $registry->mutation('roleManagement.updateRole', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertAdmin($ctx, $input);
            $id = Validate::id($input['id'] ?? null, 'id');
            $reason = self::optionalReason($input['reason'] ?? null);

            $existing = self::findRole($id, $entityId);

            // A built-in role keeps its slug and its base role: those are its
            // identity in Authz.
            $definition = self::readDefinition($input, (int) $existing->isBuiltIn === 1 ? (string) $existing->slug : null);

            $clash = DB::table('roles')
                ->where('entityId', $entityId)->where('slug', $definition['slug'])->where('id', '!=', $id)
                ->first('id');
            if ($clash !== null) {
                throw TrpcException::conflict("A different role named \"{$definition['name']}\" already exists.");
            }

            $holderIds = DB::table('entityMemberships')
                ->where('entityId', $entityId)->where('roleId', $id)
                ->pluck('userId')->map(static fn ($value) => (int) $value)->all();

            DB::table('roles')->where('id', $id)->update([
                'name' => $definition['name'],
                'slug' => $definition['slug'],
                'description' => Validate::optionalString($input['description'] ?? null, 'description', 600),
                'baseRole' => $definition['baseRole'],
                'grantedCapabilities' => self::json($definition['grantedCapabilities']),
                'deniedCapabilities' => self::json($definition['deniedCapabilities']),
                'visiblePaths' => self::json($definition['visiblePaths']),
            ]);

            // The base role is authoritative on every membership, so a changed
            // base is written through rather than left to drift. Holders pick the
            // rest up on their next request, because Authz reads the role live.
            if ($existing->baseRole !== $definition['baseRole'] && $holderIds !== []) {
                DB::table('entityMemberships')
                    ->where('entityId', $entityId)->where('roleId', $id)
                    ->update(['operationalRole' => $definition['baseRole']]);
                DB::table('users')->whereIn('id', $holderIds)->update(['roleId' => $id]);
            }

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'role_management.role.update',
                'resourceType' => 'custom_role',
                'resourceId' => $id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'reasonCode' => 'custom_role_definition',
                // Both sides are recorded: an access review asks what a role used
                // to allow, not only what it allows now.
                'metadata' => [
                    'previous' => [
                        'name' => $existing->name, 'baseRole' => $existing->baseRole,
                        'granted' => RoleNavigation::cleanCapabilityList($existing->grantedCapabilities),
                        'denied' => RoleNavigation::cleanCapabilityList($existing->deniedCapabilities),
                        'visiblePaths' => RoleNavigation::cleanPathList($existing->visiblePaths),
                    ],
                    'next' => [
                        'name' => $definition['name'], 'baseRole' => $definition['baseRole'],
                        'granted' => $definition['grantedCapabilities'], 'denied' => $definition['deniedCapabilities'],
                        'visiblePaths' => $definition['visiblePaths'],
                    ],
                    'affectedMembers' => count($holderIds), 'reason' => $reason,
                ],
            ]);

            return ['success' => true, 'affectedMembers' => count($holderIds)];
        });

        $registry->mutation('roleManagement.archiveRole', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertAdmin($ctx, $input);
            $id = Validate::id($input['id'] ?? null, 'id');
            $reason = self::optionalReason($input['reason'] ?? null);

            $existing = self::findRole($id, $entityId);

            if ((int) $existing->isBuiltIn === 1) {
                throw TrpcException::forbidden('Built-in roles cannot be archived. Edit what they may do instead.');
            }

            // Archiving a role somebody holds would leave them with a role that
            // no longer exists, so the members move first.
            $holders = DB::table('entityMemberships')
                ->where('entityId', $entityId)->where('roleId', $id)->count();
            if ($holders > 0) {
                throw TrpcException::conflict(sprintf(
                    '%d member%s still on this role. Move them to another role before archiving it.',
                    $holders, $holders === 1 ? ' is' : 's are',
                ));
            }

            DB::table('roles')->where('id', $id)->update(['status' => 'archived']);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'role_management.role.archive',
                'resourceType' => 'custom_role',
                'resourceId' => $id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'reasonCode' => 'custom_role_definition',
                'metadata' => ['name' => $existing->name, 'reason' => $reason],
            ]);

            return ['success' => true];
        });

        $registry->mutation('roleManagement.createUser', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertAdmin($ctx, $input);
            $reason = self::optionalReason($input['reason'] ?? null);

            $email = LocalAuth::normaliseEmail(Validate::email($input['email'] ?? null));
            $name = Validate::string($input['name'] ?? null, 'name', 2, 180);
            $temporaryPassword = Validate::password($input['temporaryPassword'] ?? null, 'temporaryPassword');

            // The password and the access plan are both checked before anything
            // is written, so a rejected request never leaves an account behind
            // with no membership and no way to sign in.
            $passwordIssue = LocalAuth::validatePassword($temporaryPassword);
            if ($passwordIssue !== null) {
                throw TrpcException::badRequest($passwordIssue);
            }
            $plan = self::resolveAssignment($entityId, $input);

            $existingUser = Users::byEmail($email);
            if ($existingUser === null) {
                $openId = 'local_' . bin2hex(random_bytes(16));
                $userId = (int) DB::table('users')->insertGetId([
                    'openId' => $openId,
                    'name' => $name,
                    'email' => $email,
                    'loginMethod' => 'email',
                    'roleId' => $plan['roleId'],
                    'accountStatus' => 'active',
                ]);
            } else {
                $userId = (int) $existingUser['id'];
                DB::table('users')->where('id', $userId)
                    ->update(['name' => $name, 'loginMethod' => 'email', 'accountStatus' => 'active']);
            }

            self::writeAssignment($plan, $userId, $ctx->userId(), $entityId);
            // requireChangeOnNextLogin: the administrator chose this password, so
            // it is good for exactly one sign-in.
            LocalAuth::createOrReplaceCredential($userId, $email, $temporaryPassword, true);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'role_management.user.create',
                'resourceType' => 'user',
                'resourceId' => $userId,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'reasonCode' => 'cli_access_change',
                'metadata' => [
                    'targetUserId' => $userId, 'created' => $existingUser === null,
                    'role' => $plan['role'], 'roleId' => $plan['roleId'],
                    'allProperties' => $plan['allProperties'], 'propertyIds' => $plan['propertyIds'],
                    'extraCapabilities' => $plan['extras'], 'reason' => $reason,
                ],
            ]);

            return ['userId' => $userId, 'created' => $existingUser === null];
        });

        $registry->mutation('roleManagement.assignRole', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = self::assertAdmin($ctx, $input);
            $targetUserId = Validate::id($input['targetUserId'] ?? null, 'targetUserId');
            $reason = self::optionalReason($input['reason'] ?? null);

            $membership = DB::table('entityMemberships')
                ->where('entityId', $entityId)->where('userId', $targetUserId)->first();

            if ($membership === null) {
                throw TrpcException::notFound('That person is not a member of this company yet. Create their account first.');
            }
            if ($membership->status !== 'active') {
                throw TrpcException::forbidden('Reactivate this membership before changing its role.');
            }

            $plan = self::resolveAssignment($entityId, $input);

            // Removing your own administrator role would leave you unable to put
            // it back.
            if ($ctx->userId() === $targetUserId
                && $membership->operationalRole === 'owner'
                && $plan['role'] !== 'owner') {
                throw TrpcException::forbidden(
                    'You cannot remove your own company administrator role. Ask another administrator to make this change.'
                );
            }

            $activeOwners = DB::table('entityMemberships')
                ->where('entityId', $entityId)->where('operationalRole', 'owner')->where('status', 'active')
                ->count();

            if (!AccessRules::canRemoveOwner((string) $membership->operationalRole, $plan['role'], $activeOwners)) {
                throw TrpcException::conflict('This is the last active company administrator. Assign another administrator first.');
            }

            self::writeAssignment($plan, $targetUserId, $ctx->userId(), $entityId);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'role_management.user.assign',
                'resourceType' => 'entity_membership',
                'resourceId' => (int) $membership->id,
                'sensitivity' => 'restricted',
                'result' => 'success',
                'reasonCode' => 'company_admin_access_change',
                'metadata' => [
                    'targetUserId' => $targetUserId,
                    'previous' => [
                        'role' => $membership->operationalRole,
                        'roleId' => $membership->roleId === null ? null : (int) $membership->roleId,
                        'allProperties' => (int) $membership->allProperties === 1,
                    ],
                    'next' => [
                        'role' => $plan['role'], 'roleId' => $plan['roleId'],
                        'allProperties' => $plan['allProperties'], 'propertyIds' => $plan['propertyIds'],
                        'extraCapabilities' => $plan['extras'],
                    ],
                    'reason' => $reason,
                ],
            ]);

            return ['success' => true];
        });
    }

    private static function assertAdmin(Context $ctx, mixed $input): int
    {
        $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
        Authz::assertEntityCapability($ctx->userId(), $entityId, 'config.write');

        return $entityId;
    }

    /** The audit trail always carries a reason, even when the operator left it blank. */
    private static function optionalReason(mixed $reason): string
    {
        $text = is_string($reason) ? trim($reason) : '';

        return $text === '' ? 'Not given' : Validate::string($text, 'reason', 1, 1200);
    }

    /**
     * @return array{name: string, slug: string, baseRole: string, grantedCapabilities: array<int, string>, deniedCapabilities: array<int, string>, visiblePaths: array<int, string>|null}
     */
    private static function readDefinition(mixed $input, ?string $builtInSlug): array
    {
        $strings = static function (mixed $value, string $field, int $max): array {
            $out = [];
            foreach (Validate::arrayOf($value ?? [], $field, $max) as $index => $item) {
                $out[] = Validate::string($item, "$field.$index", 1, 120);
            }

            return $out;
        };

        $visiblePaths = ($input['visiblePaths'] ?? null) === null
            ? null
            : $strings($input['visiblePaths'], 'visiblePaths', 64);

        return RoleDefinitions::validate(
            Validate::string($input['name'] ?? null, 'name', 2, 120),
            Validate::enum($input['baseRole'] ?? null, AccessRules::MANAGEABLE_ROLES, 'baseRole'),
            $strings($input['grantedCapabilities'] ?? [], 'grantedCapabilities', count(Authz::ALL_CAPABILITIES)),
            $strings($input['deniedCapabilities'] ?? [], 'deniedCapabilities', count(Authz::ALL_CAPABILITIES)),
            $visiblePaths,
            $builtInSlug,
        );
    }

    /** A role row this company may edit: its own, or a built-in one. */
    private static function findRole(int $id, int $entityId): object
    {
        $row = DB::table('roles')
            ->where('id', $id)
            ->where(fn ($q) => $q->whereNull('entityId')->orWhere('entityId', $entityId))
            ->first();

        if ($row === null) {
            throw TrpcException::notFound('That role was not found.');
        }

        return $row;
    }

    /** One stored role shaped for the client, with its resolved effect worked out. */
    private static function presentRole(object $row, int $memberCount): array
    {
        $baseRole = (string) $row->baseRole;
        $granted = RoleNavigation::cleanCapabilityList($row->grantedCapabilities);
        $denied = RoleNavigation::cleanCapabilityList($row->deniedCapabilities);
        $visiblePaths = RoleNavigation::cleanPathList($row->visiblePaths);

        $baseCapabilities = Authz::capabilitiesFor($baseRole);
        sort($baseCapabilities);

        return [
            'id' => (int) $row->id,
            'name' => $row->name,
            'slug' => $row->slug,
            'description' => $row->description,
            'status' => $row->status,
            'isBuiltIn' => (int) $row->isBuiltIn === 1,
            'isAdminAccount' => (int) $row->isAdminAccount === 1,
            'memberCount' => $memberCount,
            // The widest page list this role may be given. The ceiling lives in
            // code, not in the database.
            'availablePaths' => RoleNavigation::pathsFor($baseRole),
            'baseCapabilities' => $baseCapabilities,
            'baseRole' => $baseRole,
            'grantedCapabilities' => $granted,
            'deniedCapabilities' => $denied,
            'visiblePaths' => $visiblePaths,
            'effectiveCapabilities' => RoleNavigation::effectiveCapabilities($baseRole, $granted, $denied),
            'effectivePaths' => RoleNavigation::effectivePaths($baseRole, $visiblePaths),
            'delta' => RoleDefinitions::capabilityDelta($baseRole, $granted, $denied),
        ];
    }

    /**
     * Turns a request into a normalised plan, rejecting anything invalid before
     * a single row is written.
     *
     * A defined role decides the base role and its grants, so those inputs are
     * ignored when one is chosen: the stored definition stays the single source
     * of truth rather than being shadowed by per-person extras.
     *
     * @return array{role: string, roleId: int, allProperties: bool, propertyIds: array<int, int>, extras: array<int, string>}
     */
    private static function resolveAssignment(int $entityId, mixed $input): array
    {
        $role = Validate::enum($input['role'] ?? null, AccessRules::MANAGEABLE_ROLES, 'role');
        $roleId = Validate::optionalId($input['roleId'] ?? null, 'roleId');

        $extras = AccessRules::normaliseManaged(
            Validate::arrayOf($input['extraCapabilities'] ?? [], 'extraCapabilities', count(AccessRules::MANAGEABLE_CAPABILITIES)),
        );

        if ($roleId !== null) {
            $selected = DB::table('roles')
                ->where('id', $roleId)
                ->where(fn ($q) => $q->whereNull('entityId')->orWhere('entityId', $entityId))
                ->where('status', 'active')
                ->first(['baseRole']);

            if ($selected === null) {
                throw TrpcException::badRequest('Select an active role available to this company.');
            }
            if ($selected->baseRole === 'platform_admin') {
                throw TrpcException::forbidden('The platform administrator role cannot be assigned from this screen.');
            }

            $role = (string) $selected->baseRole;
            $extras = [];
        }

        // An administrator reaches every property and needs no extras, so those
        // inputs are dropped rather than stored.
        $allProperties = $role === 'owner' ? true : Validate::bool($input['allProperties'] ?? null, 'allProperties');
        if ($role === 'owner') {
            $extras = [];
        }

        $propertyIds = [];
        if (!$allProperties) {
            foreach (Validate::arrayOf($input['propertyIds'] ?? [], 'propertyIds', 250) as $index => $propertyId) {
                $id = Validate::id($propertyId, "propertyIds.$index");
                if (!in_array($id, $propertyIds, true)) {
                    $propertyIds[] = $id;
                }
            }
            sort($propertyIds);

            if ($propertyIds === []) {
                throw TrpcException::badRequest('Select at least one property, or grant access to all company properties.');
            }

            // Every named property must belong to this company, or the grant
            // would reach into another one.
            $found = DB::table('properties')->where('entityId', $entityId)->whereIn('id', $propertyIds)->count();
            if ($found !== count($propertyIds)) {
                throw TrpcException::badRequest('One or more selected properties do not belong to this company.');
            }
        }

        return [
            'role' => $role,
            'roleId' => $roleId ?? Users::builtInRoleId($role),
            'allProperties' => $allProperties,
            'propertyIds' => $propertyIds,
            'extras' => $extras,
        ];
    }

    /**
     * Writes the membership and its property grants.
     *
     * The grants are replaced rather than merged, so what the administrator saw
     * on screen is exactly what is stored.
     *
     * @param array{role: string, roleId: int, allProperties: bool, propertyIds: array<int, int>, extras: array<int, string>} $plan
     */
    private static function writeAssignment(array $plan, int $userId, int $actorUserId, int $entityId): void
    {
        DB::transaction(static function () use ($plan, $userId, $actorUserId, $entityId): void {
            DB::table('entityMemberships')->upsert(
                [[
                    'entityId' => $entityId,
                    'userId' => $userId,
                    'operationalRole' => $plan['role'],
                    'roleId' => $plan['roleId'],
                    'allProperties' => $plan['allProperties'] ? 1 : 0,
                    'extraCapabilities' => self::json($plan['extras']),
                    'status' => 'active',
                    'createdBy' => $actorUserId,
                ]],
                ['entityId', 'userId'],
                // endsAt is cleared: reassigning somebody is also how a lapsed
                // membership is brought back.
                ['operationalRole', 'roleId', 'allProperties', 'extraCapabilities', 'status', 'endsAt'],
            );

            DB::table('propertyAssignments')
                ->where('entityId', $entityId)->where('userId', $userId)->delete();

            $now = Dates::nowMillis();
            foreach ($plan['propertyIds'] as $propertyId) {
                DB::table('propertyAssignments')->insert([
                    'entityId' => $entityId,
                    'propertyId' => $propertyId,
                    'userId' => $userId,
                    'assignmentType' => AccessRules::propertyAssignmentTypeFor($plan['role']),
                    'startsAt' => $now,
                    'createdBy' => $actorUserId,
                ]);
            }
        });

        // users.roleId is the account's workspace role: the company-defined row
        // where there is one, otherwise the built-in row for the base role.
        DB::table('users')->where('id', $userId)->update(['roleId' => $plan['roleId']]);
    }

    /** @param array<int, string>|null $value */
    private static function json(?array $value): ?string
    {
        return $value === null ? null : json_encode(array_values($value), JSON_UNESCAPED_SLASHES);
    }
}
