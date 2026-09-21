<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Authz;
use App\Support\EncryptedFields;
use App\Support\Users;
use App\Support\WorkspaceGuards;
use App\Support\WorkspacePolicy;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * staffWorkspace.*, mirroring server/routers/staffWorkspace.ts.
 *
 * The frontline workspace: what a worker sees on shift at a property, what they
 * see for the young people they key-work, their own HR records, and the queue a
 * manager reviews. Most of its content is encrypted at field level, so rows
 * leave through EncryptedFields rather than being returned directly.
 */
final class StaffWorkspaceRouter
{
    public static function register(Registry $registry): void
    {
        $registry->query('staffWorkspace.context', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyIds = Authz::currentShiftPropertyIds($ctx->userId(), $entityId, 'property.read');

            $access = Authz::userAccess($ctx->userId());
            $role = $access['user']['operationalRole'] === 'owner' ? 'owner' : null;
            if ($role === null) {
                foreach ($access['memberships'] as $membership) {
                    if ($membership['entityId'] === $entityId) {
                        $role = $membership['operationalRole'];
                        break;
                    }
                }
            }

            $properties = $propertyIds === []
                ? []
                : DB::table('properties')->whereIn('id', $propertyIds)->get()->map(static fn ($r) => (array) $r)->all();

            $query = DB::table('placements')->where('entityId', $entityId);
            if ($propertyIds !== []) {
                $query->whereIn('propertyId', $propertyIds);
            }

            // A support worker sees only the young people they are currently
            // assigned to. With no live assignment they see none, rather than
            // falling through to everyone at the property.
            if ($role === 'support_worker') {
                $now = \App\Support\Dates::nowMillis();
                $assigned = DB::table('workerAssignments')
                    ->where('entityId', $entityId)
                    ->where('userId', $ctx->userId())
                    ->where(fn ($q) => $q->whereNull('startsAt')->orWhere('startsAt', '<=', $now))
                    ->where(fn ($q) => $q->whereNull('endsAt')->orWhere('endsAt', '>', $now))
                    ->pluck('placementId')->all();

                $query->whereIn('id', $assigned === [] ? [-1] : $assigned);
            }

            $profile = DB::table('staffProfiles')
                ->where('entityId', $entityId)->where('userId', $ctx->userId())->first();

            return [
                'role' => $role,
                'isManager' => WorkspacePolicy::isManagerRole($role),
                'properties' => $properties,
                'placements' => $query->get()->map(static fn ($r) => (array) $r)->all(),
                'staffProfile' => $profile === null ? null : (array) $profile,
            ];
        });

