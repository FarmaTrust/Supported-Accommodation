import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, automationRules, complianceObligations, documents, entityMemberships, workPlanActions, workPlanDependencies } from "../../drizzle/schema";
import { assertEntityCapability, getUserAccess, listAccessiblePropertyIds } from "../authz";
import { protectedProcedure, router } from "../_core/trpc";
import { writeAuditEvent } from "../services/audit";
import { calculateRagStatus } from "../services/rules";
import { calculatePropertyObligationRag } from "../services/propertyComplianceRules";
import { requireDb } from "./shared";

export const complianceRouter = router({
  rollup: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "compliance.read");
    const db = await requireDb();
    const rows = await db.select().from(complianceObligations).where(eq(complianceObligations.entityId, input.entityId));
    const ranked = rows.map(item => ({ ...item, calculatedRag: calculatePropertyObligationRag(item) }));
    const worst = (values: string[]) => values.includes("red") ? "red" : values.includes("amber") ? "amber" : values.includes("grey") ? "grey" : "green";
    const groups = (field: "propertyId" | "staffProfileId" | "placementId") => Object.values(ranked.reduce<Record<string, { id: number; green: number; amber: number; red: number; grey: number; ragStatus: string }>>((acc, item) => {
      const id = item[field]; if (!id) return acc; const key = String(id); const current = acc[key] ?? { id, green: 0, amber: 0, red: 0, grey: 0, ragStatus: "grey" }; current[item.calculatedRag] += 1; current.ragStatus = worst([current.ragStatus, item.calculatedRag]); acc[key] = current; return acc;
    }, {}));
    const counts = ranked.reduce((acc, item) => ({ ...acc, [item.calculatedRag]: acc[item.calculatedRag] + 1 }), { green: 0, amber: 0, red: 0, grey: 0 });
    return { platform: { ragStatus: worst(ranked.map(item => item.calculatedRag)), count: ranked.length }, entity: { entityId: input.entityId, ragStatus: worst(ranked.map(item => item.calculatedRag)), ...counts }, properties: groups("propertyId"), staff: groups("staffProfileId"), youngPeople: groups("placementId"), requirements: ranked.map(item => ({ id: item.id, title: item.title, ragStatus: item.calculatedRag })) };
  }),

  platformRollup: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb(); const { memberships } = await getUserAccess(ctx.user.id); const ids = memberships.filter(item => item.status === "active").map(item => item.entityId); if (!ids.length) return { ragStatus: "grey" as const, entities: 0, requirements: 0 };
    const rows = await db.select().from(complianceObligations).where(inArray(complianceObligations.entityId, ids)); const states = rows.map(item => calculatePropertyObligationRag(item));
    return { ragStatus: states.includes("red") ? "red" as const : states.includes("amber") ? "amber" as const : states.length ? "green" as const : "grey" as const, entities: new Set(rows.map(item => item.entityId)).size, requirements: rows.length };
  }),

  reminderRules: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "compliance.read"); const db = await requireDb(); return db.select().from(automationRules).where(eq(automationRules.entityId, input.entityId));
  }),

  createReminderRule: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), name: z.string().min(3).max(180), ruleType: z.enum(["compliance", "review", "work_plan", "policy", "placement", "invoice"]), leadDays: z.number().int().min(0).max(365), escalationDays: z.number().int().min(1).max(365), ownerRole: z.string().min(2).max(80), escalationRoute: z.array(z.string().min(2).max(80)).min(1).max(5), requireAcknowledgement: z.boolean().default(true), snoozeDays: z.number().int().min(0).max(30).default(3) })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write"); const db = await requireDb(); const { entityId, name, ruleType, ...configuration } = input; const [rule] = await db.insert(automationRules).values({ entityId, name, ruleType, configuration, createdBy: ctx.user.id }).$returningId(); await writeAuditEvent({ actorUserId: ctx.user.id, entityId, action: "automation_rule.create", resourceType: "automation_rule", resourceId: rule.id, result: "success", metadata: { ruleType, configuration } }); return { id: rule.id };
  }),

  setReminderRuleEnabled: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), id: z.number().int().positive(), enabled: z.boolean() })).mutation(async ({ ctx, input }) => { await assertEntityCapability(ctx.user.id, input.entityId, "config.write"); const db = await requireDb(); await db.update(automationRules).set({ enabled: input.enabled ? 1 : 0 }).where(and(eq(automationRules.id, input.id), eq(automationRules.entityId, input.entityId))); await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "automation_rule.toggle", resourceType: "automation_rule", resourceId: input.id, result: "success", metadata: { enabled: input.enabled } }); return { success: true }; }),

  list: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), status: z.string().optional() })).query(async ({ ctx, input }) => {
    const propertyIds = await listAccessiblePropertyIds(ctx.user.id, input.entityId, "compliance.read");
    const db = await requireDb();
    const rows = await db.select().from(complianceObligations).where(
      propertyIds.length ? and(eq(complianceObligations.entityId, input.entityId), inArray(complianceObligations.propertyId, propertyIds)) : eq(complianceObligations.entityId, input.entityId),
    ).orderBy(asc(complianceObligations.dueAt));
    return rows.map(item => ({ ...item, ragStatus: calculatePropertyObligationRag(item) }));
  }),

  create: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(), propertyId: z.number().int().positive().optional(),
    category: z.enum(["property", "workforce", "placement", "policy", "quality", "finance", "data_protection"]),
    requirementKey: z.string().min(2).max(120), title: z.string().min(3).max(220), basis: z.string().max(220).optional(),
    ownerUserId: z.number().int().positive().optional(), ownerRole: z.string().max(80).optional(), dueAt: z.number().int(), leadDays: z.number().int().min(0).max(365).default(30), recurrence: z.string().max(80).optional(),
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "compliance.write");
    const db = await requireDb();
    const ragStatus = calculateRagStatus(input.dueAt, null, input.leadDays);
    const status = ragStatus === "red" ? "overdue" : ragStatus === "amber" ? "due_soon" : "not_due";
    const [result] = await db.insert(complianceObligations).values({ ...input, ragStatus, status, createdBy: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: "compliance.create", resourceType: "compliance_obligation", resourceId: result.id, result: "success" });
    return { id: result.id };
  }),

  complete: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), id: z.number().int().positive(), evidenceDocumentId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "compliance.write");
    const db = await requireDb();
    const [obligation] = await db.select({ id: complianceObligations.id, sourceType: complianceObligations.sourceType }).from(complianceObligations).where(and(eq(complianceObligations.id, input.id), eq(complianceObligations.entityId, input.entityId))).limit(1);
    if (!obligation) throw new Error("Compliance obligation was not found");
    if (obligation.sourceType === "property_evidence") throw new Error("Property certificate obligations are updated from Property records. Link approved evidence there instead of marking this renewal complete manually.");
    await db.update(complianceObligations).set({ status: "complete", ragStatus: "green", completedAt: Date.now(), evidenceDocumentId: input.evidenceDocumentId }).where(and(eq(complianceObligations.id, input.id), eq(complianceObligations.entityId, input.entityId)));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "compliance.complete", resourceType: "compliance_obligation", resourceId: input.id, result: "success" });
    return { success: true };
  }),

  workPlans: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "compliance.read");
    const db = await requireDb();
    const actions = await db.select().from(workPlanActions).where(and(eq(workPlanActions.entityId, input.entityId), ne(workPlanActions.status, "cancelled"))).orderBy(asc(workPlanActions.dueAt));
    const dependencies = await db.select().from(workPlanDependencies).where(eq(workPlanDependencies.entityId, input.entityId));
    return actions.map(action => ({ ...action, dependencies: dependencies.filter(item => item.actionId === action.id).map(item => item.dependsOnActionId) }));
  }),

  workPlanHistory: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), id: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "compliance.read"); const db = await requireDb();
    return db.select().from(auditLogs).where(and(eq(auditLogs.entityId, input.entityId), eq(auditLogs.resourceType, "work_plan_action"), eq(auditLogs.resourceId, String(input.id)))).orderBy(desc(auditLogs.occurredAt)).limit(50);
  }),

  createWorkPlan: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(), propertyId: z.number().int().positive().optional(), placementId: z.number().int().positive().optional(),
    title: z.string().min(3).max(220), description: z.string().max(4000).optional(), ownerUserId: z.number().int().positive().optional(),
    priority: z.enum(["low", "normal", "high", "critical"]).default("normal"), dueAt: z.number().int(), sourceType: z.string().max(80).optional(), sourceId: z.number().int().positive().optional(),
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "compliance.write");
    const db = await requireDb();
    const [result] = await db.insert(workPlanActions).values({ ...input, createdBy: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: "work_plan.create", resourceType: "work_plan_action", resourceId: result.id, result: "success" });
    return { id: result.id };
  }),

  updateWorkPlan: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(), id: z.number().int().positive(),
    status: z.enum(["open", "in_progress", "blocked", "ready_for_review", "complete", "cancelled"]),
    progressPercent: z.number().int().min(0).max(100), completionNotes: z.string().max(4000).optional(),
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "compliance.write");
    if (input.status === "complete") throw new Error("Submit work for independent review before completion");
    const db = await requireDb();
    await db.update(workPlanActions).set({
      status: input.status,
      progressPercent: input.progressPercent,
      completionNotes: input.completionNotes,
      completedAt: null,
      completedBy: null,
    }).where(and(eq(workPlanActions.id, input.id), eq(workPlanActions.entityId, input.entityId)));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "work_plan.update", resourceType: "work_plan_action", resourceId: input.id, result: "success", metadata: { status: input.status, progressPercent: input.progressPercent } });
    return { success: true };
  }),

  assignWorkPlan: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), id: z.number().int().positive(), ownerUserId: z.number().int().positive(), dueAt: z.number().int() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "compliance.write");
    const db = await requireDb();
    const [membership] = await db.select({ id: entityMemberships.id }).from(entityMemberships).where(and(eq(entityMemberships.entityId, input.entityId), eq(entityMemberships.userId, input.ownerUserId), eq(entityMemberships.status, "active"))).limit(1);
    if (!membership) throw new Error("The selected owner is not an active member of this entity");
    await db.update(workPlanActions).set({ ownerUserId: input.ownerUserId, dueAt: input.dueAt }).where(and(eq(workPlanActions.id, input.id), eq(workPlanActions.entityId, input.entityId)));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "work_plan.assign", resourceType: "work_plan_action", resourceId: input.id, result: "success", metadata: { ownerUserId: input.ownerUserId, dueAt: input.dueAt } });
    return { success: true };
  }),

  addWorkPlanDependency: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), actionId: z.number().int().positive(), dependsOnActionId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "compliance.write");
    if (input.actionId === input.dependsOnActionId) throw new Error("An action cannot depend on itself");
    const db = await requireDb(); const actions = await db.select({ id: workPlanActions.id }).from(workPlanActions).where(and(eq(workPlanActions.entityId, input.entityId), inArray(workPlanActions.id, [input.actionId, input.dependsOnActionId])));
    if (actions.length !== 2) throw new Error("Both actions must belong to the selected entity");
    const dependencies = await db.select().from(workPlanDependencies).where(eq(workPlanDependencies.entityId, input.entityId));
    const graph = new Map<number, number[]>(); for (const row of dependencies) graph.set(row.actionId, [...(graph.get(row.actionId) ?? []), row.dependsOnActionId]);
    const visits = new Set<number>(); const reachesAction = (id: number): boolean => id === input.actionId || (!visits.has(id) && (visits.add(id), (graph.get(id) ?? []).some(reachesAction)));
    if (reachesAction(input.dependsOnActionId)) throw new Error("This dependency would create a cycle");
    await db.insert(workPlanDependencies).values({ ...input, createdBy: ctx.user.id }).onDuplicateKeyUpdate({ set: { createdBy: ctx.user.id } });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "work_plan.dependency_add", resourceType: "work_plan_action", resourceId: input.actionId, result: "success", metadata: { dependsOnActionId: input.dependsOnActionId } });
    return { success: true };
  }),

  submitWorkPlanReview: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), id: z.number().int().positive(), progressPercent: z.number().int().min(0).max(100), completionNotes: z.string().min(5).max(4000), evidenceDocumentId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "compliance.write"); const db = await requireDb();
    if (input.evidenceDocumentId) { const [document] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, input.evidenceDocumentId), eq(documents.entityId, input.entityId))).limit(1); if (!document) throw new Error("Evidence document is not available in this entity"); }
    const dependencies = await db.select({ dependsOnActionId: workPlanDependencies.dependsOnActionId }).from(workPlanDependencies).where(and(eq(workPlanDependencies.entityId, input.entityId), eq(workPlanDependencies.actionId, input.id)));
    if (dependencies.length) { const required = await db.select({ id: workPlanActions.id, status: workPlanActions.status }).from(workPlanActions).where(inArray(workPlanActions.id, dependencies.map(item => item.dependsOnActionId))); if (required.some(item => item.status !== "complete")) throw new Error("Complete all prerequisite actions before review submission"); }
    await db.update(workPlanActions).set({ status: "ready_for_review", progressPercent: input.progressPercent, completionNotes: input.completionNotes, evidenceDocumentId: input.evidenceDocumentId, reviewOutcome: null, reviewNotes: null }).where(and(eq(workPlanActions.id, input.id), eq(workPlanActions.entityId, input.entityId)));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "work_plan.submit_review", resourceType: "work_plan_action", resourceId: input.id, result: "success", metadata: { progressPercent: input.progressPercent, evidenceDocumentId: input.evidenceDocumentId ?? null } });
    return { success: true };
  }),

  reviewWorkPlan: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), id: z.number().int().positive(), decision: z.enum(["approved", "returned"]), notes: z.string().min(3).max(4000) })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "compliance.write"); const db = await requireDb(); const [action] = await db.select().from(workPlanActions).where(and(eq(workPlanActions.id, input.id), eq(workPlanActions.entityId, input.entityId))).limit(1);
    if (!action || action.status !== "ready_for_review") throw new Error("Only submitted actions can be reviewed"); if (action.createdBy === ctx.user.id && input.decision === "approved") throw new Error("A different authorised user must approve this action");
    await db.update(workPlanActions).set({ status: input.decision === "approved" ? "complete" : "in_progress", progressPercent: input.decision === "approved" ? 100 : action.progressPercent, reviewedAt: Date.now(), reviewedBy: ctx.user.id, reviewOutcome: input.decision, reviewNotes: input.notes, completedAt: input.decision === "approved" ? Date.now() : null, completedBy: input.decision === "approved" ? ctx.user.id : null }).where(eq(workPlanActions.id, input.id));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: `work_plan.review_${input.decision}`, resourceType: "work_plan_action", resourceId: input.id, result: "success", metadata: { notesRecorded: true } });
    return { success: true };
  }),
});
