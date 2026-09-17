import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { complianceObligations, entities, incidents, properties, qualityReviews, workPlanActions } from "../../drizzle/schema";
import { getUserAccess } from "../authz";
import { protectedProcedure, router } from "../_core/trpc";
import { calculateRagStatus } from "../services/rules";
import { requireDb } from "./shared";

async function assertNominatedIndividualAccess(userId: number, entityId: number) {
  const { user, memberships } = await getUserAccess(userId);
  const membership = memberships.find(item => item.entityId === entityId && item.status === "active");
  if (!membership || (user.operationalRole !== "platform_admin" && membership.operationalRole !== "owner")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This governance workspace is available only to the Nominated Individual or an approved platform administrator. [GOV_NOMINATED_ACCESS_REQUIRED]",
    });
  }
  return membership;
}

/**
 * A deliberately aggregate-only governance view. It does not return resident,
 * staff, financial, safeguarding narrative, or document contents.
 */
export const nominatedIndividualRouter = router({
  summary: protectedProcedure
    .input(z.object({ entityId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertNominatedIndividualAccess(ctx.user.id, input.entityId);
      const db = await requireDb();
      const now = Date.now();
      const [entityRows, propertyRows, incidentRows, obligations, workPlans, reviews] = await Promise.all([
        db.select({ id: entities.id, name: entities.name, legalName: entities.legalName, status: entities.status })
          .from(entities).where(eq(entities.id, input.entityId)).limit(1),
        db.select({ id: properties.id, status: properties.status }).from(properties).where(eq(properties.entityId, input.entityId)),
        db.select({ id: incidents.id, severity: incidents.severity, status: incidents.status })
          .from(incidents).where(and(eq(incidents.entityId, input.entityId), ne(incidents.status, "closed"))),
        db.select({ id: complianceObligations.id, dueAt: complianceObligations.dueAt, completedAt: complianceObligations.completedAt, leadDays: complianceObligations.leadDays })
          .from(complianceObligations).where(eq(complianceObligations.entityId, input.entityId)),
        db.select({ id: workPlanActions.id, dueAt: workPlanActions.dueAt, status: workPlanActions.status })
          .from(workPlanActions).where(and(eq(workPlanActions.entityId, input.entityId), ne(workPlanActions.status, "complete"))).orderBy(asc(workPlanActions.dueAt)),
        db.select({ id: qualityReviews.id, status: qualityReviews.status, nextReviewDueAt: qualityReviews.nextReviewDueAt })
          .from(qualityReviews).where(eq(qualityReviews.entityId, input.entityId)),
      ]);
      const entity = entityRows[0];
      if (!entity) throw new TRPCError({ code: "NOT_FOUND", message: "The selected legal entity was not found. [GOV_ENTITY_NOT_FOUND]" });
      const rag = obligations.reduce((counts, obligation) => {
        counts[calculateRagStatus(obligation.dueAt, obligation.completedAt, obligation.leadDays)] += 1;
        return counts;
      }, { green: 0, amber: 0, red: 0, grey: 0 });
      const overdueWorkPlans = workPlans.filter(item => item.dueAt < now).length;
      const dueQualityReviews = reviews.filter(item => item.nextReviewDueAt && item.nextReviewDueAt < now + 30 * 86_400_000).length;
      return {
        entity,
        counts: {
          activeProperties: propertyRows.filter(item => item.status === "active").length,
          openHighRiskIncidents: incidentRows.filter(item => item.severity === "critical" || item.severity === "high").length,
          overdueCompliance: rag.red,
          complianceDueSoon: rag.amber,
          overdueWorkPlans,
          qualityReviewsDue: dueQualityReviews,
        },
        links: {
          compliance: "/compliance-dashboard",
          safeguarding: "/safeguarding",
          quality: "/quality-reviews",
          workPlans: "/work-plans",
          governance: "/governance",
        },
      };
    }),
});

export { assertNominatedIndividualAccess };
