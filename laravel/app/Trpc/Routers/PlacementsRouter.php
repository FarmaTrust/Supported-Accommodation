<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\AgePolicy;
use App\Support\Audit;
use App\Support\Authz;
use App\Support\Dates;
use App\Support\EncryptedFields;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * placements.*, mirroring server/routers/placements.ts.
 *
 * Young people, where they are placed, and the plans that say how they are
 * supported. Every read here is audited as safeguarding, because knowing that a
 * particular young person is at a particular address is itself the sensitive
 * fact.
 */
final class PlacementsRouter
{
    private const PLAN_TYPES = ['support', 'pathway', 'risk', 'safety', 'placement', 'transition'];

    private const ASSIGNMENT_ROLES = ['key_worker', 'co_worker', 'manager', 'oversight'];

    public static function register(Registry $registry): void
    {
        $registry->query('placements.list', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $propertyIds = Authz::currentShiftPropertyIds($ctx->userId(), $entityId, 'young_person.read');

            $access = Authz::userAccess($ctx->userId());
            $role = $access['user']['operationalRole'] === 'owner' ? 'owner' : null;
            if ($role === null) {
                foreach ($access['memberships'] as $membership) {
                    if ($membership['entityId'] === $entityId) {
                        $role = (string) $membership['operationalRole'];
                        break;
                    }
                }
            }

            $permitted = null;
            if ($role === 'support_worker') {
                $now = Dates::nowMillis();
                $permitted = DB::table('workerAssignments')
                    ->where('entityId', $entityId)->where('userId', $ctx->userId())
                    ->where(fn ($q) => $q->whereNull('startsAt')->orWhere('startsAt', '<=', $now))
                    ->where(fn ($q) => $q->whereNull('endsAt')->orWhere('endsAt', '>', $now))
                    ->pluck('placementId')->map(static fn ($id) => (int) $id)->all();

                // No live assignment means no young people, and the empty answer
                // is still recorded so the filter is visible in the trail.
                if ($permitted === []) {
                    Audit::write([
                        'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                        'action' => 'placement.list', 'resourceType' => 'placement',
                        'sensitivity' => 'safeguarding', 'result' => 'allowed',
                        'reasonCode' => 'assignment_filtered', 'metadata' => ['resultCount' => 0],
                    ]);

                    return [];
                }
            }

            $query = DB::table('placements as p')
                ->join('youngPeople as y', 'y.id', '=', 'p.youngPersonId')
                ->leftJoin('properties as pr', 'pr.id', '=', 'p.propertyId')
                ->leftJoin('localAuthorities as la', 'la.id', '=', 'p.localAuthorityId')
                ->where('p.entityId', $entityId)
                ->select([
                    'p.id', 'p.entityId', 'p.status', 'p.propertyId', 'p.localAuthorityId',
                    'p.startAt', 'p.reviewDueAt', 'p.purchaseOrderNumber',
                    'y.id as youngPersonId', 'y.reference', 'y.preferredName',
                    'pr.name as propertyName', 'la.name as authorityName',
                ]);

            if ($propertyIds !== []) {
                $query->whereIn('p.propertyId', $propertyIds);
            }
            if ($permitted !== null) {
                $query->whereIn('p.id', $permitted);
            }

            $rows = $query->get()->map(static fn ($r) => (array) $r)->all();

            Audit::write([
                'actorUserId' => $ctx->userId(), 'entityId' => $entityId,
                'action' => 'placement.list', 'resourceType' => 'placement',
                'sensitivity' => 'safeguarding', 'result' => 'allowed',
                'reasonCode' => $role === 'support_worker' ? 'assignment_filtered' : "role:$role",
                'metadata' => ['resultCount' => count($rows)],
            ]);

            return $rows;
        });

