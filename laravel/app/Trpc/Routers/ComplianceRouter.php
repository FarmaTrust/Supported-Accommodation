<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Audit;
use App\Support\Authz;
use App\Support\Dates;
use App\Support\Rules;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * compliance.*, mirroring server/routers/compliance.ts.
 *
 * Obligations — the things that have to be renewed, evidenced and signed off —
 * and the work plans that get them done.
 */
final class ComplianceRouter
{
    private const CATEGORIES = [
        'property', 'workforce', 'placement', 'policy', 'quality', 'finance', 'data_protection',
    ];

    private const RULE_TYPES = ['compliance', 'review', 'work_plan', 'policy', 'placement', 'invoice'];

    private const WORK_PLAN_STATUSES = [
        'open', 'in_progress', 'blocked', 'ready_for_review', 'complete', 'cancelled',
    ];

    public static function register(Registry $registry): void
    {
        $registry->query('compliance.rollup', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'compliance.read');

            $ranked = [];
            foreach (DB::table('complianceObligations')->where('entityId', $entityId)->get() as $row) {
                $ranked[] = ['row' => $row, 'rag' => self::ragFor($row)];
            }

            $groupBy = static function (string $field) use ($ranked): array {
                $groups = [];
                foreach ($ranked as $item) {
                    $id = $item['row']->{$field} ?? null;
                    if ($id === null) {
                        continue;
                    }
                    $key = (string) $id;
                    $groups[$key] ??= ['id' => (int) $id, 'green' => 0, 'amber' => 0, 'red' => 0, 'grey' => 0, 'ragStatus' => 'grey'];
                    $groups[$key][$item['rag']]++;
                    $groups[$key]['ragStatus'] = self::worst([$groups[$key]['ragStatus'], $item['rag']]);
                }

                return array_values($groups);
            };

            $states = array_column($ranked, 'rag');
            $counts = ['green' => 0, 'amber' => 0, 'red' => 0, 'grey' => 0];
            foreach ($states as $state) {
                $counts[$state]++;
            }

            return [
                'platform' => ['ragStatus' => self::worst($states), 'count' => count($ranked)],
                'entity' => ['entityId' => $entityId, 'ragStatus' => self::worst($states)] + $counts,
                'properties' => $groupBy('propertyId'),
                'staff' => $groupBy('staffProfileId'),
                'youngPeople' => $groupBy('placementId'),
                'requirements' => array_map(
                    static fn (array $item) => ['id' => (int) $item['row']->id, 'title' => $item['row']->title, 'ragStatus' => $item['rag']],
                    $ranked,
                ),
            ];
        });

        $registry->query('compliance.platformRollup', Registry::USER, static function (Context $ctx): array {
            $entityIds = array_column(Authz::userAccess($ctx->userId())['memberships'], 'entityId');

            if ($entityIds === []) {
                return ['ragStatus' => 'grey', 'entities' => 0, 'requirements' => 0];
            }

            $rows = DB::table('complianceObligations')->whereIn('entityId', $entityIds)->get();
            $states = $rows->map(static fn ($row) => self::ragFor($row))->all();

            return [
                'ragStatus' => in_array('red', $states, true) ? 'red'
                    : (in_array('amber', $states, true) ? 'amber' : ($states === [] ? 'grey' : 'green')),
                'entities' => $rows->pluck('entityId')->unique()->count(),
                'requirements' => $rows->count(),
            ];
        });

        $registry->query('compliance.reminderRules', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'compliance.read');

            return DB::table('automationRules')->where('entityId', $entityId)->get()
                ->map(static fn ($r) => (array) $r)->all();
        });

        $registry->mutation('compliance.createReminderRule', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            // Reminder rules decide when everyone else is chased, so they are a
            // configuration change rather than a compliance one.
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'config.write');

            $escalationRoute = Validate::arrayOf($input['escalationRoute'] ?? null, 'escalationRoute', 5);
            if ($escalationRoute === []) {
                throw TrpcException::badRequest('Name at least one role in the escalation route.');
            }
            foreach ($escalationRoute as $index => $role) {
                Validate::string($role, "escalationRoute.$index", 2, 80);
            }

            $configuration = [
                'leadDays' => Validate::int($input['leadDays'] ?? null, 'leadDays', 0, 365),
                'escalationDays' => Validate::int($input['escalationDays'] ?? null, 'escalationDays', 1, 365),
                'ownerRole' => Validate::string($input['ownerRole'] ?? null, 'ownerRole', 2, 80),
                'escalationRoute' => $escalationRoute,
                'requireAcknowledgement' => Validate::bool($input['requireAcknowledgement'] ?? true, 'requireAcknowledgement', true),
                'snoozeDays' => Validate::int($input['snoozeDays'] ?? 3, 'snoozeDays', 0, 30),
            ];

            $ruleType = Validate::enum($input['ruleType'] ?? null, self::RULE_TYPES, 'ruleType');

            $ruleId = (int) DB::table('automationRules')->insertGetId([
                'entityId' => $entityId,
                'name' => Validate::string($input['name'] ?? null, 'name', 3, 180),
                'ruleType' => $ruleType,
                'configuration' => json_encode($configuration, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'automation_rule.create',
                'resourceType' => 'automation_rule',
                'resourceId' => $ruleId,
                'result' => 'success',
                'metadata' => ['ruleType' => $ruleType, 'configuration' => $configuration],
            ]);

            return ['id' => $ruleId];
        });

        $registry->mutation('compliance.setReminderRuleEnabled', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $id = Validate::id($input['id'] ?? null, 'id');
            $enabled = Validate::bool($input['enabled'] ?? null, 'enabled');

            Authz::assertEntityCapability($ctx->userId(), $entityId, 'config.write');

            DB::table('automationRules')->where('id', $id)->where('entityId', $entityId)
                ->update(['enabled' => $enabled ? 1 : 0]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'automation_rule.toggle',
                'resourceType' => 'automation_rule',
                'resourceId' => $id,
                'result' => 'success',
                'metadata' => ['enabled' => $enabled],
            ]);

            return ['success' => true];
        });

        $registry->query('compliance.list', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyIds = Authz::accessiblePropertyIds($ctx->userId(), $entityId, 'compliance.read');

            $query = DB::table('complianceObligations')->where('entityId', $entityId);
            if ($propertyIds !== []) {
                $query->whereIn('propertyId', $propertyIds);
            }

            return $query->orderBy('dueAt')->get()->map(static function ($row): array {
                $item = (array) $row;
                $item['ragStatus'] = self::ragFor($row);

                return $item;
            })->all();
        });

        $registry->mutation('compliance.create', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'compliance.write');

            $dueAt = Validate::int($input['dueAt'] ?? null, 'dueAt');
            $leadDays = Validate::int($input['leadDays'] ?? 30, 'leadDays', 0, 365);
            $ragStatus = Rules::ragStatus($dueAt, null, $leadDays);
            $propertyId = Validate::optionalId($input['propertyId'] ?? null, 'propertyId');

            $obligationId = (int) DB::table('complianceObligations')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'category' => Validate::enum($input['category'] ?? null, self::CATEGORIES, 'category'),
                'requirementKey' => Validate::string($input['requirementKey'] ?? null, 'requirementKey', 2, 120),
                'title' => Validate::string($input['title'] ?? null, 'title', 3, 220),
                'basis' => Validate::optionalString($input['basis'] ?? null, 'basis', 220),
                'ownerUserId' => Validate::optionalId($input['ownerUserId'] ?? null, 'ownerUserId'),
                'ownerRole' => Validate::optionalString($input['ownerRole'] ?? null, 'ownerRole', 80),
                'dueAt' => $dueAt,
                'leadDays' => $leadDays,
                'recurrence' => Validate::optionalString($input['recurrence'] ?? null, 'recurrence', 80),
                'ragStatus' => $ragStatus,
                'status' => Rules::obligationStatusFor($ragStatus),
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'action' => 'compliance.create',
                'resourceType' => 'compliance_obligation',
                'resourceId' => $obligationId,
                'result' => 'success',
            ]);

            return ['id' => $obligationId];
        });

        $registry->mutation('compliance.complete', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $id = Validate::id($input['id'] ?? null, 'id');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'compliance.write');

            $obligation = DB::table('complianceObligations')->where('id', $id)->where('entityId', $entityId)
                ->first(['id', 'sourceType']);

            if ($obligation === null) {
                throw TrpcException::notFound('Compliance obligation was not found');
            }

            // A property certificate renewal is closed by attaching approved
            // evidence to the property record. Letting it be ticked off here
            // would mark a gas safety renewal done with no certificate behind it.
            if ($obligation->sourceType === 'property_evidence') {
                throw TrpcException::conflict(
                    'Property certificate obligations are updated from Property records. Link approved evidence there instead of marking this renewal complete manually.'
                );
            }

            DB::table('complianceObligations')->where('id', $id)->where('entityId', $entityId)->update([
                'status' => 'complete',
                'ragStatus' => 'green',
                'completedAt' => Dates::nowMillis(),
                'evidenceDocumentId' => Validate::optionalId($input['evidenceDocumentId'] ?? null, 'evidenceDocumentId'),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'compliance.complete',
                'resourceType' => 'compliance_obligation',
                'resourceId' => $id,
                'result' => 'success',
            ]);

            return ['success' => true];
        });

        $registry->query('compliance.workPlans', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'compliance.read');

            $dependencies = DB::table('workPlanDependencies')->where('entityId', $entityId)->get();

            return DB::table('workPlanActions')
                ->where('entityId', $entityId)->where('status', '!=', 'cancelled')
                ->orderBy('dueAt')->get()
                ->map(static function ($action) use ($dependencies): array {
                    $item = (array) $action;
                    $item['dependencies'] = $dependencies
                        ->filter(static fn ($d) => (int) $d->actionId === (int) $action->id)
                        ->map(static fn ($d) => (int) $d->dependsOnActionId)
                        ->values()->all();

                    return $item;
                })->all();
        });

        $registry->query('compliance.workPlanHistory', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $id = Validate::id($input['id'] ?? null, 'id');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'compliance.read');

            // Read from the audit trail rather than a separate history table, so
            // what is shown is the same record an inspection would be given.
            return DB::table('auditLogs')
                ->where('entityId', $entityId)
                ->where('resourceType', 'work_plan_action')
                ->where('resourceId', (string) $id)
                ->orderByDesc('occurredAt')->limit(50)->get()
                ->map(static fn ($r) => (array) $r)->all();
        });

        $registry->mutation('compliance.createWorkPlan', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'compliance.write');

            $propertyId = Validate::optionalId($input['propertyId'] ?? null, 'propertyId');

            $actionId = (int) DB::table('workPlanActions')->insertGetId([
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'placementId' => Validate::optionalId($input['placementId'] ?? null, 'placementId'),
                'title' => Validate::string($input['title'] ?? null, 'title', 3, 220),
                'description' => Validate::optionalString($input['description'] ?? null, 'description', 4000),
                'ownerUserId' => Validate::optionalId($input['ownerUserId'] ?? null, 'ownerUserId'),
                'priority' => Validate::enum($input['priority'] ?? 'normal', ['low', 'normal', 'high', 'critical'], 'priority'),
                'dueAt' => Validate::int($input['dueAt'] ?? null, 'dueAt'),
                'sourceType' => Validate::optionalString($input['sourceType'] ?? null, 'sourceType', 80),
                'sourceId' => Validate::optionalId($input['sourceId'] ?? null, 'sourceId'),
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'action' => 'work_plan.create',
                'resourceType' => 'work_plan_action',
                'resourceId' => $actionId,
                'result' => 'success',
            ]);

            return ['id' => $actionId];
        });

        $registry->mutation('compliance.updateWorkPlan', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $id = Validate::id($input['id'] ?? null, 'id');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'compliance.write');

            $status = Validate::enum($input['status'] ?? null, self::WORK_PLAN_STATUSES, 'status');
            $progressPercent = Validate::int($input['progressPercent'] ?? null, 'progressPercent', 0, 100);

            // Nobody marks their own work complete here. Completion happens only
            // through review, which is what makes the sign-off independent.
            if ($status === 'complete') {
                throw TrpcException::conflict('Submit work for independent review before completion');
            }

            DB::table('workPlanActions')->where('id', $id)->where('entityId', $entityId)->update([
                'status' => $status,
                'progressPercent' => $progressPercent,
                'completionNotes' => Validate::optionalString($input['completionNotes'] ?? null, 'completionNotes', 4000),
                'completedAt' => null,
                'completedBy' => null,
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'work_plan.update',
                'resourceType' => 'work_plan_action',
                'resourceId' => $id,
                'result' => 'success',
                'metadata' => ['status' => $status, 'progressPercent' => $progressPercent],
            ]);

            return ['success' => true];
        });

        $registry->mutation('compliance.assignWorkPlan', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $id = Validate::id($input['id'] ?? null, 'id');
            $ownerUserId = Validate::id($input['ownerUserId'] ?? null, 'ownerUserId');
            $dueAt = Validate::int($input['dueAt'] ?? null, 'dueAt');

            Authz::assertEntityCapability($ctx->userId(), $entityId, 'compliance.write');

            // Work assigned to somebody who is not in the company would never be
            // seen by anyone.
            $membership = DB::table('entityMemberships')
                ->where('entityId', $entityId)->where('userId', $ownerUserId)->where('status', 'active')
                ->first('id');

            if ($membership === null) {
                throw TrpcException::badRequest('The selected owner is not an active member of this entity');
            }

            DB::table('workPlanActions')->where('id', $id)->where('entityId', $entityId)
                ->update(['ownerUserId' => $ownerUserId, 'dueAt' => $dueAt]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'work_plan.assign',
                'resourceType' => 'work_plan_action',
                'resourceId' => $id,
                'result' => 'success',
                'metadata' => ['ownerUserId' => $ownerUserId, 'dueAt' => $dueAt],
            ]);

            return ['success' => true];
        });

        $registry->mutation('compliance.addWorkPlanDependency', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $actionId = Validate::id($input['actionId'] ?? null, 'actionId');
            $dependsOnActionId = Validate::id($input['dependsOnActionId'] ?? null, 'dependsOnActionId');

            Authz::assertEntityCapability($ctx->userId(), $entityId, 'compliance.write');

            if ($actionId === $dependsOnActionId) {
                throw TrpcException::badRequest('An action cannot depend on itself');
            }

            $found = DB::table('workPlanActions')->where('entityId', $entityId)
                ->whereIn('id', [$actionId, $dependsOnActionId])->count();

            if ($found !== 2) {
                throw TrpcException::badRequest('Both actions must belong to the selected entity');
            }

            // A cycle would leave both actions permanently waiting on each other,
            // so the graph is walked before the edge is added.
            $graph = [];
            foreach (DB::table('workPlanDependencies')->where('entityId', $entityId)->get() as $row) {
                $graph[(int) $row->actionId][] = (int) $row->dependsOnActionId;
            }

            if (self::reaches($graph, $dependsOnActionId, $actionId)) {
                throw TrpcException::conflict('This dependency would create a cycle');
            }

            DB::table('workPlanDependencies')->upsert(
                [['entityId' => $entityId, 'actionId' => $actionId, 'dependsOnActionId' => $dependsOnActionId, 'createdBy' => $ctx->userId()]],
                ['actionId', 'dependsOnActionId'],
                ['createdBy'],
            );

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'work_plan.dependency_add',
                'resourceType' => 'work_plan_action',
                'resourceId' => $actionId,
                'result' => 'success',
                'metadata' => ['dependsOnActionId' => $dependsOnActionId],
            ]);

            return ['success' => true];
        });

        $registry->mutation('compliance.submitWorkPlanReview', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $id = Validate::id($input['id'] ?? null, 'id');
            $progressPercent = Validate::int($input['progressPercent'] ?? null, 'progressPercent', 0, 100);
            $completionNotes = Validate::string($input['completionNotes'] ?? null, 'completionNotes', 5, 4000);
            $evidenceDocumentId = Validate::optionalId($input['evidenceDocumentId'] ?? null, 'evidenceDocumentId');

            Authz::assertEntityCapability($ctx->userId(), $entityId, 'compliance.write');

            if ($evidenceDocumentId !== null) {
                $document = DB::table('documents')->where('id', $evidenceDocumentId)->where('entityId', $entityId)->first('id');
                if ($document === null) {
                    throw TrpcException::badRequest('Evidence document is not available in this entity');
                }
            }

            // Work that depends on other work cannot be signed off before it, or
            // the order the plan encodes stops meaning anything.
            $prerequisites = DB::table('workPlanDependencies')
                ->where('entityId', $entityId)->where('actionId', $id)
                ->pluck('dependsOnActionId')->all();

            if ($prerequisites !== []) {
                $incomplete = DB::table('workPlanActions')
                    ->whereIn('id', $prerequisites)->where('status', '!=', 'complete')->exists();

                if ($incomplete) {
                    throw TrpcException::conflict('Complete all prerequisite actions before review submission');
                }
            }

            DB::table('workPlanActions')->where('id', $id)->where('entityId', $entityId)->update([
                'status' => 'ready_for_review',
                'progressPercent' => $progressPercent,
                'completionNotes' => $completionNotes,
                'evidenceDocumentId' => $evidenceDocumentId,
                // A resubmission clears the previous outcome, so an old approval
                // cannot be read as applying to the new work.
                'reviewOutcome' => null,
                'reviewNotes' => null,
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'work_plan.submit_review',
                'resourceType' => 'work_plan_action',
                'resourceId' => $id,
                'result' => 'success',
                'metadata' => ['progressPercent' => $progressPercent, 'evidenceDocumentId' => $evidenceDocumentId],
            ]);

            return ['success' => true];
        });

        $registry->mutation('compliance.reviewWorkPlan', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $id = Validate::id($input['id'] ?? null, 'id');
            $decision = Validate::enum($input['decision'] ?? null, ['approved', 'returned'], 'decision');
            $notes = Validate::string($input['notes'] ?? null, 'notes', 3, 4000);

            Authz::assertEntityCapability($ctx->userId(), $entityId, 'compliance.write');

            $action = DB::table('workPlanActions')->where('id', $id)->where('entityId', $entityId)->first();
            if ($action === null || $action->status !== 'ready_for_review') {
                throw TrpcException::conflict('Only submitted actions can be reviewed');
            }

            // Returning your own work is fine; approving it is not.
            if ((int) $action->createdBy === $ctx->userId() && $decision === 'approved') {
                throw TrpcException::forbidden('A different authorised user must approve this action');
            }

            $now = Dates::nowMillis();
            $approved = $decision === 'approved';

            DB::table('workPlanActions')->where('id', $id)->update([
                'status' => $approved ? 'complete' : 'in_progress',
                'progressPercent' => $approved ? 100 : $action->progressPercent,
                'reviewedAt' => $now,
                'reviewedBy' => $ctx->userId(),
                'reviewOutcome' => $decision,
                'reviewNotes' => $notes,
                'completedAt' => $approved ? $now : null,
                'completedBy' => $approved ? $ctx->userId() : null,
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => "work_plan.review_$decision",
                'resourceType' => 'work_plan_action',
                'resourceId' => $id,
                'result' => 'success',
                'metadata' => ['notesRecorded' => true],
            ]);

            return ['success' => true];
        });
    }

    private static function ragFor(object $row): string
    {
        return Rules::propertyObligationRag(
            $row->sourceType ?? null,
            $row->evidenceDocumentId === null ? null : (int) $row->evidenceDocumentId,
            $row->dueAt === null ? null : (int) $row->dueAt,
            $row->completedAt === null ? null : (int) $row->completedAt,
            (int) ($row->leadDays ?? 30),
        );
    }

    /**
     * The worst colour wins, so a single red obligation is not hidden by a
     * hundred green ones.
     *
     * @param array<int, string> $values
     */
    private static function worst(array $values): string
    {
        foreach (['red', 'amber', 'grey'] as $colour) {
            if (in_array($colour, $values, true)) {
                return $colour;
            }
        }

        return $values === [] ? 'grey' : 'green';
    }

    /**
     * Whether $from can reach $target by following dependencies.
     *
     * @param array<int, array<int, int>> $graph
     * @param array<int, bool> $visited
     */
    private static function reaches(array $graph, int $from, int $target, array &$visited = []): bool
    {
        if ($from === $target) {
            return true;
        }
        if (isset($visited[$from])) {
            return false;
        }
        $visited[$from] = true;

        foreach ($graph[$from] ?? [] as $next) {
            if (self::reaches($graph, $next, $target, $visited)) {
                return true;
            }
        }

        return false;
    }
}
