import { parse as parseCookie } from "cookie";
import { and, desc, eq, inArray, isNull, like, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { automationRules, carePlans, complianceObligations, documents, invoices, notifications, placements, properties, propertyEvidence, recordShortcuts, savedViews, staffProfiles, workforceChecks, workPlanActions, workerAssignments, youngPeople } from "../../drizzle/schema";
import { assertEntityCapability, getUserAccess, listAccessiblePropertyIds, roleHasCapability } from "../authz";
import { cleanCapabilityList, cleanPathList, effectiveCapabilities, effectivePaths } from "../services/roleDefinitions";
import { allCapabilities } from "../authz";
import { visibleWorkspacePaths } from "../../client/src/lib/roleNavigation";
import { createHeartbeatJob, updateHeartbeatJob } from "../_core/heartbeat";
import { protectedProcedure, router } from "../_core/trpc";
import { runAutomationEvaluation } from "../services/automation";
import { writeAuditEvent } from "../services/audit";
import { evidenceReminderCron, normaliseEvidenceReminderConfiguration } from "../services/evidenceReminders";
import { requireDb } from "./shared";

export const workspaceRouter = router({
  search: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), query: z.string().min(2).max(100) })).query(async ({ ctx, input }) => {
    const access = await assertEntityCapability(ctx.user.id, input.entityId, "property.read");
    const db = await requireDb();
    const q = `%${input.query}%`;
    const results: Array<{ type: string; id: number; title: string; subtitle: string; path: string }> = [];
    const propertyRows = await db.select().from(properties).where(and(eq(properties.entityId, input.entityId), or(like(properties.name, q), like(properties.addressLine1, q), like(properties.postcode, q))));
    results.push(...propertyRows.map(item => ({ type: "Property", id: item.id, title: item.name, subtitle: `${item.addressLine1}, ${item.postcode}`, path: "/properties" })));
    const actionRows = await db.select().from(workPlanActions).where(and(eq(workPlanActions.entityId, input.entityId), like(workPlanActions.title, q)));
    results.push(...actionRows.map(item => ({ type: "Work plan", id: item.id, title: item.title, subtitle: item.status.replaceAll("_", " "), path: "/work-plans" })));
    const complianceRows = await db.select().from(complianceObligations).where(and(eq(complianceObligations.entityId, input.entityId), like(complianceObligations.title, q)));
    results.push(...complianceRows.map(item => ({ type: "Compliance", id: item.id, title: item.title, subtitle: item.ragStatus, path: "/compliance" })));
    if (["owner", "registered_manager", "hr_compliance"].includes(access.role)) {
      const staffRows = await db.select().from(staffProfiles).where(and(eq(staffProfiles.entityId, input.entityId), or(like(staffProfiles.fullName, q), like(staffProfiles.employeeNumber, q))));
      results.push(...staffRows.map(item => ({ type: "Workforce", id: item.id, title: item.fullName, subtitle: item.jobTitle, path: "/workforce" })));
    }
    let placementRows = await db.select({ id: placements.id, reference: youngPeople.reference, preferredName: youngPeople.preferredName }).from(placements).innerJoin(youngPeople, eq(youngPeople.id, placements.youngPersonId)).where(and(eq(placements.entityId, input.entityId), or(like(youngPeople.reference, q), like(youngPeople.preferredName, q))));
    if (access.role === "support_worker") {
      const assignments = await db.select({ placementId: workerAssignments.placementId }).from(workerAssignments).where(eq(workerAssignments.userId, ctx.user.id));
      const ids = assignments.map(item => item.placementId);
      placementRows = ids.length ? placementRows.filter(item => ids.includes(item.id)) : [];
    }
    results.push(...placementRows.map(item => ({ type: "Placement", id: item.id, title: item.reference, subtitle: item.preferredName || "Young-person record", path: "/placements" })));
    if (["owner", "registered_manager", "finance"].includes(access.role)) {
      const invoiceRows = await db.select().from(invoices).where(and(eq(invoices.entityId, input.entityId), or(like(invoices.invoiceNumber, q), like(invoices.customerNameSnapshot, q), like(invoices.youngPersonReferenceSnapshot, q))));
      results.push(...invoiceRows.map(item => ({ type: "Invoice", id: item.id, title: item.invoiceNumber || `Draft #${item.id}`, subtitle: `${item.customerNameSnapshot || "Authority"} · £${item.total}`, path: `/finance/invoice/${item.id}` })));
    }
    const allowedClassifications = access.role === "owner" ? ["general", "hr", "finance", "safeguarding", "bank", "restricted"] : access.role === "registered_manager" ? ["general", "safeguarding", "restricted"] : access.role === "hr_compliance" ? ["general", "hr"] : access.role === "finance" ? ["general", "finance"] : ["general"];
    const documentRows = await db.select().from(documents).where(and(eq(documents.entityId, input.entityId), like(documents.title, q), inArray(documents.classification, allowedClassifications as any)));
    results.push(...documentRows.map(item => ({ type: "Document", id: item.id, title: item.title, subtitle: `${item.documentType} · ${item.status}`, path: "/documents" })));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "workspace.search", resourceType: "search", result: "success", metadata: { resultCount: results.length } });
    return results.slice(0, 50);
  }),

  /**
   * The signed-in member's own navigation for one company. An admin-defined role may narrow the
   * menu, so the sidebar asks the server rather than deriving everything from the workspace role.
   */
  myNavigation: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const { memberships } = await getUserAccess(ctx.user.id);
    const membership = memberships.find(item => item.entityId === input.entityId);
    if (!membership) return { paths: [] as string[], roleLabel: null as string | null, baseRole: null as string | null };
    const baseRole = membership.operationalRole;
    const role = membership.customRole;
    if (!role) return { paths: visibleWorkspacePaths(baseRole), roleLabel: null, baseRole, capabilities: [] as string[] };
    const definition = {
      baseRole,
      grantedCapabilities: cleanCapabilityList(role.grantedCapabilities, allCapabilities),
      deniedCapabilities: cleanCapabilityList(role.deniedCapabilities, allCapabilities),
      visiblePaths: cleanPathList(role.visiblePaths),
    };
    return { paths: effectivePaths(definition), roleLabel: role.name, baseRole, capabilities: effectiveCapabilities(definition) as string[] };
  }),

  notifications: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    return db.select().from(notifications).where(and(eq(notifications.userId, ctx.user.id), isNull(notifications.resolvedAt), or(isNull(notifications.snoozedUntil), lte(notifications.snoozedUntil, Date.now())))).orderBy(desc(notifications.createdAt)).limit(100);
  }),

  markNotificationRead: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [item] = await db.select().from(notifications).where(and(eq(notifications.id, input.id), eq(notifications.userId, ctx.user.id))).limit(1);
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Notification not found" });
    await db.update(notifications).set({ readAt: Date.now(), escalationState: "acknowledged" }).where(and(eq(notifications.id, item.id), eq(notifications.userId, ctx.user.id)));
    return { success: true };
  }),

  snoozeNotification: protectedProcedure.input(z.object({ id: z.number().int().positive(), days: z.number().int().min(1).max(30) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [item] = await db.select().from(notifications).where(and(eq(notifications.id, input.id), eq(notifications.userId, ctx.user.id))).limit(1);
    if (!item) throw new Error("Notification not found");
    const ruleType = item.type === "plan_review" ? "review" : item.type === "placement_review" ? "placement" : item.type;
    const [rule] = item.entityId ? await db.select().from(automationRules).where(and(eq(automationRules.entityId, item.entityId), eq(automationRules.ruleType, ruleType as any), eq(automationRules.enabled, 1))).limit(1) : [];
    const allowedDays = Number((rule?.configuration as { snoozeDays?: number } | null)?.snoozeDays ?? 3);
    if (input.days > allowedDays) throw new Error(`This reminder can be snoozed for no more than ${allowedDays} days`);
    const snoozedUntil = Date.now() + input.days * 86_400_000;
    await db.update(notifications).set({ snoozedUntil, readAt: Date.now() }).where(eq(notifications.id, input.id));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: item.entityId ?? undefined, action: "notification.snooze", resourceType: "notification", resourceId: item.id, result: "success", metadata: { days: input.days, snoozedUntil } });
    return { snoozedUntil };
  }),

  resolveNotification: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb(); const [item] = await db.select().from(notifications).where(and(eq(notifications.id, input.id), eq(notifications.userId, ctx.user.id))).limit(1); if (!item) throw new Error("Notification not found");
    await db.update(notifications).set({ resolvedAt: Date.now(), readAt: Date.now(), escalationState: "resolved" }).where(eq(notifications.id, input.id));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: item.entityId ?? undefined, action: "notification.resolve", resourceType: "notification", resourceId: item.id, result: "success" }); return { success: true };
  }),

  savedViews: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const db = await requireDb(); const access = await getUserAccess(ctx.user.id); const role = access.user.operationalRole === "owner" ? "owner" : access.memberships.find(item => item.entityId === input.entityId)?.operationalRole ?? "read_only";
    const rows = await db.select().from(savedViews).where(and(eq(savedViews.userId, ctx.user.id), eq(savedViews.entityId, input.entityId)));
    const roleDefaults: Record<string, { name: string; filters: Record<string, unknown> }> = { owner: { name: "Owner priorities", filters: { query: "overdue" } }, registered_manager: { name: "Manager actions", filters: { query: "review" } }, support_worker: { name: "My assigned records", filters: { query: "assigned" } }, hr_compliance: { name: "Workforce compliance", filters: { query: "training" } }, finance: { name: "Finance exceptions", filters: { query: "overdue" } }, read_only: { name: "Recent evidence", filters: { query: "evidence" } } };
    const roleDefault = roleDefaults[role]; return rows.length ? rows : [{ id: 0, userId: ctx.user.id, entityId: input.entityId, name: roleDefault.name, viewType: "search", filters: roleDefault.filters, isDefault: 1, createdAt: new Date(0), updatedAt: new Date(0), source: "role_default" as const }];
  }),

  saveView: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), name: z.string().min(2).max(140), viewType: z.string().min(2).max(80), filters: z.record(z.string(), z.unknown()), isDefault: z.boolean().default(false) })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "property.read");
    const db = await requireDb();
    if (input.isDefault) await db.update(savedViews).set({ isDefault: 0 }).where(and(eq(savedViews.userId, ctx.user.id), eq(savedViews.entityId, input.entityId), eq(savedViews.viewType, input.viewType)));
    const [row] = await db.insert(savedViews).values({ ...input, userId: ctx.user.id, isDefault: input.isDefault ? 1 : 0 }).onDuplicateKeyUpdate({ set: { filters: input.filters, isDefault: input.isDefault ? 1 : 0 } }).$returningId();
    return { id: row.id };
  }),

  trackRecord: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), resourceType: z.string().min(2).max(80), resourceId: z.union([z.string(), z.number()]).transform(String), title: z.string().min(1).max(220), path: z.string().startsWith("/").max(500) })).mutation(async ({ ctx, input }) => { await assertEntityCapability(ctx.user.id, input.entityId, "property.read"); const db = await requireDb(); await db.insert(recordShortcuts).values({ ...input, userId: ctx.user.id, lastViewedAt: Date.now() }).onDuplicateKeyUpdate({ set: { title: input.title, path: input.path, lastViewedAt: Date.now() } }); return { success: true }; }),

  shortcuts: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => { const scope = await assertEntityCapability(ctx.user.id, input.entityId, "property.read"); const db = await requireDb(); let rows = await db.select().from(recordShortcuts).where(and(eq(recordShortcuts.userId, ctx.user.id), eq(recordShortcuts.entityId, input.entityId))).orderBy(desc(recordShortcuts.lastViewedAt)).limit(30); if (!["owner", "registered_manager", "hr_compliance"].includes(scope.role)) rows = rows.filter(item => item.resourceType !== "Workforce"); if (!["owner", "registered_manager", "finance"].includes(scope.role)) rows = rows.filter(item => item.resourceType !== "Invoice"); if (scope.role === "support_worker") { const assignments = await db.select({ id: workerAssignments.placementId }).from(workerAssignments).where(eq(workerAssignments.userId, ctx.user.id)); const allowed = new Set(assignments.map(item => String(item.id))); rows = rows.filter(item => item.resourceType !== "Placement" || allowed.has(item.resourceId)); } return { favorites: rows.filter(item => item.isFavorite === 1), recent: rows.slice(0, 10) }; }),

  toggleFavorite: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), id: z.number().int().positive(), favorite: z.boolean() })).mutation(async ({ ctx, input }) => { await assertEntityCapability(ctx.user.id, input.entityId, "property.read"); const db = await requireDb(); await db.update(recordShortcuts).set({ isFavorite: input.favorite ? 1 : 0 }).where(and(eq(recordShortcuts.id, input.id), eq(recordShortcuts.userId, ctx.user.id), eq(recordShortcuts.entityId, input.entityId))); return { success: true }; }),

  dataQuality: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const access = await assertEntityCapability(ctx.user.id, input.entityId, "property.read"); const db = await requireDb(); const propertyIds = await listAccessiblePropertyIds(ctx.user.id, input.entityId, "property.read"); const now = Date.now(); const staleAt = now - 180 * 86_400_000;
    const issues: Array<{ key: string; severity: "info" | "warning" | "urgent"; title: string; message: string; path: string }> = [];
    const propertyRows = propertyIds.length ? await db.select().from(properties).where(inArray(properties.id, propertyIds)) : []; const seen = new Map<string, number>();
    for (const property of propertyRows) { const identity = `${property.addressLine1.toLowerCase().replace(/\s+/g, " ").trim()}|${property.postcode.toUpperCase().replace(/\s+/g, "")}`; if (seen.has(identity)) issues.push({ key: `duplicate-property-${property.id}`, severity: "urgent", title: "Possible duplicate property", message: `${property.name} matches another accessible address. Compare before adding records.`, path: "/properties" }); else seen.set(identity, property.id); if (property.updatedAt.getTime() < staleAt) issues.push({ key: `stale-property-${property.id}`, severity: "warning", title: "Property facts need review", message: `${property.name} has not been reviewed for more than 180 days.`, path: "/properties" }); }
    const evidence = propertyIds.length ? await db.select().from(propertyEvidence).where(inArray(propertyEvidence.propertyId, propertyIds)) : []; for (const property of propertyRows.filter(item => item.status === "active" && !evidence.some(record => record.propertyId === item.id && record.status === "valid"))) issues.push({ key: `evidence-${property.id}`, severity: "urgent", title: "Active property lacks valid evidence", message: `${property.name} has no valid property-evidence record linked.`, path: "/properties" });
    if (roleHasCapability(access.role, "staff.sensitive")) { const staff = await db.select().from(staffProfiles).where(eq(staffProfiles.entityId, input.entityId)); const checks = await db.select().from(workforceChecks).where(eq(workforceChecks.entityId, input.entityId)); for (const person of staff.filter(item => item.status === "active")) { const personChecks = checks.filter(item => item.staffProfileId === person.id); if (!personChecks.some(item => item.checkType === "dbs" && item.status === "valid") || !personChecks.some(item => item.checkType === "right_to_work" && item.status === "valid")) issues.push({ key: `workforce-${person.id}`, severity: "urgent", title: "Safer-recruitment evidence incomplete", message: `${person.fullName} is active without both valid DBS and Right to Work states.`, path: "/workforce" }); } }
    if (roleHasCapability(access.role, "young_person.read")) { const placementRows = await db.select().from(placements).where(and(eq(placements.entityId, input.entityId), eq(placements.status, "active"))); const plans = await db.select().from(carePlans).where(eq(carePlans.entityId, input.entityId)); for (const placement of placementRows.filter(item => !plans.some(plan => plan.placementId === item.id && plan.status === "approved"))) issues.push({ key: `plan-${placement.id}`, severity: "urgent", title: "Active placement lacks an approved plan", message: `Placement #${placement.id} needs an approved support, pathway, risk or placement plan.`, path: "/placements" }); }
    if (roleHasCapability(access.role, "finance.read")) { const invoiceRows = await db.select().from(invoices).where(eq(invoices.entityId, input.entityId)); const invoiceSeen = new Set<string>(); for (const invoice of invoiceRows.filter(item => item.status !== "void")) { const key = `${invoice.placementId}|${invoice.periodStart}|${invoice.periodEnd}`; if (invoiceSeen.has(key)) issues.push({ key: `duplicate-invoice-${invoice.id}`, severity: "urgent", title: "Possible duplicate invoice period", message: `${invoice.invoiceNumber ?? `Draft #${invoice.id}`} overlaps an existing placement and fee period.`, path: `/finance/invoice/${invoice.id}` }); invoiceSeen.add(key); } }
    if (roleHasCapability(access.role, "compliance.write")) { const rules = await db.select().from(automationRules).where(and(eq(automationRules.entityId, input.entityId), eq(automationRules.enabled, 1))); if (!rules.length) issues.push({ key: "automation-missing", severity: "warning", title: "Daily checks are not enabled", message: "Enable managed automation after publishing, or run the evaluator manually.", path: "/search" }); else if (rules.every(rule => !rule.lastRunAt || rule.lastRunAt < now - 2 * 86_400_000)) issues.push({ key: "automation-stale", severity: "urgent", title: "Background checks appear stale", message: "No enabled automation rule has completed in the last 48 hours.", path: "/search" }); }
    return { checkedAt: now, staleAfterDays: 180, issues: issues.slice(0, 50), counts: { urgent: issues.filter(item => item.severity === "urgent").length, warning: issues.filter(item => item.severity === "warning").length, info: issues.filter(item => item.severity === "info").length } };
  }),

  automationRules: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "compliance.write");
    const db = await requireDb();
    return db.select().from(automationRules).where(eq(automationRules.entityId, input.entityId));
  }),

  createDailyAutomation: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), cron: z.string().regex(/^\d+\s+\d+\s+\d+\s+\S+\s+\S+\s+\S+$/).default("0 0 7 * * *") })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "compliance.write");
    const db = await requireDb();
    const [rule] = await db.insert(automationRules).values({ entityId: input.entityId, name: "Daily operations and renewal checks", ruleType: "compliance", configuration: { includes: ["compliance", "property_certificates", "staff_checks", "staff_training", "reviews", "work_plans", "policies", "placements", "invoices", "rota_coverage"] }, createdBy: ctx.user.id }).$returningId();
    const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
    const job = await createHeartbeatJob({ name: `operations-checks-${input.entityId}-${rule.id}`, cron: input.cron, path: "/api/scheduled/operations-automation", description: "Evaluates rota coverage, property certificates, staff checks and training renewals, reviews, work plans, policies, placement milestones and invoices" }, sessionToken);
    await db.update(automationRules).set({ scheduleCronTaskUid: job.taskUid }).where(eq(automationRules.id, rule.id));
    return { id: rule.id, nextExecutionAt: job.nextExecutionAt ?? null };
  }),

  evidenceReminderSettings: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const access = await assertEntityCapability(ctx.user.id, input.entityId, "compliance.write");
    if (!["owner", "registered_manager"].includes(access.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Only an Owner or Registered Manager can view evidence reminder settings" });
    const db = await requireDb();
    const [rule] = await db.select().from(automationRules).where(and(eq(automationRules.entityId, input.entityId), eq(automationRules.ruleType, "evidence"))).limit(1);
    return rule ? { id: rule.id, enabled: Boolean(rule.enabled), configuration: normaliseEvidenceReminderConfiguration(rule.configuration as Partial<ReturnType<typeof normaliseEvidenceReminderConfiguration>>), scheduleCronTaskUid: rule.scheduleCronTaskUid, lastRunAt: rule.lastRunAt } : null;
  }),

  saveEvidenceReminderSettings: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), enabled: z.boolean(), staffEvidenceReviewHours: z.number().int().min(1).max(720), documentReviewLeadDays: z.number().int().min(1).max(365), retentionReviewLeadDays: z.number().int().min(1).max(365), runAtHourUtc: z.number().int().min(0).max(23).default(7) })).mutation(async ({ ctx, input }) => {
    const access = await assertEntityCapability(ctx.user.id, input.entityId, "compliance.write");
    if (!["owner", "registered_manager"].includes(access.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Only an Owner or Registered Manager can configure evidence reminders" });
    const db = await requireDb(); const configuration = normaliseEvidenceReminderConfiguration(input); const cron = evidenceReminderCron(input.runAtHourUtc); const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
    let [rule] = await db.select().from(automationRules).where(and(eq(automationRules.entityId, input.entityId), eq(automationRules.ruleType, "evidence"))).limit(1);
    if (!rule) { const [created] = await db.insert(automationRules).values({ entityId: input.entityId, name: "Evidence review and retention reminders", ruleType: "evidence", configuration, enabled: input.enabled ? 1 : 0, createdBy: ctx.user.id }).$returningId(); rule = (await db.select().from(automationRules).where(eq(automationRules.id, created.id)).limit(1))[0]!; }
    let nextExecutionAt: string | null = null;
    if (rule.scheduleCronTaskUid) nextExecutionAt = (await updateHeartbeatJob(rule.scheduleCronTaskUid, { cron, enable: input.enabled, description: "Evaluates staff evidence review, document review dates and retention reviews" }, sessionToken)).nextExecutionAt ?? null;
    else if (input.enabled) { const job = await createHeartbeatJob({ name: `evidence-reminders-${input.entityId}-${rule.id}`, cron, path: "/api/scheduled/operations-automation", description: "Evaluates staff evidence review, document review dates and retention reviews" }, sessionToken); await db.update(automationRules).set({ scheduleCronTaskUid: job.taskUid }).where(eq(automationRules.id, rule.id)); nextExecutionAt = job.nextExecutionAt ?? null; }
    await db.update(automationRules).set({ configuration, enabled: input.enabled ? 1 : 0 }).where(eq(automationRules.id, rule.id));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "automation.evidence_reminders.configure", resourceType: "automation_rule", resourceId: rule.id, result: "success", metadata: { enabled: input.enabled, staffEvidenceReviewHours: configuration.staffEvidenceReviewHours, documentReviewLeadDays: configuration.documentReviewLeadDays, retentionReviewLeadDays: configuration.retentionReviewLeadDays, runAtHourUtc: input.runAtHourUtc, heartbeatConfigured: Boolean(rule.scheduleCronTaskUid || input.enabled) } });
    return { id: rule.id, nextExecutionAt };
  }),

  runAutomationNow: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "compliance.write");
    const result = await runAutomationEvaluation(input.entityId);
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "automation.manual_run", resourceType: "automation", result: "success", metadata: result });
    return result;
  }),
});