        $registry->query('staffWorkspace.propertyWorkspace', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            Authz::assertCurrentShiftPropertyCapability($ctx->userId(), $entityId, $propertyId, 'property.read');

            $scoped = static fn (string $table) => DB::table($table)
                ->where('entityId', $entityId)->where('propertyId', $propertyId);

            return [
                // A visitor's name, why they came and what was noted are all
                // encrypted; the vehicle registration is deliberately not
                // revealed here, and strip() drops it either way.
                'visitors' => EncryptedFields::revealAll(
                    $scoped('propertyVisitors')->orderByDesc('arrivedAt')->get(),
                    ['name', 'relationship', 'purpose', 'notes', 'departureNotes'],
                ),
                'checks' => $scoped('propertyChecks')->orderByDesc('createdAt')->get()
                    ->map(static fn ($r) => (array) $r)->all(),
                'maintenance' => $scoped('maintenanceJobs')->orderByDesc('updatedAt')->get()
                    ->map(static fn ($r) => (array) $r)->all(),
                'loneWorkers' => $scoped('loneWorkerSessions')->orderByDesc('updatedAt')->get()
                    ->map(static fn ($r) => (array) $r)->all(),
                'presence' => $scoped('propertyPresenceEvents')->orderByDesc('occurredAt')->get()
                    ->map(static fn ($r) => (array) $r)->all(),
                'rollCalls' => $scoped('emergencyRollCalls')->orderByDesc('initiatedAt')->get()
                    ->map(static fn ($r) => (array) $r)->all(),
            ];
        });

        $registry->query('staffWorkspace.placementWorkspace', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyId = Validate::id($input['propertyId'] ?? null, 'propertyId');
            $placementId = Validate::id($input['placementId'] ?? null, 'placementId');

            $scoped = WorkspaceGuards::assertPlacementScope(
                $ctx->userId(), $entityId, $propertyId, $placementId, 'young_person.read'
            );
            $isManager = WorkspacePolicy::isManagerRole($scoped['access']['role'] ?? null);

            $byPlacement = static fn (string $table) => DB::table($table)->where('placementId', $placementId);

            $concerns = [];
            foreach ($byPlacement('safeguardingConcerns')->orderByDesc('createdAt')->get() as $row) {
                if ($isManager) {
                    $concerns[] = EncryptedFields::reveal((array) $row, ['summary', 'immediateProtection']);
                    continue;
                }

                // A worker sees that a concern exists, its type, risk and review
                // date, so they can act on it. The account of what happened is a
                // manager's record.
                $concerns[] = [
                    'id' => (int) $row->id,
                    'entityId' => (int) $row->entityId,
                    'propertyId' => $row->propertyId === null ? null : (int) $row->propertyId,
                    'placementId' => (int) $row->placementId,
                    'concernType' => $row->concernType,
                    'riskLevel' => $row->riskLevel,
                    'status' => $row->status,
                    'reviewDueAt' => $row->reviewDueAt,
                    'createdAt' => \App\Support\Dates::fromDatabase($row->createdAt),
                    'restricted' => true,
                ];
            }

            return [
                'goals' => EncryptedFields::revealAll(
                    $byPlacement('supportGoals')->orderByDesc('updatedAt')->get(),
                    ['description', 'youngPersonView'],
                ),
                'sessions' => EncryptedFields::revealAll(
                    $byPlacement('keyworkSessions')->orderByDesc('occurredAt')->get(),
                    ['objectives', 'discussion', 'youngPersonView', 'outcome'],
                ),
                'notes' => EncryptedFields::revealAll(
                    $byPlacement('dailyNotes')->orderByDesc('observedAt')->get(),
                    ['content', 'youngPersonView'],
                ),
                'reports' => $byPlacement('keyWorkerReports')->orderByDesc('reportDate')->get()
                    ->map(static fn ($r) => (array) $r)->all(),
                'financeAccounts' => $byPlacement('residentFinanceAccounts')->orderByDesc('updatedAt')->get()
                    ->map(static fn ($r) => (array) $r)->all(),
                'valuables' => $byPlacement('residentValuables')->orderByDesc('receivedAt')->get()
                    ->map(static fn ($r) => (array) $r)->all(),
                'concerns' => $concerns,
            ];
        });

        $registry->query('staffWorkspace.staffWorkspace', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'staff.self_service');

            $profile = DB::table('staffProfiles')
                ->where('entityId', $entityId)->where('userId', $ctx->userId())->first();

            if ($profile === null) {
                return ['profile' => null, 'requests' => [], 'supervisions' => []];
            }

            return [
                'profile' => (array) $profile,
                'requests' => DB::table('staffRequests')
                    ->where('entityId', $entityId)->where('userId', $ctx->userId())
                    ->orderByDesc('createdAt')->get()->map(static fn ($r) => (array) $r)->all(),
                // Only the shared notes are revealed. A supervision session also
                // holds the manager's private notes, which the subject does not
                // see, and strip() removes them.
                'supervisions' => EncryptedFields::revealAll(
                    DB::table('supervisionSessions')
                        ->where('entityId', $entityId)->where('staffProfileId', $profile->id)
                        ->orderByDesc('scheduledAt')->get(),
                    ['sharedNotes'],
                ),
            ];
        });
    }
}
