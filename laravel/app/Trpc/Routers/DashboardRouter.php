<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Authz;
use App\Support\Dates;
use App\Support\Rules;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * dashboard.*, mirroring server/routers/dashboard.ts.
 *
 * The first screen after sign-in: counts, a compliance colour breakdown, and
 * the ten things most worth doing next.
 */
final class DashboardRouter
{
    public static function register(Registry $registry): void
    {
        $registry->query('dashboard.summary', Registry::USER, static function (Context $ctx, mixed $input): array {
            $access = Authz::userAccess($ctx->userId());
            $entityIds = array_column($access['memberships'], 'entityId');

            // An owner with no membership rows yet still sees the platform, so
            // the first company created is not invisible to them.
            if ($access['user']['operationalRole'] === 'owner' && $entityIds === []) {
                $entityIds = DB::table('entities')->pluck('id')->map(static fn ($id) => (int) $id)->all();
            }

            $entityId = Validate::optionalId($input['entityId'] ?? null, 'entityId');
            if ($entityId !== null) {
                Authz::assertEntityCapability($ctx->userId(), $entityId, 'entity.read');
                $entityIds = [$entityId];
            }

            if ($entityIds === []) {
                return [
                    'empty' => true,
                    'counts' => [],
                    'priorities' => [],
                    'rag' => ['green' => 0, 'amber' => 0, 'red' => 0, 'grey' => 0],
                ];
            }

            $scoped = static fn (string $table) => DB::table($table)->whereIn('entityId', $entityIds);

            $properties = $scoped('properties')->count();
            $activeStaff = $scoped('staffProfiles')->where('status', 'active')->count();
            $activePlacements = $scoped('placements')->where('status', 'active')->count();
            $openShifts = $scoped('shifts')->where('status', '!=', 'cancelled')->where('status', 'open')->count();
            $overdueInvoices = $scoped('invoices')->where('status', 'overdue')->count();

            $incidents = $scoped('incidents')->where('status', '!=', 'closed')->get();
            $obligations = $scoped('complianceObligations')->orderBy('dueAt')->get();
            $actions = $scoped('workPlanActions')->where('status', '!=', 'complete')->orderBy('dueAt')->get();

            $rag = ['green' => 0, 'amber' => 0, 'red' => 0, 'grey' => 0];
            foreach ($obligations as $item) {
                $rag[Rules::ragStatus(
                    $item->dueAt === null ? null : (int) $item->dueAt,
                    $item->completedAt === null ? null : (int) $item->completedAt,
                    (int) ($item->leadDays ?? 30),
                )]++;
            }

            $now = Dates::nowMillis();
            $priorities = [];

            // Serious incidents come first, then compliance that is not green,
            // then work due within the week — ten in all, so the list is a list
            // of what to do rather than everything outstanding.
            foreach ($incidents as $item) {
                if (in_array($item->severity, ['critical', 'high'], true)) {
                    $priorities[] = ['kind' => 'incident', 'id' => (int) $item->id, 'title' => $item->summary,
                        'dueAt' => $item->notificationDueAt, 'tone' => 'red'];
                }
            }

            $complianceAdded = 0;
            foreach ($obligations as $item) {
                if ($complianceAdded >= 5) {
                    break;
                }
                $status = Rules::ragStatus(
                    $item->dueAt === null ? null : (int) $item->dueAt,
                    $item->completedAt === null ? null : (int) $item->completedAt,
                    (int) ($item->leadDays ?? 30),
                );
                if ($status === 'green') {
                    continue;
                }
                $priorities[] = ['kind' => 'compliance', 'id' => (int) $item->id, 'title' => $item->title,
                    'dueAt' => $item->dueAt, 'tone' => (int) $item->dueAt < $now ? 'red' : 'amber'];
                $complianceAdded++;
            }

            $actionsAdded = 0;
            foreach ($actions as $item) {
                if ($actionsAdded >= 5 || (int) $item->dueAt >= $now + 7 * 86400000) {
                    continue;
                }
                $priorities[] = ['kind' => 'work_plan', 'id' => (int) $item->id, 'title' => $item->title,
                    'dueAt' => $item->dueAt, 'tone' => (int) $item->dueAt < $now ? 'red' : 'blue'];
                $actionsAdded++;
            }

            return [
                'empty' => false,
                'counts' => [
                    'properties' => $properties,
                    'activeStaff' => $activeStaff,
                    'activePlacements' => $activePlacements,
                    'openShifts' => $openShifts,
                    'overdueInvoices' => $overdueInvoices,
                    'openIncidents' => $incidents->count(),
                ],
                'rag' => $rag,
                'priorities' => array_slice($priorities, 0, 10),
                'notifications' => DB::table('notifications')
                    ->where('userId', $ctx->userId())->whereNull('readAt')->limit(8)
                    ->get()->map(static fn ($r) => (array) $r)->all(),
            ];
        });
    }
}
