import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  dailyNotes, documents, documentVersions, emergencyRollCallEntries, emergencyRollCalls, entityMemberships, incidentPeople,
  incidentReferences, incidentReviews, incidents, investigationActions, investigations, keyWorkerReportReviews,
  keyWorkerReports, keyWorkerReportSources, keyworkSessions, loneWorkerCheckIns, loneWorkerSessions,
  integrationConnections, maintenanceJobs, maintenanceUpdates, medicationDiscrepancies, medicationSelfAdministrationEvents,
  medicationStockTransactions, medications, notificationChannelDeliveries, notifications, placements, properties, propertyChecks,
  propertyPresenceEvents, propertyVisitors, recordCorrections, recordDocumentLinks, residentFinanceAccounts,
  residentFinanceDiscrepancies, residentFinanceReconciliations, residentFinanceTransactions,
  residentValuables, safeguardingConcerns, shiftBreaks, shifts, staffProfiles, staffRequests,
  supervisionSessions, supportGoals, users, workerAssignments,
} from "../../drizzle/schema";
import { assertEntityCapability, assertPlacementCapability, assertPropertyCapability, getUserAccess, listAccessiblePropertyIds } from "../authz";
import { protectedProcedure, router } from "../_core/trpc";
import { decryptSensitive, encryptSensitive } from "../services/crypto";
import { writeAuditEvent } from "../services/audit";
import { assertExpectedVersion, assertIndependentReviewer, assertWorkspaceTransition, calculateSignedAmount, notificationChannels, safeNotificationPreview } from "../services/staffWorkspacePolicy";
import { buildStaffRequestOutcomeNotification } from "../services/staffRequestNotifications";
import { requireDb } from "./shared";
import { storagePut } from "../storage";
import { assertHrAccess, assertRecordState, assertSensitiveAccess, workspaceFieldError } from "../services/workspaceGuards";

const id = z.number().int().positive();
const entity = z.object({ entityId: id });
const propertyScope = entity.extend({ propertyId: id });
const placementScope = propertyScope.extend({ placementId: id });
const encrypted = (value?: string | null) => value ? encryptSensitive(value) : undefined;
const decrypted = (value?: string | null) => value ? decryptSensitive(value) : null;
const roleIsManager = (role?: string) => role === "owner" || role === "registered_manager";

async function assertManager(userId: number, entityId: number) {
  const access = await assertEntityCapability(userId, entityId, "staff.write");
  if (!roleIsManager(access.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Manager access required" });
  return access;
}

async function assertPlacementScope(userId: number, input: { entityId: number; propertyId: number; placementId: number }, capability: "young_person.read" | "young_person.write" | "incident.write" | "medication.write" | "resident_finance.write") {
  const result = await assertPlacementCapability(userId, input.placementId, capability);
  if (result.placement.entityId !== input.entityId || result.placement.propertyId !== input.propertyId) throw new TRPCError({ code: "FORBIDDEN", message: "Placement scope does not match the selected property" });
  return result;
}

async function notifyManagers(input: { entityId: number; propertyId?: number; resourceType: string; resourceId: number; category: string; urgent: boolean; deepLink: string }) {
  const db = await requireDb();
  const managerRows = await db.select({ userId: entityMemberships.userId }).from(entityMemberships)
    .where(and(eq(entityMemberships.entityId, input.entityId), eq(entityMemberships.status, "active"), eq(entityMemberships.operationalRole, "registered_manager")));
  if (!managerRows.length) return;
  const [property] = input.propertyId ? await db.select({ name: properties.name }).from(properties).where(eq(properties.id, input.propertyId)).limit(1) : [];
  const preview = safeNotificationPreview({ category: input.category, propertyLabel: property?.name, urgent: input.urgent });
  const connections = await db.select().from(integrationConnections).where(and(eq(integrationConnections.entityId, input.entityId), eq(integrationConnections.status, "active"), inArray(integrationConnections.integrationType, ["email", "sms"])));
  const emailConnection = connections.find(row => row.integrationType === "email");
  const smsConnection = connections.find(row => row.integrationType === "sms");
  const channels = notificationChannels({ urgent: input.urgent, providerEmailActive: Boolean(emailConnection), providerSmsActive: Boolean(smsConnection) });
  for (const row of managerRows) {
    const dedupeKey = `${input.resourceType}:${input.resourceId}:${row.userId}`;
    await db.insert(notifications).values({ entityId: input.entityId, userId: row.userId, type: input.category.toLowerCase().replaceAll(" ", "_"), title: preview.title, message: preview.body, severity: input.urgent ? "urgent" : "warning", resourceType: input.resourceType, resourceId: input.resourceId, deepLink: input.deepLink, acknowledgementRequired: 1, escalationDueAt: input.urgent ? Date.now() + 15 * 60_000 : undefined, dedupeKey }).onDuplicateKeyUpdate({ set: { title: preview.title, message: preview.body, severity: input.urgent ? "urgent" : "warning", resolvedAt: null } });
    const [notification] = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, row.userId), eq(notifications.dedupeKey, dedupeKey))).limit(1);
    const deliveries: Array<{ channel: "push" | "email" | "sms"; status: "delivered" | "queued" | "provider_inactive"; connectionId?: number; deliveredAt?: number }> = [{ channel: "push", status: "delivered", deliveredAt: Date.now() }];
    if (input.urgent) {
      deliveries.push({ channel: "email", status: emailConnection ? "queued" : "provider_inactive", connectionId: emailConnection?.id });
      deliveries.push({ channel: "sms", status: smsConnection ? "queued" : "provider_inactive", connectionId: smsConnection?.id });
    }
    for (const delivery of deliveries) await db.insert(notificationChannelDeliveries).values({ entityId: input.entityId, notificationId: notification?.id, userId: row.userId, channel: delivery.channel, status: delivery.status, providerConnectionId: delivery.connectionId, idempotencyKey: `${dedupeKey}:${delivery.channel}`, payloadSnapshot: { title: preview.title, body: preview.body, deepLink: input.deepLink, containsSensitiveDetails: false }, deliveredAt: delivery.deliveredAt }).onDuplicateKeyUpdate({ set: { status: delivery.status, providerConnectionId: delivery.connectionId, lastError: delivery.status === "provider_inactive" ? `${delivery.channel} provider is not active` : null } });
  }
  await writeAuditEvent({ entityId: input.entityId, propertyId: input.propertyId, actorType: "system", action: "notification.enqueue", resourceType: input.resourceType, resourceId: input.resourceId, result: "success", metadata: channels });
}

async function assertShiftActor(userId: number, shiftId: number) {
  const db = await requireDb();
  const [shift] = await db.select().from(shifts).where(eq(shifts.id, shiftId)).limit(1);
  if (!shift) throw new TRPCError({ code: "NOT_FOUND", message: "Shift not found" });
  const access = await assertPropertyCapability(userId, shift.entityId, shift.propertyId, "frontline.write");
  if (!roleIsManager(access.role) && shift.assignedUserId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "This shift is not assigned to you" });
  return { shift, access };
}

async function assertEvidenceParent(userId: number, entityId: number, resourceType: string, resourceId: string) {
  const parsedId = Number(resourceId);
  if (!Number.isInteger(parsedId) || parsedId <= 0) throw workspaceFieldError("resource_id_invalid", "resourceId", "Choose a valid parent record.");
  const db = await requireDb();
  if (["incident", "property_visitor", "property_check", "maintenance_job"].includes(resourceType)) {
    const table = resourceType === "incident" ? incidents : resourceType === "property_visitor" ? propertyVisitors : resourceType === "property_check" ? propertyChecks : maintenanceJobs;
    const [row] = await db.select({ entityId: table.entityId, propertyId: table.propertyId }).from(table).where(and(eq(table.id, parsedId), eq(table.entityId, entityId))).limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Parent record not found" });
    await assertPropertyCapability(userId, entityId, row.propertyId, resourceType === "incident" ? "incident.write" : "frontline.write");
    return;
  }
  if (["key_worker_report", "keywork_session", "daily_note", "medication_discrepancy", "resident_finance_transaction"].includes(resourceType)) {
    const table = resourceType === "key_worker_report" ? keyWorkerReports : resourceType === "keywork_session" ? keyworkSessions : resourceType === "daily_note" ? dailyNotes : resourceType === "medication_discrepancy" ? medicationDiscrepancies : residentFinanceTransactions;
    const [row] = await db.select({ entityId: table.entityId, placementId: table.placementId }).from(table).where(and(eq(table.id, parsedId), eq(table.entityId, entityId))).limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Parent record not found" });
    await assertPlacementCapability(userId, row.placementId, resourceType === "medication_discrepancy" ? "medication.write" : resourceType === "resident_finance_transaction" ? "resident_finance.write" : "young_person.write");
    return;
  }
  if (resourceType === "staff_request") {
    const [row] = await db.select().from(staffRequests).where(and(eq(staffRequests.id, parsedId), eq(staffRequests.entityId, entityId))).limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Parent record not found" });
    if (row.userId !== userId) await assertManager(userId, entityId); else await assertEntityCapability(userId, entityId, "staff.self_service");
    return;
  }
  throw workspaceFieldError("resource_type_unsupported", "resourceType", "This record type cannot receive workspace evidence.");
}

