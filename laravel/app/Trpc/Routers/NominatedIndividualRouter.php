<?php

declare(strict_types=1);

namespace App\Trpc\Routers;

use App\Support\Authz;
use App\Support\Dates;
use App\Support\Rules;
use App\Trpc\Context;
use App\Trpc\Registry;
use App\Trpc\TrpcException;
use App\Trpc\Validate;
use Illuminate\Support\Facades\DB;

/**
 * nominatedIndividual.summary, mirroring
 * server/routers/nominatedIndividual.ts.
 *
 * The Nominated Individual is answerable for the service as a whole, which is a
 * different thing from working in it. This view is counts and links only: how
 * many properties are open, how many serious incidents are unresolved, how much
 * compliance is overdue. It returns no resident, staff, financial or
 * safeguarding narrative and no document contents, because holding the
 * governance role is not a reason to read a young person's records.
 */
final class NominatedIndividualRouter
{
    private const DAY_MS = 86400000;

    /** A quality review inside this window counts as due. */
    private const REVIEW_HORIZON_DAYS = 30;

    public static function register(Registry $registry): void
    {
        $registry->query('nominatedIndividual.summary', Registry::USER, static function (Context $ctx, mixed $input): array {
            $entityId = Validate::id($input['entityId'] ?? null, 'entityId');
            self::assertAccess($ctx, $entityId);

            $entity = DB::table('entities')->where('id', $entityId)->first(['id', 'name', 'legalName', 'status']);
            if ($entity === null) {
                throw TrpcException::notFound('The selected legal entity was not found. [GOV_ENTITY_NOT_FOUND]');
            }

            $now = Dates::nowMillis();

            $activeProperties = DB::table('properties')
                ->where('entityId', $entityId)->where('status', 'active')->count();

            $openHighRiskIncidents = DB::table('incidents')
                ->where('entityId', $entityId)
                ->where('status', '!=', 'closed')
                ->whereIn('severity', ['critical', 'high'])
                ->count();

            $overdue = 0;
            $dueSoon = 0;
            foreach (DB::table('complianceObligations')->where('entityId', $entityId)
                ->get(['dueAt', 'completedAt', 'leadDays']) as $obligation) {
                $rag = Rules::ragStatus(
                    $obligation->dueAt === null ? null : (int) $obligation->dueAt,
                    $obligation->completedAt === null ? null : (int) $obligation->completedAt,
                    (int) $obligation->leadDays,
                    $now,
                );
                if ($rag === 'red') {
                    $overdue++;
                } elseif ($rag === 'amber') {
                    $dueSoon++;
                }
            }

            $overdueWorkPlans = DB::table('workPlanActions')
                ->where('entityId', $entityId)
                ->where('status', '!=', 'complete')
                ->where('dueAt', '<', $now)
                ->count();

            $qualityReviewsDue = DB::table('qualityReviews')
                ->where('entityId', $entityId)
                ->whereNotNull('nextReviewDueAt')
                ->where('nextReviewDueAt', '<', $now + self::REVIEW_HORIZON_DAYS * self::DAY_MS)
                ->count();

            return [
                'entity' => (array) $entity,
                'counts' => [
                    'activeProperties' => $activeProperties,
                    'openHighRiskIncidents' => $openHighRiskIncidents,
                    'overdueCompliance' => $overdue,
                    'complianceDueSoon' => $dueSoon,
                    'overdueWorkPlans' => $overdueWorkPlans,
                    'qualityReviewsDue' => $qualityReviewsDue,
                ],
                // Where to go to see the detail, under that screen's own
                // permission check rather than this one.
                'links' => [
                    'compliance' => '/compliance-dashboard',
                    'safeguarding' => '/safeguarding',
                    'quality' => '/quality-reviews',
                    'workPlans' => '/work-plans',
                    'governance' => '/governance',
                ],
            ];
        });
    }

    /**
     * The company administrator, or a platform administrator who holds a
     * membership here. Nobody else, whatever else they can reach.
     */
    public static function assertAccess(Context $ctx, int $entityId): void
    {
        $access = Authz::userAccess($ctx->userId());

        $membership = null;
        foreach ($access['memberships'] as $candidate) {
            if ($candidate['entityId'] === $entityId) {
                $membership = $candidate;
                break;
            }
        }

        $isPlatformAdmin = ($access['user']['operationalRole'] ?? null) === 'platform_admin';

        if ($membership === null || (!$isPlatformAdmin && $membership['operationalRole'] !== 'owner')) {
            throw TrpcException::forbidden(
                'This governance workspace is available only to the Nominated Individual or an approved platform administrator. [GOV_NOMINATED_ACCESS_REQUIRED]'
            );
        }
    }
}
