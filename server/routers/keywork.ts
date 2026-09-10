import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { documentTemplates, incidents, keyWorkerReports, placements, properties, workerAssignments, youngPeople } from "../../drizzle/schema";
import { assertPlacementCapability, assertPropertyCapability, getUserAccess, listAccessiblePropertyIds } from "../authz";
import { protectedProcedure, router } from "../_core/trpc";
import { writeAuditEvent } from "../services/audit";
import { requireDb } from "./shared";

const reportFields = z.object({
  entityId: z.number().int().positive(), propertyId: z.number().int().positive(), placementId: z.number().int().positive(),
  reportType: z.enum(["daily", "weekly", "monthly_review"]), reportDate: z.number().int(), mood: z.string().max(80).optional(),
  attitude: z.string().max(120).optional(), discussions: z.string().max(8000).optional(), pointsToNote: z.string().max(8000).optional(),
  plan: z.string().max(8000).optional(), nextReviewAt: z.number().int().optional(), suggestions: z.string().max(8000).optional(),
  status: z.enum(["draft", "submitted"]).default("draft"),
});

export const keyworkRouter = router({
  context: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const propertyIds = await listAccessiblePropertyIds(ctx.user.id, input.entityId, "young_person.read");
    const db = await requireDb();
    const propertyRows = propertyIds.length ? await db.select().from(properties).where(inArray(properties.id, propertyIds)) : [];
    const { user, memberships } = await getUserAccess(ctx.user.id);
    const role = user.operationalRole === "owner" ? "owner" : memberships.find(item => item.entityId === input.entityId)?.operationalRole;
    const assignments = role === "support_worker" ? await db.select({ placementId: workerAssignments.placementId }).from(workerAssignments).where(eq(workerAssignments.userId, ctx.user.id)) : [];
    const assignmentIds = assignments.map(item => item.placementId);
    if (role === "support_worker" && !assignmentIds.length) return { properties: propertyRows, placements: [] };
    const predicates = [eq(placements.entityId, input.entityId)];
    if (propertyIds.length) predicates.push(inArray(placements.propertyId, propertyIds));
    if (role === "support_worker") predicates.push(inArray(placements.id, assignmentIds));
    const placementsRows = await db.select({ id: placements.id, propertyId: placements.propertyId, reference: youngPeople.reference, preferredName: youngPeople.preferredName, status: placements.status, placementUpdatedAt: placements.updatedAt })
      .from(placements).innerJoin(youngPeople, eq(youngPeople.id, placements.youngPersonId))
      .where(and(...predicates));
    return { properties: propertyRows, placements: placementsRows };
  }),

  reports: protectedProcedure.input(z.object({ placementId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPlacementCapability(ctx.user.id, input.placementId, "young_person.read");
    const db = await requireDb();
    return db.select().from(keyWorkerReports).where(eq(keyWorkerReports.placementId, input.placementId)).orderBy(desc(keyWorkerReports.reportDate));
  }),

  createReport: protectedProcedure.input(reportFields).mutation(async ({ ctx, input }) => {
    const { placement } = await assertPlacementCapability(ctx.user.id, input.placementId, "young_person.write");
    if (placement.propertyId !== input.propertyId || placement.entityId !== input.entityId) throw new Error("Placement scope does not match selected property");
    const db = await requireDb();
    const [result] = await db.insert(keyWorkerReports).values({ ...input, authorUserId: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: `keywork.${input.reportType}.create`, resourceType: "key_worker_report", resourceId: result.id, sensitivity: "safeguarding", result: "success", metadata: { status: input.status } });
    return { id: result.id };
  }),

  incidents: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const propertyIds = await listAccessiblePropertyIds(ctx.user.id, input.entityId, "incident.read");
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
    await assertPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "incident.write");
    if (input.placementId) await assertPlacementCapability(ctx.user.id, input.placementId, "incident.write");
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