        $registry->mutation('placements.create', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            Authz::assertEntityCapability($ctx->userId(), $entityId, 'young_person.write');

            $access = Authz::userAccess($ctx->userId());
            $role = $access['user']['operationalRole'] === 'owner' ? 'owner' : null;
            foreach ($access['memberships'] as $membership) {
                if ($role === null && $membership['entityId'] === $entityId) {
                    $role = (string) $membership['operationalRole'];
                }
            }

            $reference = Validate::string($input['reference'] ?? null, 'reference', 3, 64);
            $dateOfBirth = isset($input['dateOfBirth']) ? Validate::int($input['dateOfBirth'], 'dateOfBirth') : null;
            $startAt = isset($input['startAt']) ? Validate::int($input['startAt'], 'startAt') : null;
            $referralReceivedAt = isset($input['referralReceivedAt']) ? Validate::int($input['referralReceivedAt'], 'referralReceivedAt') : null;
            $ageOverrideReason = Validate::optionalString($input['ageOverrideReason'] ?? null, 'ageOverrideReason', 4000);

            $ageDecision = AgePolicy::assert(
                $dateOfBirth,
                $startAt ?? $referralReceivedAt ?? Dates::nowMillis(),
                $ageOverrideReason,
                in_array($role, ['owner', 'registered_manager'], true),
            );

            // Two records for one young person split their history, and a
            // safeguarding history with a piece missing is worse than none.
            $duplicate = DB::table('youngPeople')
                ->where('entityId', $entityId)->where('reference', $reference)->first('id');

            if ($duplicate !== null) {
                throw TrpcException::conflict(
                    "Young-person reference $reference already exists. Open the existing referral or placement rather than creating a duplicate."
                );
            }

            $propertyId = Validate::optionalId($input['propertyId'] ?? null, 'propertyId');

            $result = DB::transaction(static function () use ($ctx, $entityId, $reference, $dateOfBirth, $startAt, $referralReceivedAt, $propertyId, $input): array {
                $youngPersonId = (int) DB::table('youngPeople')->insertGetId([
                    'entityId' => $entityId,
                    'reference' => $reference,
                    'preferredName' => Validate::optionalString($input['preferredName'] ?? null, 'preferredName', 120),
                    'dateOfBirth' => $dateOfBirth,
                    'status' => $startAt !== null ? 'placed' : 'referral',
                    'createdBy' => $ctx->userId(),
                ]);

                $placementId = (int) DB::table('placements')->insertGetId([
                    'entityId' => $entityId,
                    'youngPersonId' => $youngPersonId,
                    'propertyId' => $propertyId,
                    'localAuthorityId' => Validate::optionalId($input['localAuthorityId'] ?? null, 'localAuthorityId'),
                    'placementBasis' => Validate::optionalEnum($input['placementBasis'] ?? null, ['section_22c_6_d', 'section_23b_8_b', 'other'], 'placementBasis'),
                    'referralReceivedAt' => $referralReceivedAt ?? Dates::nowMillis(),
                    'startAt' => $startAt,
                    'reviewDueAt' => isset($input['reviewDueAt']) ? Validate::int($input['reviewDueAt'], 'reviewDueAt') : null,
                    'purchaseOrderNumber' => Validate::optionalString($input['purchaseOrderNumber'] ?? null, 'purchaseOrderNumber', 100),
                    'hasEhcPlan' => Validate::bool($input['hasEhcPlan'] ?? false, 'hasEhcPlan') ? 1 : 0,
                    'iroName' => Validate::optionalString($input['iroName'] ?? null, 'iroName', 180),
                    'iroEmail' => ($input['iroEmail'] ?? '') === '' ? null : Validate::email($input['iroEmail']),
                    'personalAdviserName' => Validate::optionalString($input['personalAdviserName'] ?? null, 'personalAdviserName', 180),
                    'personalAdviserEmail' => ($input['personalAdviserEmail'] ?? '') === '' ? null : Validate::email($input['personalAdviserEmail']),
                    // A placement with no start date is still a referral.
                    'status' => $startAt !== null ? 'active' : 'referred',
                    'createdBy' => $ctx->userId(),
                ]);

                return ['youngPersonId' => $youngPersonId, 'placementId' => $placementId];
            });

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $propertyId,
                'action' => 'placement.create',
                'resourceType' => 'placement',
                'resourceId' => $result['placementId'],
                'sensitivity' => 'safeguarding',
                'result' => 'success',
                'metadata' => [
                    'minimumAge' => AgePolicy::MINIMUM_AGE,
                    'ageAtStart' => $ageDecision['age'],
                    'agePolicyOverridden' => $ageDecision['overridden'],
                    // The reason is kept encrypted in the trail: it explains an
                    // exceptional decision about a child.
                    'overrideReasonCiphertext' => $ageDecision['overridden'] && $ageOverrideReason !== null
                        ? EncryptedFields::seal($ageOverrideReason)
                        : null,
                ],
            ]);

            return $result;
        });

        $registry->query('placements.detail', Registry::USER, static function (Context $ctx, mixed $input): array {
            $placementId = Validate::id($input['placementId'] ?? null, 'placementId');
            $placement = Authz::assertCurrentShiftPlacementCapability($ctx->userId(), $placementId, 'young_person.read')['placement'];

            $row = DB::table('placements as p')
                ->join('youngPeople as y', 'y.id', '=', 'p.youngPersonId')
                ->leftJoin('properties as pr', 'pr.id', '=', 'p.propertyId')
                ->leftJoin('localAuthorities as la', 'la.id', '=', 'p.localAuthorityId')
                ->where('p.id', $placementId)
                ->select(['p.*'])
                ->first();

            $youngPerson = DB::table('youngPeople')->where('id', $placement['youngPersonId'])->first();
            $property = $placement['propertyId'] === null ? null
                : DB::table('properties')->where('id', $placement['propertyId'])->first();
            $authority = $placement['localAuthorityId'] === null ? null
                : DB::table('localAuthorities')->where('id', $placement['localAuthorityId'])->first();

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => (int) $placement['entityId'],
                'propertyId' => $placement['propertyId'] === null ? null : (int) $placement['propertyId'],
                'action' => 'placement.read',
                'resourceType' => 'placement',
                'resourceId' => $placementId,
                'sensitivity' => 'safeguarding',
                'result' => 'allowed',
            ]);

            return [
                'placement' => $row === null ? null : (array) $row,
                'youngPerson' => $youngPerson === null ? null : (array) $youngPerson,
                'property' => $property === null ? null : (array) $property,
                'authority' => $authority === null ? null : (array) $authority,
            ];
        });

        $registry->query('placements.plans', Registry::USER, static function (Context $ctx, mixed $input): array {
            $placementId = Validate::id($input['placementId'] ?? null, 'placementId');
            Authz::assertCurrentShiftPlacementCapability($ctx->userId(), $placementId, 'young_person.read');

            return DB::table('carePlans')->where('placementId', $placementId)->get()
                ->map(static fn ($r) => (array) $r)->all();
        });

        $registry->mutation('placements.createPlan', Registry::USER, static function (Context $ctx, mixed $input): array {
            $placementId = Validate::id($input['placementId'] ?? null, 'placementId');
            $placement = Authz::assertCurrentShiftPlacementCapability($ctx->userId(), $placementId, 'young_person.write')['placement'];

            $planType = Validate::enum($input['planType'] ?? null, self::PLAN_TYPES, 'planType');
            $entityId = (int) $placement['entityId'];

            // Plans are versioned rather than edited, so an earlier version stays
            // readable as the plan that was in force at the time.
            $version = 1 + (int) DB::table('carePlans')
                ->where('placementId', $placementId)->where('planType', $planType)->max('version');

            $templateId = Validate::optionalId($input['templateId'] ?? null, 'templateId');
            $template = $templateId === null ? null
                : DB::table('documentTemplates')->where('id', $templateId)
                    ->where('entityId', $entityId)->where('status', 'active')->first();

            $content = isset($input['content']) ? Validate::object($input['content'], 'content') : [];
            $content['template'] = $template === null ? null : [
                'id' => (int) $template->id, 'title' => $template->title,
                'category' => $template->category, 'version' => $template->version,
            ];

            $planId = (int) DB::table('carePlans')->insertGetId([
                'entityId' => $entityId,
                'placementId' => $placementId,
                'planType' => $planType,
                'version' => $version,
                'summary' => Validate::string($input['summary'] ?? null, 'summary', 10, 8000),
                'content' => json_encode($content, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                'reviewDueAt' => isset($input['reviewDueAt']) ? Validate::int($input['reviewDueAt'], 'reviewDueAt') : null,
                'createdBy' => $ctx->userId(),
            ]);

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'propertyId' => $placement['propertyId'] === null ? null : (int) $placement['propertyId'],
                'action' => 'care_plan.create',
                'resourceType' => 'care_plan',
                'resourceId' => $planId,
                'sensitivity' => 'safeguarding',
                'result' => 'success',
                'metadata' => [
                    'planType' => $planType, 'version' => $version,
                    'templateId' => $template->id ?? null, 'templateVersion' => $template->version ?? null,
                ],
            ]);

            return ['id' => $planId, 'version' => $version];
        });

        $registry->mutation('placements.approvePlan', Registry::USER, static function (Context $ctx, mixed $input): array {
            $placementId = Validate::id($input['placementId'] ?? null, 'placementId');
            $planId = Validate::id($input['planId'] ?? null, 'planId');

            $result = Authz::assertPlacementCapability($ctx->userId(), $placementId, 'young_person.write');
            $placement = $result['placement'];

            // Approving a support or risk plan is the decision the plan rests
            // on, so it is a manager's to make.
            if (in_array($result['access']['role'], ['support_worker', 'read_only'], true)) {
                throw TrpcException::forbidden('Manager approval is required');
            }

            $plan = DB::table('carePlans')->where('id', $planId)->where('placementId', $placementId)->first();
            if ($plan === null) {
                throw TrpcException::notFound('Plan not found');
            }

            DB::transaction(static function () use ($ctx, $placementId, $planId, $plan): void {
                // Exactly one approved plan of a type at a time: the previous one
                // is superseded in the same transaction, so there is never a
                // moment with two in force or none.
                DB::table('carePlans')
                    ->where('placementId', $placementId)->where('planType', $plan->planType)->where('status', 'approved')
                    ->update(['status' => 'superseded']);

                DB::table('carePlans')->where('id', $planId)->update([
                    'status' => 'approved',
                    'approvedAt' => Dates::nowMillis(),
                    'approvedBy' => $ctx->userId(),
                ]);
            });

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => (int) $placement['entityId'],
                'propertyId' => $placement['propertyId'] === null ? null : (int) $placement['propertyId'],
                'action' => 'care_plan.approve',
                'resourceType' => 'care_plan',
                'resourceId' => $planId,
                'sensitivity' => 'safeguarding',
                'result' => 'success',
            ]);

            return ['success' => true];
        });

        $registry->mutation('placements.assignWorker', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            $placementId = Validate::id($input['placementId'] ?? null, 'placementId');
            $userId = Validate::id($input['userId'] ?? null, 'userId');
            $assignmentRole = Validate::enum($input['assignmentRole'] ?? null, self::ASSIGNMENT_ROLES, 'assignmentRole');

            Authz::assertEntityCapability($ctx->userId(), $entityId, 'young_person.write');

            // Reassigning somebody who was removed clears the end date rather
            // than adding a second row, so the assignment history stays one line
            // per person and role.
            DB::table('workerAssignments')->upsert(
                [[
                    'entityId' => $entityId,
                    'placementId' => $placementId,
                    'userId' => $userId,
                    'assignmentRole' => $assignmentRole,
                    'startsAt' => Dates::nowMillis(),
                    'endsAt' => null,
                    'createdBy' => $ctx->userId(),
                ]],
                ['placementId', 'userId', 'assignmentRole'],
                ['endsAt'],
            );

            Audit::write([
                'actorUserId' => $ctx->userId(),
                'entityId' => $entityId,
                'action' => 'placement.assign_worker',
                'resourceType' => 'placement',
                'resourceId' => $placementId,
                'sensitivity' => 'safeguarding',
                'result' => 'success',
                'metadata' => ['assignedUserId' => $userId, 'assignmentRole' => $assignmentRole],
            ]);

            return ['success' => true];
        });
    }
}
