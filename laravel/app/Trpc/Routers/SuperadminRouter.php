<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use Illuminate\Support\Facades\DB;

/**
 * superadmin.overview, mirroring server/routers/superadmin.ts.
 *
 * Platform-level monitoring: how many companies exist, how many accounts, how
 * many are suspended. It is metadata only — names, statuses and counts — and
 * reaches no operational record inside any company. Running the platform does
 * not come with a right to read what is in it, so the detail stays behind each
 * company's own permission checks.
 *
 * Reading this is itself audited.
 */
final class SuperadminRouter
{
    /** The user list is a monitoring sample, not an export. */
    private const USER_SAMPLE = 100;

    public static function register(Registry $registry): void
    {
        $registry->query('superadmin.overview', Registry::USER, static function (Context $ctx): array {
            self::assertSuperadmin($ctx);

            $companyRows = DB::table('entities')->orderBy('name')
                ->get(['id', 'name', 'legalName', 'status', 'createdAt']);

            $memberships = DB::table('entityMemberships')->get(['entityId', 'userId', 'status']);

            $userRows = DB::table('users as u')
                ->join('roles as r', 'r.id', '=', 'u.roleId')
                ->orderByDesc('u.lastSignedIn')
                ->get([
                    'u.id', 'u.name', 'u.email',
                    'r.isAdminAccount as role', 'r.slug as operationalRole',
                    'u.accountStatus', 'u.lastSignedIn',
                ]);

            $activeMemberCount = [];
            $activeMemberships = 0;
            foreach ($memberships as $membership) {
                if ($membership->status !== 'active') {
                    continue;
                }
                $entityId = (int) $membership->entityId;
                $activeMemberCount[$entityId] = ($activeMemberCount[$entityId] ?? 0) + 1;
                $activeMemberships++;
            }

            $companies = [];
            $activeCompanies = 0;
            foreach ($companyRows as $company) {
                if ($company->status === 'active') {
                    $activeCompanies++;
                }
                $companies[] = (array) $company + ['activeMembers' => $activeMemberCount[(int) $company->id] ?? 0];
            }

            $activeUsers = 0;
            $suspendedUsers = 0;
            foreach ($userRows as $user) {
                if ($user->accountStatus === 'active') {
                    $activeUsers++;
                } elseif ($user->accountStatus === 'suspended') {
                    $suspendedUsers++;
                }
            }

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'action' => 'superadmin.monitoring_view',
                'resourceType' => 'platform_monitoring',
                'sensitivity' => 'restricted',
                'result' => 'allowed',
                'reasonCode' => 'platform_admin_metadata_only',
                'metadata' => ['companyCount' => count($companies), 'userCount' => $userRows->count()],
            ]);

            return [
                'totals' => [
                    'companies' => count($companies),
                    'activeCompanies' => $activeCompanies,
                    'users' => $userRows->count(),
                    'activeUsers' => $activeUsers,
                    'suspendedUsers' => $suspendedUsers,
                    'memberships' => $activeMemberships,
                ],
                'companies' => $companies,
                'users' => $userRows->take(self::USER_SAMPLE)->map(static fn ($r) => (array) $r)->values()->all(),
            ];
        });
    }

    /**
     * Both halves are required: the platform administrator role and the admin
     * account flag. Either one alone is an ordinary account.
     */
    public static function assertSuperadmin(Context $ctx): void
    {
        $user = $ctx->requireUser();

        if (($user['role'] ?? null) !== 'admin' || ($user['operationalRole'] ?? null) !== 'platform_admin') {
            throw TrpcException::forbidden('Superadmin access is required.');
        }
    }
}
