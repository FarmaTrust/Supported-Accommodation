import { and, desc, eq, gt, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { documentTemplates, incidents, keyWorkerReports, placements, properties, users, workerAssignments, youngPeople } from "../../drizzle/schema";
import { assertCurrentShiftPlacementCapability, assertCurrentShiftPropertyCapability, getUserAccess, listCurrentShiftPropertyIds } from "../authz";
import { protectedProcedure, router } from "../_core/trpc";
import { writeAuditEvent } from "../services/audit";
import { summariseReportCompletion } from "../services/reportCompletion";
import { requireDb } from "./shared";

const reportFields = z.object({
  entityId: z.number().int().positive(), propertyId: z.number().int().positive(), placementId: z.number().int().positive(),
  reportType: z.enum(["daily", "weekly", "monthly_review"]), reportDate: z.number().int(), mood: z.string().max(80).optional(),
  attitude: z.string().max(120).optional(), learning: z.string().max(8000).optional(), enthusiasm: z.string().max(120).optional(), discussions: z.string().max(8000).optional(), pointsToNote: z.string().max(8000).optional(),
  plan: z.string().max(8000).optional(), nextReviewAt: z.number().int().optional(), suggestions: z.string().max(8000).optional(),
  status: z.enum(["draft", "submitted"]).default("draft"),
});

export const keyworkRouter = router({
  context: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const propertyIds = await listCurrentShiftPropertyIds(ctx.user.id, input.entityId, "young_person.read");
    const db = await requireDb();
    const propertyRows = propertyIds.length ? await db.select().from(properties).where(inArray(properties.id, propertyIds)) : [];
    const { user, memberships } = await getUserAccess(ctx.user.id);
    const role = user.operationalRole === "owner" ? "owner" : memberships.find(item => item.entityId === input.entityId)?.operationalRole;
    const now = Date.now();
    const assignments = role === "support_worker" ? await db.select({ placementId: workerAssignments.placementId }).from(workerAssignments).where(and(
      eq(workerAssignments.entityId, input.entityId),
      eq(workerAssignments.userId, ctx.user.id),
      or(isNull(workerAssignments.startsAt), lte(workerAssignments.startsAt, now)),
      or(isNull(workerAssignments.endsAt), gt(workerAssignments.endsAt, now)),
    )) : [];
    const assignmentIds = assignments.map(item => item.placementId);
    if (role === "support_worker" && (!propertyIds.length || !assignmentIds.length)) return { properties: [], placements: [] };
    const predicates = [eq(placements.entityId, input.entityId)];
    if (propertyIds.length) predicates.push(inArray(placements.propertyId, propertyIds));
    if (role === "support_worker") predicates.push(inArray(placements.id, assignmentIds));
    const placementsRows = await db.select({ id: placements.id, propertyId: placements.propertyId, reference: youngPeople.reference, preferredName: youngPeople.preferredName, status: placements.status, placementUpdatedAt: placements.updatedAt })
      .from(placements).innerJoin(youngPeople, eq(youngPeople.id, placements.youngPersonId))
      .where(and(...predicates));
    return { properties: propertyRows, placements: placementsRows };
  }),

  reports: protectedProcedure.input(z.object({ placementId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertCurrentShiftPlacementCapability(ctx.user.id, input.placementId, "young_person.read");
    const db = await requireDb();
    return db.select().from(keyWorkerReports).where(eq(keyWorkerReports.placementId, input.placementId)).orderBy(desc(keyWorkerReports.reportDate));
  }),

  reportCompletion: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(),
    from: z.number().int().optional(),
    to: z.number().int().optional(),
  })).query(async ({ ctx, input }) => {
    const propertyIds = await listCurrentShiftPropertyIds(ctx.user.id, input.entityId, "young_person.read");
    const now = Date.now();
    const from = input.from ?? now - 7 * 86_400_000;
    const to = input.to ?? now;
    if (to < from) throw new Error("Report completion end must be after the start of the selected period");
    if (!propertyIds.length) return { from, to, properties: [] };
    const db = await requireDb();
    const { user, memberships } = await getUserAccess(ctx.user.id);
    const role = user.operationalRole === "owner" ? "owner" : memberships.find(item => item.entityId === input.entityId)?.operationalRole;
    const rows = await db.select({
      id: keyWorkerReports.id,
      propertyId: keyWorkerReports.propertyId,
      propertyName: properties.name,
      authorUserId: keyWorkerReports.authorUserId,
      authorName: users.name,
      status: keyWorkerReports.status,
      reportDate: keyWorkerReports.reportDate,
    }).from(keyWorkerReports)
      .innerJoin(properties, eq(properties.id, keyWorkerReports.propertyId))
      .innerJoin(users, eq(users.id, keyWorkerReports.authorUserId))
      .where(and(
        eq(keyWorkerReports.entityId, input.entityId),
        inArray(keyWorkerReports.propertyId, propertyIds),
        gte(keyWorkerReports.reportDate, from),
        lte(keyWorkerReports.reportDate, to),
      ));
    const authorisedRows = role === "support_worker" ? rows.filter(row => row.authorUserId === ctx.user.id) : rows;
    const propertiesSummary = summariseReportCompletion(authorisedRows);
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "keywork.report_completion.read", resourceType: "key_worker_report", sensitivity: "general", result: "success", metadata: { from, to, propertyCount: propertiesSummary.length, selfOnly: role === "support_worker" } });
    return { from, to, properties: propertiesSummary };
  }),

  createReport: protectedProcedure.input(reportFields).mutation(async ({ ctx, input }) => {
    const { placement } = await assertCurrentShiftPlacementCapability(ctx.user.id, input.placementId, "young_person.write");
    if (placement.propertyId !== input.propertyId || placement.entityId !== input.entityId) throw new Error("Placement scope does not match selected property");
    const db = await requireDb();
    const [result] = await db.insert(keyWorkerReports).values({ ...input, authorUserId: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: `keywork.${input.reportType}.create`, resourceType: "key_worker_report", resourceId: result.id, sensitivity: "safeguarding", result: "success", metadata: { status: input.status } });
    return { id: result.id };
  }),

  incidents: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const propertyIds = await listCurrentShiftPropertyIds(ctx.user.id, input.entityId, "incident.read");
    if (!propertyIds.length) return [];
    const db = await requireDb();
    return db.select().from(incidents).where(inArray(incidents.propertyId, propertyIds)).orderBy(desc(incidents.occurredAt));
  }),

  createIncident: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(), propertyId: z.number().int().positive(), placementId: z.number().int().positive().optional(),
    category: z.enum(["safeguarding", "missing", "exploitation", "police", "abuse_allegation", "child_protection_enquiry", "restraint", "health_safety", "complaint", "other"]),
    severity: z.enum(["low", "medium", "high", "critical"]), occurredAt: z.number().int(), summary: z.string().min(5).max(240),
    details: z.string().min(20).max(12000), immediateActions: z.string().max(8000).optional(), templateId: z.number().int().positive().optional(),
  })).mutation(async ({ ctx, input }) => {
    await assertCurrentShiftPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "incident.write");
    if (input.placementId) {
      const { placement } = await assertCurrentShiftPlacementCapability(ctx.user.id, input.placementId, "incident.write");
      if (placement.entityId !== input.entityId || placement.propertyId !== input.propertyId) throw new Error("Placement scope does not match the selected property");
    }
    const notifiableCategories = new Set(["exploitation", "police", "abuse_allegation", "child_protection_enquiry", "restraint"]);
    const requiresReview = notifiableCategories.has(input.category) || input.severity === "critical";
    const db = await requireDb();
    const [template] = input.templateId ? await db.select().from(documentTemplates).where(and(eq(documentTemplates.id, input.templateId), eq(documentTemplates.entityId, input.entityId), eq(documentTemplates.category, "incident_notification"), eq(documentTemplates.status, "active"))).limit(1) : [];
    const { templateId: _templateId, ...incidentInput } = input;
    const [result] = await db.insert(incidents).values({
      ...incidentInput, createdBy: ctx.user.id, notifiability: requiresReview ? "unreviewed" : "not_notifiable",
      notificationDueAt: requiresReview ? Date.now() : null, status: requiresReview ? "under_review" : "open",
    }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: "incident.create", resourceType: "incident", resourceId: result.id, sensitivity: "safeguarding", result: "success", metadata: { category: input.category, severity: input.severity, notificationReviewRequired: requiresReview, templateId: template?.id ?? null, templateVersion: template?.version ?? null } });
    return { id: result.id, notificationReviewRequired: requiresReview };
  }),
});