export const staffWorkspaceRouter = router({
  context: protectedProcedure.input(entity).query(async ({ ctx, input }) => {
    const propertyIds = await listAccessiblePropertyIds(ctx.user.id, input.entityId, "property.read");
    const db = await requireDb();
    const { user, memberships } = await getUserAccess(ctx.user.id);
    const role = user.operationalRole === "owner" ? "owner" : memberships.find(item => item.entityId === input.entityId)?.operationalRole;
    const propertyRows = propertyIds.length ? await db.select().from(properties).where(inArray(properties.id, propertyIds)) : [];
    const assignmentRows = role === "support_worker" ? await db.select({ placementId: workerAssignments.placementId }).from(workerAssignments).where(eq(workerAssignments.userId, ctx.user.id)) : [];
    const predicates = [eq(placements.entityId, input.entityId)];
    if (propertyIds.length) predicates.push(inArray(placements.propertyId, propertyIds));
    if (role === "support_worker") predicates.push(assignmentRows.length ? inArray(placements.id, assignmentRows.map(item => item.placementId)) : eq(placements.id, -1));
    const placementRows = await db.select().from(placements).where(and(...predicates));
    const [profile] = await db.select().from(staffProfiles).where(and(eq(staffProfiles.entityId, input.entityId), eq(staffProfiles.userId, ctx.user.id))).limit(1);
    return { role, isManager: roleIsManager(role), properties: propertyRows, placements: placementRows, staffProfile: profile ?? null };
  }),

  propertyWorkspace: protectedProcedure.input(propertyScope).query(async ({ ctx, input }) => {
    await assertPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "property.read");
    const db = await requireDb();
    const [visitors, checks, maintenance, loneWorkers, presence, rollCalls] = await Promise.all([
      db.select().from(propertyVisitors).where(and(eq(propertyVisitors.entityId, input.entityId), eq(propertyVisitors.propertyId, input.propertyId))).orderBy(desc(propertyVisitors.arrivedAt)),
      db.select().from(propertyChecks).where(and(eq(propertyChecks.entityId, input.entityId), eq(propertyChecks.propertyId, input.propertyId))).orderBy(desc(propertyChecks.createdAt)),
      db.select().from(maintenanceJobs).where(and(eq(maintenanceJobs.entityId, input.entityId), eq(maintenanceJobs.propertyId, input.propertyId))).orderBy(desc(maintenanceJobs.updatedAt)),
      db.select().from(loneWorkerSessions).where(and(eq(loneWorkerSessions.entityId, input.entityId), eq(loneWorkerSessions.propertyId, input.propertyId))).orderBy(desc(loneWorkerSessions.updatedAt)),
      db.select().from(propertyPresenceEvents).where(and(eq(propertyPresenceEvents.entityId, input.entityId), eq(propertyPresenceEvents.propertyId, input.propertyId))).orderBy(desc(propertyPresenceEvents.occurredAt)),
      db.select().from(emergencyRollCalls).where(and(eq(emergencyRollCalls.entityId, input.entityId), eq(emergencyRollCalls.propertyId, input.propertyId))).orderBy(desc(emergencyRollCalls.initiatedAt)),
    ]);
    return { visitors: visitors.map(row => ({ ...row, name: decrypted(row.nameCiphertext), relationship: decrypted(row.relationshipCiphertext), purpose: decrypted(row.purposeCiphertext), notes: decrypted(row.notesCiphertext), nameCiphertext: undefined, relationshipCiphertext: undefined, purposeCiphertext: undefined, notesCiphertext: undefined, vehicleRegistrationCiphertext: undefined })), checks, maintenance, loneWorkers, presence, rollCalls };
  }),

  placementWorkspace: protectedProcedure.input(placementScope).query(async ({ ctx, input }) => {
    const scopedAccess = await assertPlacementScope(ctx.user.id, input, "young_person.read");
    const db = await requireDb();
    const [goals, sessions, notes, reports, financeAccounts, valuables, concerns] = await Promise.all([
      db.select().from(supportGoals).where(eq(supportGoals.placementId, input.placementId)).orderBy(desc(supportGoals.updatedAt)),
      db.select().from(keyworkSessions).where(eq(keyworkSessions.placementId, input.placementId)).orderBy(desc(keyworkSessions.occurredAt)),
      db.select().from(dailyNotes).where(eq(dailyNotes.placementId, input.placementId)).orderBy(desc(dailyNotes.observedAt)),
      db.select().from(keyWorkerReports).where(eq(keyWorkerReports.placementId, input.placementId)).orderBy(desc(keyWorkerReports.reportDate)),
      db.select().from(residentFinanceAccounts).where(eq(residentFinanceAccounts.placementId, input.placementId)).orderBy(desc(residentFinanceAccounts.updatedAt)),
      db.select().from(residentValuables).where(eq(residentValuables.placementId, input.placementId)).orderBy(desc(residentValuables.receivedAt)),
      db.select().from(safeguardingConcerns).where(eq(safeguardingConcerns.placementId, input.placementId)).orderBy(desc(safeguardingConcerns.createdAt)),
    ]);
    return {
      goals: goals.map(row => ({ ...row, description: decrypted(row.descriptionCiphertext), youngPersonView: decrypted(row.youngPersonViewCiphertext), descriptionCiphertext: undefined, youngPersonViewCiphertext: undefined })),
      sessions: sessions.map(row => ({ ...row, objectives: decrypted(row.objectivesCiphertext), discussion: decrypted(row.discussionCiphertext), youngPersonView: decrypted(row.youngPersonViewCiphertext), outcome: decrypted(row.outcomeCiphertext), objectivesCiphertext: undefined, discussionCiphertext: undefined, youngPersonViewCiphertext: undefined, outcomeCiphertext: undefined })),
      notes: notes.map(row => ({ ...row, content: decrypted(row.contentCiphertext), youngPersonView: decrypted(row.youngPersonViewCiphertext), contentCiphertext: undefined, youngPersonViewCiphertext: undefined })),
      reports, financeAccounts, valuables, concerns: concerns.map(row => roleIsManager(scopedAccess.access.role)
        ? ({ ...row, summary: decrypted(row.summaryCiphertext), immediateProtection: decrypted(row.immediateProtectionCiphertext), summaryCiphertext: undefined, immediateProtectionCiphertext: undefined, youngPersonViewCiphertext: undefined })
        : ({ id: row.id, entityId: row.entityId, propertyId: row.propertyId, placementId: row.placementId, concernType: row.concernType, riskLevel: row.riskLevel, status: row.status, reviewDueAt: row.reviewDueAt, createdAt: row.createdAt, restricted: true as const })),
    };
  }),

  staffWorkspace: protectedProcedure.input(entity).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "staff.self_service");
    const db = await requireDb();
    const [profile] = await db.select().from(staffProfiles).where(and(eq(staffProfiles.entityId, input.entityId), eq(staffProfiles.userId, ctx.user.id))).limit(1);
    if (!profile) return { profile: null, requests: [], supervisions: [] };
    const [requests, supervisions] = await Promise.all([
      db.select().from(staffRequests).where(and(eq(staffRequests.entityId, input.entityId), eq(staffRequests.userId, ctx.user.id))).orderBy(desc(staffRequests.createdAt)),
      db.select().from(supervisionSessions).where(and(eq(supervisionSessions.entityId, input.entityId), eq(supervisionSessions.staffProfileId, profile.id))).orderBy(desc(supervisionSessions.scheduledAt)),
    ]);
    return { profile, requests, supervisions: supervisions.map(row => ({ ...row, sharedNotes: decrypted(row.sharedNotesCiphertext), sharedNotesCiphertext: undefined, managerNotesCiphertext: undefined })) };
  }),

  managerQueue: protectedProcedure.input(entity).query(async ({ ctx, input }) => {
    await assertManager(ctx.user.id, input.entityId);
    const db = await requireDb();
    const [reports, incidentRows, checkRows, requestRows, medicationRows, transactionRows, reconciliationRows, financeDiscrepancyRows, concernRows, investigationRows] = await Promise.all([
      db.select().from(keyWorkerReports).where(and(eq(keyWorkerReports.entityId, input.entityId), inArray(keyWorkerReports.status, ["submitted", "reviewed"]))),
      db.select().from(incidents).where(and(eq(incidents.entityId, input.entityId), inArray(incidents.managerReviewState, ["pending", "in_review"]))),
      db.select().from(propertyChecks).where(and(eq(propertyChecks.entityId, input.entityId), eq(propertyChecks.status, "submitted"))),
      db.select().from(staffRequests).where(and(eq(staffRequests.entityId, input.entityId), eq(staffRequests.status, "submitted"))),
      db.select().from(medicationDiscrepancies).where(and(eq(medicationDiscrepancies.entityId, input.entityId), ne(medicationDiscrepancies.status, "closed"))),
      db.select().from(residentFinanceTransactions).where(and(eq(residentFinanceTransactions.entityId, input.entityId), eq(residentFinanceTransactions.status, "submitted"))),
      db.select().from(residentFinanceReconciliations).where(and(eq(residentFinanceReconciliations.entityId, input.entityId), inArray(residentFinanceReconciliations.status, ["submitted", "balanced", "discrepancy"]))),
      db.select().from(residentFinanceDiscrepancies).where(and(eq(residentFinanceDiscrepancies.entityId, input.entityId), ne(residentFinanceDiscrepancies.status, "closed"))),
      db.select().from(safeguardingConcerns).where(and(eq(safeguardingConcerns.entityId, input.entityId), ne(safeguardingConcerns.status, "closed"))),
      db.select().from(investigations).where(and(eq(investigations.entityId, input.entityId), ne(investigations.status, "closed"))),
    ]);
    return { reports, incidents: incidentRows, propertyChecks: checkRows, staffRequests: requestRows, medicationDiscrepancies: medicationRows, financeTransactions: transactionRows, reconciliations: reconciliationRows, financeDiscrepancies: financeDiscrepancyRows, safeguardingConcerns: concernRows, investigations: investigationRows };
  }),

  arriveVisitor: protectedProcedure.input(propertyScope.extend({ placementId: id.optional(), visitorType: z.enum(["friend", "relative", "professional", "contractor", "public_official", "other"]), name: z.string().min(2).max(180), relationship: z.string().max(220).optional(), purpose: z.string().min(2).max(2000), idCheckStatus: z.enum(["not_required", "not_checked", "verified", "declined", "unavailable"]).default("not_checked"), identityDocumentId: id.optional(), expectedDepartureAt: z.number().int().optional(), notes: z.string().max(4000).optional() })).mutation(async ({ ctx, input }) => {
    await assertPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "frontline.write");
    if (input.placementId) await assertPlacementCapability(ctx.user.id, input.placementId, "young_person.read");
    const db = await requireDb(); const now = Date.now();
    const { name, relationship, purpose, notes, ...values } = input;
    const [record] = await db.insert(propertyVisitors).values({ ...values, nameCiphertext: encrypted(name)!, relationshipCiphertext: encrypted(relationship), purposeCiphertext: encrypted(purpose)!, notesCiphertext: encrypted(notes), arrivedAt: now, createdBy: ctx.user.id }).$returningId();
    await db.insert(propertyPresenceEvents).values({ entityId: input.entityId, propertyId: input.propertyId, placementId: input.placementId, visitorId: record.id, personType: input.visitorType === "contractor" ? "contractor" : input.visitorType === "professional" || input.visitorType === "public_official" ? "professional" : "visitor", eventType: "arrived", presenceState: "present", source: "visitor_log", occurredAt: now, createdBy: ctx.user.id });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: "visitor.arrive", resourceType: "property_visitor", resourceId: record.id, sensitivity: "restricted", result: "success", metadata: { visitorType: input.visitorType, idCheckStatus: input.idCheckStatus } });
    return record;
  }),

  departVisitor: protectedProcedure.input(entity.extend({ visitorId: id, expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb(); const [visitor] = await db.select().from(propertyVisitors).where(and(eq(propertyVisitors.id, input.visitorId), eq(propertyVisitors.entityId, input.entityId))).limit(1);
    if (!visitor) throw new TRPCError({ code: "NOT_FOUND" }); await assertPropertyCapability(ctx.user.id, input.entityId, visitor.propertyId, "frontline.write"); assertExpectedVersion(visitor.version, input.expectedVersion);
    const now = Date.now(); await db.update(propertyVisitors).set({ departedAt: now, status: "departed", version: visitor.version + 1 }).where(eq(propertyVisitors.id, visitor.id));
    await db.insert(propertyPresenceEvents).values({ entityId: input.entityId, propertyId: visitor.propertyId, placementId: visitor.placementId, visitorId: visitor.id, personType: visitor.visitorType === "contractor" ? "contractor" : visitor.visitorType === "professional" || visitor.visitorType === "public_official" ? "professional" : "visitor", eventType: "departed", presenceState: "off_site", source: "visitor_log", occurredAt: now, createdBy: ctx.user.id });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: visitor.propertyId, action: "visitor.depart", resourceType: "property_visitor", resourceId: visitor.id, sensitivity: "restricted", result: "success", metadata: { visitorType: visitor.visitorType } });
    return { success: true };
  }),

  startBreak: protectedProcedure.input(z.object({ shiftId: id, startClockEventId: id.optional(), plannedMinutes: z.number().int().min(5).max(240).optional() })).mutation(async ({ ctx, input }) => {
    const { shift } = await assertShiftActor(ctx.user.id, input.shiftId); const db = await requireDb();
    const [active] = await db.select().from(shiftBreaks).where(and(eq(shiftBreaks.shiftId, input.shiftId), eq(shiftBreaks.userId, ctx.user.id), eq(shiftBreaks.status, "active"))).limit(1);
    if (active) throw new TRPCError({ code: "CONFLICT", message: "A break is already active" });
    const [record] = await db.insert(shiftBreaks).values({ entityId: shift.entityId, propertyId: shift.propertyId, shiftId: shift.id, userId: ctx.user.id, startClockEventId: input.startClockEventId, startedAt: Date.now(), plannedMinutes: input.plannedMinutes }).$returningId(); return record;
  }),

  endBreak: protectedProcedure.input(z.object({ breakId: id, endClockEventId: id.optional(), exceptionReason: z.string().max(2000).optional() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb(); const [row] = await db.select().from(shiftBreaks).where(eq(shiftBreaks.id, input.breakId)).limit(1); if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    await assertShiftActor(ctx.user.id, row.shiftId); if (row.status !== "active") throw new TRPCError({ code: "CONFLICT", message: "Break is already closed" });
    const now = Date.now(); await db.update(shiftBreaks).set({ endedAt: now, endClockEventId: input.endClockEventId, actualMinutes: Math.max(0, Math.round((now - row.startedAt) / 60000)), status: "completed", exceptionReasonCiphertext: encrypted(input.exceptionReason) }).where(eq(shiftBreaks.id, row.id)); return { success: true };
  }),

  createPropertyCheck: protectedProcedure.input(propertyScope.extend({ unitId: id.optional(), placementId: id.optional(), shiftId: id.optional(), checkType: z.enum(["room_check", "property_check", "fire_check", "night_check", "health_safety", "welfare", "other"]), authorityBasis: z.enum(["scheduled", "consent", "risk_assessment", "emergency", "policy", "other"]), checklist: z.array(z.object({ key: z.string().min(1).max(80), label: z.string().min(1).max(180), result: z.enum(["pass", "fail", "not_applicable"]), note: z.string().max(1000).optional() })).min(1).max(100), findings: z.string().max(6000).optional(), privacyNotes: z.string().max(4000).optional(), youngPersonPresent: z.boolean().default(false), result: z.enum(["pass", "issues_found", "urgent_action"]), status: z.enum(["draft", "submitted"]).default("submitted") })).mutation(async ({ ctx, input }) => {
    await assertPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "frontline.write"); if (input.placementId) await assertPlacementCapability(ctx.user.id, input.placementId, "young_person.write"); const db = await requireDb();
    const { checklist, findings, privacyNotes, youngPersonPresent, ...values } = input; const [record] = await db.insert(propertyChecks).values({ ...values, checklistSnapshot: checklist, findingsCiphertext: encrypted(findings), privacyNotesCiphertext: encrypted(privacyNotes), youngPersonPresent: youngPersonPresent ? 1 : 0, completedAt: input.status === "submitted" ? Date.now() : undefined, createdBy: ctx.user.id }).$returningId();
    if (input.result === "urgent_action") await notifyManagers({ entityId: input.entityId, propertyId: input.propertyId, resourceType: "property_check", resourceId: record.id, category: "Urgent property check", urgent: true, deepLink: `/app/property/${input.propertyId}` }); return record;
  }),

  reviewPropertyCheck: protectedProcedure.input(entity.extend({ checkId: id, decision: z.enum(["reviewed", "returned", "closed"]), notes: z.string().max(4000).optional(), expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertManager(ctx.user.id, input.entityId); const db = await requireDb(); const [row] = await db.select().from(propertyChecks).where(and(eq(propertyChecks.id, input.checkId), eq(propertyChecks.entityId, input.entityId))).limit(1); if (!row) throw new TRPCError({ code: "NOT_FOUND" }); assertIndependentReviewer(row.createdBy, ctx.user.id); assertExpectedVersion(row.version, input.expectedVersion); assertWorkspaceTransition("property_check", row.status, input.decision);
    await db.update(propertyChecks).set({ status: input.decision, reviewedBy: ctx.user.id, reviewedAt: Date.now(), reviewNotesCiphertext: encrypted(input.notes), version: row.version + 1 }).where(eq(propertyChecks.id, row.id)); return { success: true };
  }),

  createMaintenance: protectedProcedure.input(propertyScope.extend({ unitId: id.optional(), propertyCheckId: id.optional(), incidentId: id.optional(), title: z.string().min(3).max(220), category: z.enum(["plumbing", "electrical", "heating", "fire_safety", "security", "furniture", "appliance", "fabric", "pest", "cleaning", "other"]), priority: z.enum(["routine", "urgent", "emergency"]).default("routine"), description: z.string().min(5).max(6000), accessNotes: z.string().max(4000).optional(), targetAt: z.number().int().optional() })).mutation(async ({ ctx, input }) => {
    await assertPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "frontline.write"); const db = await requireDb(); const { description, accessNotes, ...values } = input; const [record] = await db.insert(maintenanceJobs).values({ ...values, descriptionCiphertext: encrypted(description)!, accessNotesCiphertext: encrypted(accessNotes), createdBy: ctx.user.id }).$returningId();
    if (input.priority !== "routine") await notifyManagers({ entityId: input.entityId, propertyId: input.propertyId, resourceType: "maintenance_job", resourceId: record.id, category: "Urgent maintenance", urgent: input.priority === "emergency", deepLink: `/app/property/${input.propertyId}` }); return record;
  }),

  transitionMaintenance: protectedProcedure.input(entity.extend({ jobId: id, nextStatus: z.enum(["triaged", "assigned", "scheduled", "in_progress", "completed", "verified", "cancelled", "reopened"]), note: z.string().max(4000).optional(), assignedUserId: id.optional(), contractorName: z.string().max(220).optional(), expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb(); const [row] = await db.select().from(maintenanceJobs).where(and(eq(maintenanceJobs.id, input.jobId), eq(maintenanceJobs.entityId, input.entityId))).limit(1); if (!row) throw new TRPCError({ code: "NOT_FOUND" }); await assertPropertyCapability(ctx.user.id, input.entityId, row.propertyId, "frontline.write"); assertExpectedVersion(row.version, input.expectedVersion); assertWorkspaceTransition("maintenance", row.status, input.nextStatus);
    if (input.nextStatus === "verified") { await assertManager(ctx.user.id, input.entityId); assertIndependentReviewer(row.createdBy, ctx.user.id); }
    await db.update(maintenanceJobs).set({ status: input.nextStatus, assignedUserId: input.assignedUserId ?? row.assignedUserId, contractorName: input.contractorName ?? row.contractorName, completedAt: input.nextStatus === "completed" ? Date.now() : row.completedAt, verifiedBy: input.nextStatus === "verified" ? ctx.user.id : row.verifiedBy, verifiedAt: input.nextStatus === "verified" ? Date.now() : row.verifiedAt, version: row.version + 1 }).where(eq(maintenanceJobs.id, row.id));
    await db.insert(maintenanceUpdates).values({ entityId: input.entityId, maintenanceJobId: row.id, updateType: input.nextStatus === "reopened" ? "reopen" : input.nextStatus === "completed" ? "completion" : "status_change", statusFrom: row.status, statusTo: input.nextStatus, noteCiphertext: encrypted(input.note), occurredAt: Date.now(), createdBy: ctx.user.id }); return { success: true };
  }),

  startLoneWorker: protectedProcedure.input(z.object({ shiftId: id, checkInIntervalMinutes: z.number().int().min(15).max(240).default(60), escalationAfterMinutes: z.number().int().min(5).max(120).default(15) })).mutation(async ({ ctx, input }) => {
    const { shift } = await assertShiftActor(ctx.user.id, input.shiftId); const now = Date.now(); const db = await requireDb(); const [record] = await db.insert(loneWorkerSessions).values({ entityId: shift.entityId, propertyId: shift.propertyId, shiftId: shift.id, userId: ctx.user.id, startsAt: now, expectedEndAt: shift.endsAt, checkInIntervalMinutes: input.checkInIntervalMinutes, escalationAfterMinutes: input.escalationAfterMinutes, nextCheckInDueAt: now + input.checkInIntervalMinutes * 60_000, createdBy: ctx.user.id }).$returningId(); return record;
  }),

  loneWorkerCheckIn: protectedProcedure.input(z.object({ sessionId: id, checkInType: z.enum(["scheduled", "manual", "help_requested", "session_end"]), wellbeingStatus: z.enum(["safe", "concern", "help_required"]), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(), accuracyMetres: z.number().nonnegative().max(10000).optional(), locationState: z.enum(["on_site", "off_site", "unavailable", "manual"]), note: z.string().max(4000).optional(), expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb(); const [row] = await db.select().from(loneWorkerSessions).where(eq(loneWorkerSessions.id, input.sessionId)).limit(1); if (!row) throw new TRPCError({ code: "NOT_FOUND" }); await assertShiftActor(ctx.user.id, row.shiftId); assertExpectedVersion(row.version, input.expectedVersion); const now = Date.now();
    const [record] = await db.insert(loneWorkerCheckIns).values({ entityId: row.entityId, sessionId: row.id, checkInType: input.checkInType, wellbeingStatus: input.wellbeingStatus, occurredAt: now, latitude: input.latitude?.toString(), longitude: input.longitude?.toString(), accuracyMetres: input.accuracyMetres?.toString(), locationState: input.locationState, noteCiphertext: encrypted(input.note), createdBy: ctx.user.id }).$returningId();
    const urgent = input.checkInType === "help_requested" || input.wellbeingStatus === "help_required"; await db.update(loneWorkerSessions).set({ lastCheckInAt: now, nextCheckInDueAt: now + row.checkInIntervalMinutes * 60_000, status: input.checkInType === "session_end" ? "completed" : urgent ? "escalated" : "active", escalatedAt: urgent ? now : row.escalatedAt, completedAt: input.checkInType === "session_end" ? now : row.completedAt, version: row.version + 1 }).where(eq(loneWorkerSessions.id, row.id));
    if (urgent) await notifyManagers({ entityId: row.entityId, propertyId: row.propertyId, resourceType: "lone_worker_session", resourceId: row.id, category: "Lone-worker alert", urgent: true, deepLink: `/app/property/${row.propertyId}` }); return record;
  }),

  createGoal: protectedProcedure.input(placementScope.extend({ carePlanId: id.optional(), title: z.string().min(3).max(220), description: z.string().max(5000).optional(), outcomeArea: z.string().max(160).optional(), targetAt: z.number().int().optional(), youngPersonView: z.string().max(4000).optional(), reviewDueAt: z.number().int().optional() })).mutation(async ({ ctx, input }) => {
    await assertPlacementScope(ctx.user.id, input, "young_person.write"); const db = await requireDb(); const { description, youngPersonView, ...values } = input; const [record] = await db.insert(supportGoals).values({ ...values, descriptionCiphertext: encrypted(description), youngPersonViewCiphertext: encrypted(youngPersonView), status: "active", createdBy: ctx.user.id }).$returningId(); return record;
  }),

  createKeyworkSession: protectedProcedure.input(placementScope.extend({ shiftId: id.optional(), goalId: id.optional(), topic: z.string().min(3).max(220), occurredAt: z.number().int(), durationMinutes: z.number().int().min(1).max(600).optional(), objectives: z.string().max(5000).optional(), discussion: z.string().min(10).max(12000), youngPersonView: z.string().max(8000).optional(), outcome: z.string().max(8000).optional(), actions: z.array(z.object({ title: z.string().min(2).max(220), ownerUserId: id.optional(), dueAt: z.number().int().optional() })).max(30).optional(), status: z.enum(["draft", "submitted"]).default("submitted") })).mutation(async ({ ctx, input }) => {
    await assertPlacementScope(ctx.user.id, input, "young_person.write"); const db = await requireDb(); const { objectives, discussion, youngPersonView, outcome, ...values } = input; const [record] = await db.insert(keyworkSessions).values({ ...values, objectivesCiphertext: encrypted(objectives), discussionCiphertext: encrypted(discussion)!, youngPersonViewCiphertext: encrypted(youngPersonView), outcomeCiphertext: encrypted(outcome), createdBy: ctx.user.id }).$returningId(); return record;
  }),

  createDailyNote: protectedProcedure.input(placementScope.extend({ shiftId: id.optional(), noteType: z.enum(["observation", "contact", "appointment", "achievement", "concern", "activity", "education", "health", "other"]), observedAt: z.number().int(), content: z.string().min(5).max(10000), youngPersonView: z.string().max(5000).optional(), tags: z.array(z.string().min(1).max(50)).max(20).optional(), status: z.enum(["draft", "submitted"]).default("submitted") })).mutation(async ({ ctx, input }) => {
    await assertPlacementScope(ctx.user.id, input, "young_person.write"); const db = await requireDb(); const { content, youngPersonView, ...values } = input; const [record] = await db.insert(dailyNotes).values({ ...values, contentCiphertext: encrypted(content)!, youngPersonViewCiphertext: encrypted(youngPersonView), createdBy: ctx.user.id }).$returningId(); return record;
  }),

  reviewReport: protectedProcedure.input(entity.extend({ reportId: id, decision: z.enum(["reviewed", "returned", "approved", "locked"]), notes: z.string().max(5000).optional(), expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertManager(ctx.user.id, input.entityId); const db = await requireDb(); const [row] = await db.select().from(keyWorkerReports).where(and(eq(keyWorkerReports.id, input.reportId), eq(keyWorkerReports.entityId, input.entityId))).limit(1); if (!row) throw new TRPCError({ code: "NOT_FOUND" }); if (input.decision === "returned" && (!input.notes || input.notes.trim().length < 10)) throw workspaceFieldError("return_reason_required", "notes", "Add a clear return reason of at least 10 characters."); assertIndependentReviewer(row.authorUserId, ctx.user.id); assertExpectedVersion(row.version, input.expectedVersion); assertWorkspaceTransition("report", row.status, input.decision);
    const now = Date.now(); await db.update(keyWorkerReports).set({ status: input.decision, reviewNotesCiphertext: encrypted(input.notes), reviewedBy: ctx.user.id, reviewedAt: now, approvedBy: input.decision === "approved" ? ctx.user.id : row.approvedBy, approvedAt: input.decision === "approved" ? now : row.approvedAt, lockedBy: input.decision === "locked" ? ctx.user.id : row.lockedBy, lockedAt: input.decision === "locked" ? now : row.lockedAt, version: row.version + 1 }).where(eq(keyWorkerReports.id, row.id)); await db.insert(keyWorkerReportReviews).values({ entityId: input.entityId, reportId: row.id, decision: input.decision, notesCiphertext: encrypted(input.notes), createdBy: ctx.user.id }); await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: row.propertyId, action: `keywork.report.${input.decision}`, resourceType: "key_worker_report", resourceId: row.id, sensitivity: "safeguarding", result: "success", metadata: { fromStatus: row.status, version: row.version + 1 } }); return { success: true };
  }),

  linkReportSource: protectedProcedure.input(entity.extend({ reportId: id, sourceType: z.enum(["keywork_session", "daily_note", "support_goal", "appointment", "incident", "curfew_check", "medication", "finance"]), sourceId: z.string().min(1).max(80), linkReason: z.enum(["included", "summarised", "follow_up", "evidence"]).default("included") })).mutation(async ({ ctx, input }) => {
    const db = await requireDb(); const [report] = await db.select().from(keyWorkerReports).where(and(eq(keyWorkerReports.id, input.reportId), eq(keyWorkerReports.entityId, input.entityId))).limit(1); if (!report) throw new TRPCError({ code: "NOT_FOUND" }); await assertPlacementCapability(ctx.user.id, report.placementId, "young_person.write"); if (!["draft", "returned"].includes(report.status)) throw workspaceFieldError("correction_required", "status", "Submitted report sources can only be changed through an approved correction addendum.", "CONFLICT"); const [record] = await db.insert(keyWorkerReportSources).values({ ...input, createdBy: ctx.user.id }).$returningId(); return record;
  }),

  addIncidentPerson: protectedProcedure.input(entity.extend({ incidentId: id, personType: z.enum(["young_person", "staff", "professional", "visitor", "public", "other"]), placementId: id.optional(), userId: id.optional(), name: z.string().max(180).optional(), contact: z.string().max(320).optional(), roleDescription: z.string().max(180).optional(), involvement: z.enum(["affected", "witness", "reporter", "person_of_concern", "responding_professional", "other"]) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb(); const [incident] = await db.select().from(incidents).where(and(eq(incidents.id, input.incidentId), eq(incidents.entityId, input.entityId))).limit(1); if (!incident) throw new TRPCError({ code: "NOT_FOUND" }); await assertPropertyCapability(ctx.user.id, input.entityId, incident.propertyId, "incident.write"); if (!["pending", "returned"].includes(incident.managerReviewState)) throw workspaceFieldError("correction_required", "managerReviewState", "Incident details can only be changed through an approved correction after Manager review starts.", "CONFLICT"); const { name, contact, ...values } = input; const [record] = await db.insert(incidentPeople).values({ ...values, nameCiphertext: encrypted(name), contactCiphertext: encrypted(contact), createdBy: ctx.user.id }).$returningId(); return record;
  }),

  addIncidentReference: protectedProcedure.input(entity.extend({ incidentId: id, referenceType: z.enum(["police", "nhs", "local_authority", "ofsted", "lado", "insurance", "other"]), referenceValue: z.string().min(1).max(400), organisation: z.string().max(220).optional(), notes: z.string().max(3000).optional() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb(); const [incident] = await db.select().from(incidents).where(and(eq(incidents.id, input.incidentId), eq(incidents.entityId, input.entityId))).limit(1); if (!incident) throw new TRPCError({ code: "NOT_FOUND" }); await assertPropertyCapability(ctx.user.id, input.entityId, incident.propertyId, "incident.write"); const { referenceValue, notes, ...values } = input; const [record] = await db.insert(incidentReferences).values({ ...values, referenceValueCiphertext: encrypted(referenceValue)!, notesCiphertext: encrypted(notes), createdBy: ctx.user.id }).$returningId(); return record;
  }),

  reviewIncident: protectedProcedure.input(entity.extend({ incidentId: id, decision: z.enum(["started", "returned", "approved", "follow_up", "closed"]), notes: z.string().max(5000).optional(), notificationAssessment: z.enum(["unchanged", "not_notifiable", "regulation_27", "other_notification"]).default("unchanged"), expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertManager(ctx.user.id, input.entityId); const db = await requireDb(); const [row] = await db.select().from(incidents).where(and(eq(incidents.id, input.incidentId), eq(incidents.entityId, input.entityId))).limit(1); if (!row) throw new TRPCError({ code: "NOT_FOUND" }); assertIndependentReviewer(row.createdBy, ctx.user.id); assertExpectedVersion(row.version, input.expectedVersion); const mapped = input.decision === "started" || input.decision === "follow_up" ? "in_review" : input.decision; assertWorkspaceTransition("incident", row.managerReviewState, mapped);
    await db.update(incidents).set({ managerReviewState: mapped, managerReviewNotesCiphertext: encrypted(input.notes), reviewedBy: ctx.user.id, reviewedAt: Date.now(), notifiability: input.notificationAssessment === "unchanged" ? row.notifiability : input.notificationAssessment, version: row.version + 1 }).where(eq(incidents.id, row.id)); await db.insert(incidentReviews).values({ entityId: input.entityId, incidentId: row.id, decision: input.decision, notesCiphertext: encrypted(input.notes), notificationAssessment: input.notificationAssessment, createdBy: ctx.user.id }); return { success: true };
  }),

  createSafeguardingConcern: protectedProcedure.input(placementScope.extend({ incidentId: id.optional(), complaintId: id.optional(), allegationId: id.optional(), concernType: z.enum(["disclosure", "observation", "exploitation", "abuse", "neglect", "self_harm", "online_safety", "criminality", "other"]), riskLevel: z.enum(["low", "medium", "high", "critical"]), summary: z.string().min(10).max(12000), immediateProtection: z.string().min(5).max(8000), youngPersonView: z.string().max(8000).optional(), reviewDueAt: z.number().int().optional() })).mutation(async ({ ctx, input }) => {
    await assertPlacementScope(ctx.user.id, input, "incident.write"); await assertSensitiveAccess({ userId: ctx.user.id, entityId: input.entityId, placementId: input.placementId, sensitivity: "safeguarding", mode: "write" }); const db = await requireDb(); const { summary, immediateProtection, youngPersonView, ...values } = input; const [record] = await db.insert(safeguardingConcerns).values({ ...values, summaryCiphertext: encrypted(summary)!, immediateProtectionCiphertext: encrypted(immediateProtection)!, youngPersonViewCiphertext: encrypted(youngPersonView), createdBy: ctx.user.id }).$returningId(); await notifyManagers({ entityId: input.entityId, propertyId: input.propertyId, resourceType: "safeguarding_concern", resourceId: record.id, category: "Safeguarding concern", urgent: ["high", "critical"].includes(input.riskLevel), deepLink: "/app/manager/inbox" }); return record;
  }),

  createInvestigation: protectedProcedure.input(entity.extend({ propertyId: id.optional(), placementId: id.optional(), concernId: id.optional(), incidentId: id.optional(), complaintId: id.optional(), allegationId: id.optional(), investigationType: z.enum(["safeguarding", "complaint", "incident", "staff_conduct", "finance", "medication", "property", "other"]), terms: z.string().min(10).max(10000), leadUserId: id, independentReviewerUserId: id.optional(), dueAt: z.number().int().optional() })).mutation(async ({ ctx, input }) => {
    await assertManager(ctx.user.id, input.entityId); if (input.leadUserId === input.independentReviewerUserId) throw new TRPCError({ code: "BAD_REQUEST", message: "Lead and independent reviewer must be different people" }); const db = await requireDb(); const { terms, ...values } = input; const [record] = await db.insert(investigations).values({ ...values, termsCiphertext: encrypted(terms)!, openedAt: Date.now(), createdBy: ctx.user.id }).$returningId(); return record;
  }),

  transitionInvestigation: protectedProcedure.input(entity.extend({ investigationId: id, nextStatus: z.enum(["evidence_gathering", "awaiting_response", "review", "action_plan", "closed", "cancelled"]), outcome: z.string().max(10000).optional(), learning: z.string().max(10000).optional(), expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertManager(ctx.user.id, input.entityId); const db = await requireDb(); const [row] = await db.select().from(investigations).where(and(eq(investigations.id, input.investigationId), eq(investigations.entityId, input.entityId))).limit(1); if (!row) throw new TRPCError({ code: "NOT_FOUND" }); assertExpectedVersion(row.version, input.expectedVersion); assertWorkspaceTransition("investigation", row.status, input.nextStatus); if (input.nextStatus === "closed") { if (!input.outcome) throw new TRPCError({ code: "BAD_REQUEST", message: "An outcome is required before closure" }); assertIndependentReviewer(row.leadUserId, ctx.user.id); }
    await db.update(investigations).set({ status: input.nextStatus, outcomeCiphertext: encrypted(input.outcome) ?? row.outcomeCiphertext, learningCiphertext: encrypted(input.learning) ?? row.learningCiphertext, closedAt: input.nextStatus === "closed" ? Date.now() : row.closedAt, version: row.version + 1 }).where(eq(investigations.id, row.id)); return { success: true };
  }),

  addInvestigationAction: protectedProcedure.input(entity.extend({ investigationId: id, workPlanActionId: id.optional(), title: z.string().min(2).max(220), ownerUserId: id.optional(), dueAt: z.number().int().optional() })).mutation(async ({ ctx, input }) => {
    await assertManager(ctx.user.id, input.entityId); const db = await requireDb(); const [parent] = await db.select().from(investigations).where(and(eq(investigations.id, input.investigationId), eq(investigations.entityId, input.entityId))).limit(1); if (!parent) throw new TRPCError({ code: "NOT_FOUND" }); const [record] = await db.insert(investigationActions).values({ ...input, createdBy: ctx.user.id }).$returningId(); return record;
  }),

  submitStaffRequest: protectedProcedure.input(entity.extend({ requestType: z.enum(["contact_change", "certificate_submission", "sickness", "holiday", "availability_change"]), startsAt: z.number().int().optional(), endsAt: z.number().int().optional(), details: z.string().min(3).max(6000), proposedChanges: z.record(z.string(), z.unknown()).optional(), evidenceDocumentId: id.optional() })).mutation(async ({ ctx, input }) => {
    await assertHrAccess({ userId: ctx.user.id, entityId: input.entityId, subjectUserId: ctx.user.id, mode: "write" }); if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) throw workspaceFieldError("date_range_invalid", "endsAt", "End must be after start"); const db = await requireDb(); const [profile] = await db.select().from(staffProfiles).where(and(eq(staffProfiles.entityId, input.entityId), eq(staffProfiles.userId, ctx.user.id))).limit(1); if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Staff profile not found" }); const { details, ...values } = input; const [record] = await db.insert(staffRequests).values({ ...values, staffProfileId: profile.id, userId: ctx.user.id, detailsCiphertext: encrypted(details)! }).$returningId(); return record;
  }),

  reviewStaffRequest: protectedProcedure.input(entity.extend({ requestId: id, decision: z.enum(["approved", "declined", "returned"]), notes: z.string().max(4000).optional(), expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertManager(ctx.user.id, input.entityId); const db = await requireDb(); const [row] = await db.select().from(staffRequests).where(and(eq(staffRequests.id, input.requestId), eq(staffRequests.entityId, input.entityId))).limit(1); if (!row) throw new TRPCError({ code: "NOT_FOUND" }); await assertHrAccess({ userId: ctx.user.id, entityId: input.entityId, subjectUserId: row.userId, mode: "write" }); assertIndependentReviewer(row.userId, ctx.user.id); assertExpectedVersion(row.version, input.expectedVersion); assertWorkspaceTransition("staff_request", row.status, input.decision);
    const now = Date.now(); const outcomeAlert = buildStaffRequestOutcomeNotification({ userId: row.userId, requestId: row.id, outcome: input.decision, version: row.version + 1 });
    await db.transaction(async tx => {
      await tx.update(staffRequests).set({ status: input.decision, reviewNotesCiphertext: encrypted(input.notes), reviewedBy: ctx.user.id, reviewedAt: now, version: row.version + 1 }).where(eq(staffRequests.id, row.id));
      await tx.insert(notifications).values({ entityId: input.entityId, ...outcomeAlert }).onDuplicateKeyUpdate({ set: { title: outcomeAlert.title, message: outcomeAlert.message, severity: outcomeAlert.severity, deepLink: outcomeAlert.deepLink, readAt: null, resolvedAt: null, snoozedUntil: null, escalationState: "none" } });
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "staff_request.outcome_notification", resourceType: "staff_request", resourceId: row.id, sensitivity: "hr", result: "success", metadata: { outcome: input.decision, recipientUserId: row.userId, notificationDedupeKey: outcomeAlert.dedupeKey } });
    return { success: true, notificationQueued: true };
  }),

  createSupervision: protectedProcedure.input(entity.extend({ staffProfileId: id, scheduledAt: z.number().int(), location: z.string().max(220).optional() })).mutation(async ({ ctx, input }) => { await assertManager(ctx.user.id, input.entityId); await assertSensitiveAccess({ userId: ctx.user.id, entityId: input.entityId, sensitivity: "hr", mode: "write" }); const db = await requireDb(); const [record] = await db.insert(supervisionSessions).values({ ...input, managerUserId: ctx.user.id, createdBy: ctx.user.id }).$returningId(); return record; }),

  updateSupervision: protectedProcedure.input(entity.extend({ supervisionId: id, nextStatus: z.enum(["draft", "submitted", "acknowledged", "completed", "cancelled"]), sharedNotes: z.string().max(10000).optional(), managerNotes: z.string().max(10000).optional(), actions: z.array(z.object({ title: z.string().min(2).max(220), ownerUserId: id.optional(), dueAt: z.number().int().optional(), completedAt: z.number().int().optional() })).max(50).optional(), expectedVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb(); const [row] = await db.select().from(supervisionSessions).where(and(eq(supervisionSessions.id, input.supervisionId), eq(supervisionSessions.entityId, input.entityId))).limit(1); if (!row) throw new TRPCError({ code: "NOT_FOUND" }); const [profile] = await db.select().from(staffProfiles).where(eq(staffProfiles.id, row.staffProfileId)).limit(1); if (!profile?.userId) throw new TRPCError({ code: "NOT_FOUND", message: "Staff profile is not linked to an active user" }); const isSubject = profile.userId === ctx.user.id; await assertHrAccess({ userId: ctx.user.id, entityId: input.entityId, subjectUserId: profile.userId, mode: "write" }); if (!isSubject) await assertManager(ctx.user.id, input.entityId); if (input.managerNotes && isSubject) throw workspaceFieldError("manager_notes_restricted", "managerNotes", "Manager-only notes cannot be edited by the supervisee.", "FORBIDDEN"); assertExpectedVersion(row.version, input.expectedVersion); assertWorkspaceTransition("supervision", row.status, input.nextStatus);
    await db.update(supervisionSessions).set({ status: input.nextStatus, sharedNotesCiphertext: encrypted(input.sharedNotes) ?? row.sharedNotesCiphertext, managerNotesCiphertext: isSubject ? row.managerNotesCiphertext : encrypted(input.managerNotes) ?? row.managerNotesCiphertext, actions: input.actions ?? row.actions, acknowledgedBy: input.nextStatus === "acknowledged" ? ctx.user.id : row.acknowledgedBy, acknowledgedAt: input.nextStatus === "acknowledged" ? Date.now() : row.acknowledgedAt, completedAt: input.nextStatus === "completed" ? Date.now() : row.completedAt, version: row.version + 1 }).where(eq(supervisionSessions.id, row.id)); return { success: true };
  }),

  medicationWorkspace: protectedProcedure.input(placementScope).query(async ({ ctx, input }) => {
    await assertPlacementScope(ctx.user.id, input, "young_person.read"); await assertSensitiveAccess({ userId: ctx.user.id, entityId: input.entityId, placementId: input.placementId, sensitivity: "medication", mode: "read" }); const db = await requireDb(); const [stock, selfAdministration, discrepancies] = await Promise.all([db.select().from(medicationStockTransactions).where(eq(medicationStockTransactions.placementId, input.placementId)).orderBy(desc(medicationStockTransactions.occurredAt)), db.select().from(medicationSelfAdministrationEvents).where(eq(medicationSelfAdministrationEvents.placementId, input.placementId)).orderBy(desc(medicationSelfAdministrationEvents.occurredAt)), db.select().from(medicationDiscrepancies).where(eq(medicationDiscrepancies.placementId, input.placementId)).orderBy(desc(medicationDiscrepancies.createdAt))]); return { stock, selfAdministration, discrepancies };
  }),

  recordMedicationStock: protectedProcedure.input(placementScope.extend({ medicationId: id, administrationId: id.optional(), transactionType: z.enum(["receipt", "administration", "return", "disposal", "correction", "count"]), quantity: z.number().positive().max(100000), balanceAfter: z.number().min(0).max(100000), unit: z.string().min(1).max(60), batchReference: z.string().max(120).optional(), expiresAt: z.number().int().optional(), reason: z.string().max(4000).optional(), witnessUserId: id.optional(), documentId: id.optional() })).mutation(async ({ ctx, input }) => {
    await assertPlacementScope(ctx.user.id, input, "medication.write"); await assertSensitiveAccess({ userId: ctx.user.id, entityId: input.entityId, placementId: input.placementId, sensitivity: "medication", mode: "write" }); const db = await requireDb(); const { quantity, balanceAfter, reason, ...values } = input; const [medicine] = await db.select().from(medications).where(and(eq(medications.id, input.medicationId), eq(medications.placementId, input.placementId))).limit(1); if (!medicine) throw new TRPCError({ code: "NOT_FOUND" }); const [record] = await db.insert(medicationStockTransactions).values({ ...values, quantity: quantity.toString(), balanceAfter: balanceAfter.toString(), reasonCiphertext: encrypted(reason), occurredAt: Date.now(), createdBy: ctx.user.id }).$returningId(); return record;
  }),

  recordSelfAdministration: protectedProcedure.input(placementScope.extend({ medicationId: id, administrationId: id.optional(), stockTransactionId: id.optional(), discrepancyId: id.optional(), eventType: z.enum(["assessment", "authorised", "supported", "self_administered", "observed", "withheld", "reviewed", "revoked"]), outcome: z.enum(["safe", "support_required", "not_safe", "completed", "refused", "omitted", "not_applicable"]), details: z.string().min(5).max(8000), competencySnapshot: z.record(z.string(), z.union([z.boolean(), z.string(), z.number()])).optional(), nextReviewAt: z.number().int().optional() })).mutation(async ({ ctx, input }) => {
    await assertPlacementScope(ctx.user.id, input, "medication.write"); await assertSensitiveAccess({ userId: ctx.user.id, entityId: input.entityId, placementId: input.placementId, sensitivity: "medication", mode: "write" }); const db = await requireDb(); const { details, ...values } = input; const [record] = await db.insert(medicationSelfAdministrationEvents).values({ ...values, detailsCiphertext: encrypted(details)!, reviewedBy: ["authorised", "reviewed", "revoked"].includes(input.eventType) ? ctx.user.id : undefined, occurredAt: Date.now(), createdBy: ctx.user.id }).$returningId(); return record;
  }),

  recordMedicationDiscrepancy: protectedProcedure.input(placementScope.extend({ medicationId: id, administrationId: id.optional(), stockTransactionId: id.optional(), discrepancyType: z.enum(["missing_stock", "excess_stock", "wrong_dose", "wrong_time", "wrong_person", "recording_error", "storage", "expiry", "other"]), expectedQuantity: z.number().nonnegative().optional(), actualQuantity: z.number().nonnegative().optional(), details: z.string().min(5).max(8000), immediateActions: z.string().min(5).max(8000) })).mutation(async ({ ctx, input }) => {
    await assertPlacementScope(ctx.user.id, input, "medication.write"); await assertSensitiveAccess({ userId: ctx.user.id, entityId: input.entityId, placementId: input.placementId, sensitivity: "medication", mode: "write" }); const db = await requireDb(); const { expectedQuantity, actualQuantity, details, immediateActions, ...values } = input; const [record] = await db.insert(medicationDiscrepancies).values({ ...values, expectedQuantity: expectedQuantity?.toString(), actualQuantity: actualQuantity?.toString(), detailsCiphertext: encrypted(details)!, immediateActionsCiphertext: encrypted(immediateActions)!, createdBy: ctx.user.id }).$returningId(); await notifyManagers({ entityId: input.entityId, propertyId: input.propertyId, resourceType: "medication_discrepancy", resourceId: record.id, category: "Medication discrepancy", urgent: ["wrong_dose", "wrong_person", "missing_stock"].includes(input.discrepancyType), deepLink: "/app/manager/inbox" }); return record;
  }),

  reviewMedicationDiscrepancy: protectedProcedure.input(entity.extend({ discrepancyId: id, nextStatus: z.enum(["under_review", "action_required", "resolved", "closed"]), resolution: z.string().max(8000).optional() })).mutation(async ({ ctx, input }) => { await assertManager(ctx.user.id, input.entityId); const db = await requireDb(); const [row] = await db.select().from(medicationDiscrepancies).where(and(eq(medicationDiscrepancies.id, input.discrepancyId), eq(medicationDiscrepancies.entityId, input.entityId))).limit(1); if (!row) throw new TRPCError({ code: "NOT_FOUND" }); await assertSensitiveAccess({ userId: ctx.user.id, entityId: input.entityId, placementId: row.placementId, sensitivity: "medication", mode: "write" }); assertIndependentReviewer(row.createdBy, ctx.user.id); assertWorkspaceTransition("medication_discrepancy", row.status, input.nextStatus); await db.update(medicationDiscrepancies).set({ status: input.nextStatus, resolutionCiphertext: encrypted(input.resolution), reviewedBy: ctx.user.id, reviewedAt: Date.now() }).where(eq(medicationDiscrepancies.id, row.id)); return { success: true }; }),

  financeWorkspace: protectedProcedure.input(placementScope).query(async ({ ctx, input }) => { await assertPlacementScope(ctx.user.id, input, "young_person.read"); await assertSensitiveAccess({ userId: ctx.user.id, entityId: input.entityId, placementId: input.placementId, sensitivity: "finance", mode: "read" }); const db = await requireDb(); const accounts = await db.select().from(residentFinanceAccounts).where(eq(residentFinanceAccounts.placementId, input.placementId)); const accountIds = accounts.map(row => row.id); const [transactions, reconciliations, discrepancies, valuables] = await Promise.all([accountIds.length ? db.select().from(residentFinanceTransactions).where(inArray(residentFinanceTransactions.accountId, accountIds)).orderBy(desc(residentFinanceTransactions.occurredAt)) : [], accountIds.length ? db.select().from(residentFinanceReconciliations).where(inArray(residentFinanceReconciliations.accountId, accountIds)).orderBy(desc(residentFinanceReconciliations.periodEnd)) : [], accountIds.length ? db.select().from(residentFinanceDiscrepancies).where(inArray(residentFinanceDiscrepancies.accountId, accountIds)).orderBy(desc(residentFinanceDiscrepancies.createdAt)) : [], db.select().from(residentValuables).where(eq(residentValuables.placementId, input.placementId)).orderBy(desc(residentValuables.receivedAt))]); return { accounts, transactions, reconciliations, discrepancies, valuables }; }),

  createResidentAccount: protectedProcedure.input(placementScope.extend({ accountType: z.enum(["cash_allowance", "savings", "personal_budget", "petty_cash", "other"]), name: z.string().min(2).max(180), openingBalance: z.number().min(0).max(1_000_000).default(0) })).mutation(async ({ ctx, input }) => { await assertPlacementScope(ctx.user.id, input, "resident_finance.write"); await assertSensitiveAccess({ userId: ctx.user.id, entityId: input.entityId, placementId: input.placementId, sensitivity: "finance", mode: "write" }); const db = await requireDb(); const { openingBalance, ...values } = input; const [record] = await db.insert(residentFinanceAccounts).values({ ...values, balance: openingBalance.toFixed(2), createdBy: ctx.user.id }).$returningId(); return record; }),

  recordResidentTransaction: protectedProcedure.input(placementScope.extend({ accountId: id, transactionType: z.enum(["deposit", "withdrawal", "purchase", "refund", "adjustment", "reversal"]), amount: z.number().positive().max(1_000_000), purpose: z.string().min(2).max(5000), counterparty: z.string().max(2000).optional(), receiptDocumentId: id.optional(), expectedAccountVersion: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertPlacementScope(ctx.user.id, input, "resident_finance.write"); await assertSensitiveAccess({ userId: ctx.user.id, entityId: input.entityId, placementId: input.placementId, sensitivity: "finance", mode: "write" }); const db = await requireDb(); const [account] = await db.select().from(residentFinanceAccounts).where(and(eq(residentFinanceAccounts.id, input.accountId), eq(residentFinanceAccounts.placementId, input.placementId))).limit(1); if (!account) throw new TRPCError({ code: "NOT_FOUND" }); assertExpectedVersion(account.version, input.expectedAccountVersion); const signed = calculateSignedAmount(input.transactionType, input.amount); const nextBalance = Number(account.balance) + signed; if (nextBalance < 0) throw workspaceFieldError("insufficient_balance", "amount", "Transaction would make the resident account negative"); const { purpose, counterparty, amount, expectedAccountVersion: _version, propertyId: _propertyId, ...values } = input; const [record] = await db.insert(residentFinanceTransactions).values({ ...values, amount: amount.toFixed(2), balanceAfter: nextBalance.toFixed(2), purposeCiphertext: encrypted(purpose)!, counterpartyCiphertext: encrypted(counterparty), occurredAt: Date.now(), createdBy: ctx.user.id }).$returningId(); await db.update(residentFinanceAccounts).set({ balance: nextBalance.toFixed(2), version: account.version + 1 }).where(eq(residentFinanceAccounts.id, account.id)); return record;
  }),

  reviewResidentTransaction: protectedProcedure.input(entity.extend({ transactionId: id, decision: z.enum(["approved", "returned", "reversed"]), notes: z.string().max(5000).optional() })).mutation(async ({ ctx, input }) => { await assertManager(ctx.user.id, input.entityId); const db = await requireDb(); const [row] = await db.select().from(residentFinanceTransactions).where(and(eq(residentFinanceTransactions.id, input.transactionId), eq(residentFinanceTransactions.entityId, input.entityId))).limit(1); if (!row) throw new TRPCError({ code: "NOT_FOUND" }); await assertSensitiveAccess({ userId: ctx.user.id, entityId: input.entityId, placementId: row.placementId, sensitivity: "finance", mode: "write" }); assertIndependentReviewer(row.createdBy, ctx.user.id); assertWorkspaceTransition("finance_transaction", row.status, input.decision); await db.update(residentFinanceTransactions).set({ status: input.decision, reviewNotesCiphertext: encrypted(input.notes), approvedBy: input.decision === "approved" ? ctx.user.id : row.approvedBy, approvedAt: input.decision === "approved" ? Date.now() : row.approvedAt, reversedBy: input.decision === "reversed" ? ctx.user.id : row.reversedBy, reversedAt: input.decision === "reversed" ? Date.now() : row.reversedAt }).where(eq(residentFinanceTransactions.id, row.id)); return { success: true }; }),

  reconcileResidentFinance: protectedProcedure.input(placementScope.extend({ accountId: id, workPlanActionId: id.optional(), periodStart: z.number().int(), periodEnd: z.number().int(), openingBalance: z.number(), expectedClosingBalance: z.number(), actualClosingBalance: z.number(), notes: z.string().max(5000).optional() })).mutation(async ({ ctx, input }) => { await assertPlacementScope(ctx.user.id, input, "resident_finance.write"); await assertSensitiveAccess({ userId: ctx.user.id, entityId: input.entityId, placementId: input.placementId, sensitivity: "finance", mode: "write" }); if (input.periodEnd <= input.periodStart) throw workspaceFieldError("period_invalid", "periodEnd", "Period end must be after period start"); const db = await requireDb(); const difference = input.actualClosingBalance - input.expectedClosingBalance; const { openingBalance, expectedClosingBalance, actualClosingBalance, notes, ...values } = input; const [record] = await db.insert(residentFinanceReconciliations).values({ ...values, openingBalance: openingBalance.toFixed(2), expectedClosingBalance: expectedClosingBalance.toFixed(2), actualClosingBalance: actualClosingBalance.toFixed(2), difference: difference.toFixed(2), notesCiphertext: encrypted(notes), status: difference === 0 ? "balanced" : "discrepancy", createdBy: ctx.user.id }).$returningId(); return record; }),

  recordFinanceDiscrepancy: protectedProcedure.input(placementScope.extend({ accountId: id, transactionId: id.optional(), reconciliationId: id.optional(), workPlanActionId: id.optional(), discrepancyType: z.enum(["cash_short", "cash_over", "missing_receipt", "duplicate", "unauthorised", "calculation", "other"]), amount: z.number().nonnegative().optional(), details: z.string().min(5).max(8000), immediateActions: z.string().max(8000).optional() })).mutation(async ({ ctx, input }) => { await assertPlacementScope(ctx.user.id, input, "resident_finance.write"); await assertSensitiveAccess({ userId: ctx.user.id, entityId: input.entityId, placementId: input.placementId, sensitivity: "finance", mode: "write" }); const db = await requireDb(); const { amount, details, immediateActions, ...values } = input; const [record] = await db.insert(residentFinanceDiscrepancies).values({ ...values, amount: amount?.toFixed(2), detailsCiphertext: encrypted(details)!, immediateActionsCiphertext: encrypted(immediateActions), createdBy: ctx.user.id }).$returningId(); await notifyManagers({ entityId: input.entityId, propertyId: input.propertyId, resourceType: "resident_finance_discrepancy", resourceId: record.id, category: "Resident-finance discrepancy", urgent: input.discrepancyType === "unauthorised", deepLink: "/app/manager/inbox" }); return record; }),

  uploadEvidence: protectedProcedure.input(entity.extend({
    propertyId: id.optional(), placementId: id.optional(), title: z.string().min(3).max(240), fileName: z.string().min(1).max(300),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
    contentBase64: z.string().min(4).max(11_500_000), documentType: z.enum(["certificate", "evidence", "other"]).default("evidence"),
    classification: z.enum(["general", "hr", "finance", "safeguarding", "restricted"]), retentionUntil: z.number().int().optional(), retentionBasis: z.string().max(220).optional(),
    resourceType: z.string().min(2).max(80).optional(), resourceId: z.string().min(1).max(80).optional(), linkType: z.enum(["evidence", "photo", "id_document", "receipt", "certificate", "statement", "completion", "other"]).optional(),
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "frontline.write");
    if (input.propertyId) await assertPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "frontline.write");
    if (input.placementId) await assertPlacementCapability(ctx.user.id, input.placementId, "young_person.write");
    if (["restricted", "safeguarding"].includes(input.classification)) await assertSensitiveAccess({ userId: ctx.user.id, entityId: input.entityId, placementId: input.placementId, sensitivity: input.classification, mode: "write" });
    if (Boolean(input.resourceType) !== Boolean(input.resourceId) || (input.resourceType && !input.linkType)) throw workspaceFieldError("evidence_link_incomplete", "resourceId", "A linked resource type, ID and link type must be provided together.");
    if (input.resourceType && input.resourceId) await assertEvidenceParent(ctx.user.id, input.entityId, input.resourceType, input.resourceId);
    const bytes = Buffer.from(input.contentBase64, "base64");
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Files must be 8 MB or smaller" });
    const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const stored = await storagePut(`hub/${input.entityId}/workspace/${ctx.user.id}/${Date.now()}-${safeName}`, bytes, input.mimeType);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const db = await requireDb();
    const result = await db.transaction(async tx => {
      const [document] = await tx.insert(documents).values({ entityId: input.entityId, propertyId: input.propertyId, title: input.title, documentType: input.documentType, classification: input.classification, status: "in_review", retentionUntil: input.retentionUntil, retentionBasis: input.retentionBasis, createdBy: ctx.user.id }).$returningId();
      await tx.insert(documentVersions).values({ documentId: document.id, version: 1, fileKey: stored.key, fileUrl: stored.url, fileName: safeName, mimeType: input.mimeType, sizeBytes: bytes.length, contentHash: hash, scanStatus: "not_available", createdBy: ctx.user.id });
      if (input.resourceType && input.resourceId && input.linkType) await tx.insert(recordDocumentLinks).values({ entityId: input.entityId, documentId: document.id, resourceType: input.resourceType, resourceId: input.resourceId, linkType: input.linkType, createdBy: ctx.user.id });
      return document;
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: "workspace.evidence_upload", resourceType: "document", resourceId: result.id, sensitivity: input.classification, result: "success", metadata: { mimeType: input.mimeType, sizeBytes: bytes.length, linked: Boolean(input.resourceType), malwareScan: "not_available" } });
    return { documentId: result.id, url: stored.url, scanStatus: "not_available" as const };
  }),

  proposeCorrection: protectedProcedure.input(entity.extend({ placementId: id.optional(), resourceType: z.enum(["key_worker_report", "keywork_session", "daily_note", "incident", "property_check", "medication_discrepancy", "resident_finance_transaction"]), resourceId: z.string().min(1).max(80), fieldPath: z.string().min(1).max(240), originalValue: z.string().max(12000).optional(), correctedValue: z.string().min(1).max(12000), reason: z.string().min(10).max(4000), affectedOutputs: z.array(z.string().max(120)).max(30).optional(), notificationRecipients: z.array(id).max(50).optional() })).mutation(async ({ ctx, input }) => {
    await assertEvidenceParent(ctx.user.id, input.entityId, input.resourceType, input.resourceId);
    const db = await requireDb(); const resourceId = Number(input.resourceId); if (input.resourceType === "key_worker_report") { const [source] = await db.select({ status: keyWorkerReports.status }).from(keyWorkerReports).where(eq(keyWorkerReports.id, resourceId)).limit(1); if (!source) throw new TRPCError({ code: "NOT_FOUND" }); assertRecordState(source.status, ["submitted", "reviewed", "returned", "approved", "locked"]); } if (input.resourceType === "incident") { const [source] = await db.select({ status: incidents.status }).from(incidents).where(eq(incidents.id, resourceId)).limit(1); if (!source) throw new TRPCError({ code: "NOT_FOUND" }); assertRecordState(source.status, ["open", "under_review", "notifications_due", "notifications_complete", "closed"]); }
    const original = input.originalValue ?? ""; const [record] = await db.insert(recordCorrections).values({ entityId: input.entityId, placementId: input.placementId, resourceType: input.resourceType, resourceId: input.resourceId, fieldPath: input.fieldPath, originalValueHash: createHash("sha256").update(original).digest("hex"), originalValueCiphertext: original ? encrypted(original) : undefined, correctedValueCiphertext: encrypted(input.correctedValue)!, reason: input.reason, affectedOutputs: input.affectedOutputs, notificationRecipients: input.notificationRecipients, createdBy: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "record_correction.proposed", resourceType: input.resourceType, resourceId: input.resourceId, sensitivity: "restricted", result: "success", metadata: { correctionId: record.id, fieldPath: input.fieldPath } }); return record;
  }),

  decideCorrection: protectedProcedure.input(entity.extend({ correctionId: id, decision: z.enum(["approved", "rejected"]), reviewReason: z.string().min(5).max(4000) })).mutation(async ({ ctx, input }) => {
    await assertManager(ctx.user.id, input.entityId); const db = await requireDb(); const [row] = await db.select().from(recordCorrections).where(and(eq(recordCorrections.id, input.correctionId), eq(recordCorrections.entityId, input.entityId))).limit(1); if (!row) throw new TRPCError({ code: "NOT_FOUND" }); assertRecordState(row.status, ["proposed"]); assertIndependentReviewer(row.createdBy, ctx.user.id); await db.update(recordCorrections).set({ status: input.decision, approvedBy: input.decision === "approved" ? ctx.user.id : undefined, affectedOutputs: { previous: row.affectedOutputs, reviewReason: input.reviewReason } }).where(eq(recordCorrections.id, row.id)); await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: `record_correction.${input.decision}`, resourceType: row.resourceType, resourceId: row.resourceId, sensitivity: "restricted", result: "success", metadata: { correctionId: row.id } }); return { success: true };
  }),

  applyCorrection: protectedProcedure.input(entity.extend({ correctionId: id, applicationReason: z.string().min(10).max(4000) })).mutation(async ({ ctx, input }) => {
    await assertManager(ctx.user.id, input.entityId); const db = await requireDb(); const [row] = await db.select().from(recordCorrections).where(and(eq(recordCorrections.id, input.correctionId), eq(recordCorrections.entityId, input.entityId))).limit(1); if (!row) throw new TRPCError({ code: "NOT_FOUND" }); assertRecordState(row.status, ["approved"]); assertIndependentReviewer(row.createdBy, ctx.user.id); await db.update(recordCorrections).set({ status: "applied", appliedBy: ctx.user.id, appliedAt: Date.now(), affectedOutputs: { previous: row.affectedOutputs, applicationReason: input.applicationReason, displayAsAddendum: true } }).where(eq(recordCorrections.id, row.id)); await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "record_correction.applied", resourceType: row.resourceType, resourceId: row.resourceId, sensitivity: "restricted", result: "success", metadata: { correctionId: row.id, fieldPath: row.fieldPath } }); return { success: true, displayAsAddendum: true as const };
  }),

  linkDocument: protectedProcedure.input(entity.extend({ documentId: id, resourceType: z.string().min(2).max(80), resourceId: z.string().min(1).max(80), linkType: z.enum(["evidence", "photo", "id_document", "receipt", "certificate", "statement", "completion", "other"]) })).mutation(async ({ ctx, input }) => { await assertEntityCapability(ctx.user.id, input.entityId, "document.read"); await assertEvidenceParent(ctx.user.id, input.entityId, input.resourceType, input.resourceId); const db = await requireDb(); const [document] = await db.select().from(documents).where(and(eq(documents.id, input.documentId), eq(documents.entityId, input.entityId))).limit(1); if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" }); if (["restricted", "safeguarding", "bank"].includes(document.classification)) await assertSensitiveAccess({ userId: ctx.user.id, entityId: input.entityId, sensitivity: document.classification, mode: "read" }); const [record] = await db.insert(recordDocumentLinks).values({ ...input, createdBy: ctx.user.id }).$returningId(); return record; }),
});
