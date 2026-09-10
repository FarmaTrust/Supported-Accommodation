import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { analyticsMeasures, dataRightsCases, dataRightsEvents, outcomeObservations, placements, regulatoryRegimes } from "../../drizzle/schema";
import { assertEntityCapability, assertPlacementCapability, assertPropertyCapability, listAccessiblePropertyIds } from "../authz";
import { protectedProcedure, router } from "../_core/trpc";
import { writeAuditEvent } from "../services/audit";
import { decryptSensitive, encryptSensitive } from "../services/crypto";
import { dataRightsTransitionAllowed, independentlyApprovedBy, regimeTransitionAllowed, validObservationPeriod, type DataRightsStatus, type RegulatoryRegimeStatus } from "../services/governanceRules";
import { requireDb } from "./shared";

const requestType = z.enum(["access", "rectification", "restriction", "objection", "erasure", "portability", "sharing_review", "complaint"]);
const requesterType = z.enum(["young_person", "parent", "representative", "professional", "staff", "other"]);
const identityStatus = z.enum(["verified", "failed", "not_required"]);
const caseStatus = z.enum(["received", "identity_check", "scoping", "collecting", "redacting", "awaiting_approval", "ready", "delivered", "restricted", "refused", "withdrawn", "closed", "overdue"]);
const regimeStatus = z.enum(["draft", "in_review", "approved", "active", "superseded", "withdrawn"]);
const areas = z.enum(["all_records", "placement_records", "safeguarding", "workforce", "finance", "documents", "other"]);
const regimeAreas = z.enum(["properties", "workforce", "placements", "records", "finance", "governance"]);
const measureDomain = z.enum(["incident", "complaint", "missing", "restraint", "placement", "staffing", "compliance", "finance", "improvement", "outcome", "feedback"]);
const measureType = z.enum(["count", "percentage", "average", "duration", "currency", "score", "custom"]);
const measureSource = z.enum(["system", "manual_observation", "young_person_feedback"]);

function safeDecrypt(value: string | null | undefined) {
  try {
    return decryptSensitive(value);
  } catch {
    return null;
  }
}

async function loadCaseWithScope(userId: number, entityId: number, caseId: number, capability: "data_rights.read" | "data_rights.write") {
  const access = await assertEntityCapability(userId, entityId, capability);
  const db = await requireDb();
  const [record] = await db.select().from(dataRightsCases).where(and(eq(dataRightsCases.id, caseId), eq(dataRightsCases.entityId, entityId))).limit(1);
  if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Data-rights case not found" });
  if (!record.placementId && access.role !== "owner" && !access.allProperties) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Entity-wide data-rights cases require whole-entity access" });
  }
  if (record.placementId) {
    const [placement] = await db.select({ propertyId: placements.propertyId, entityId: placements.entityId }).from(placements).where(eq(placements.id, record.placementId)).limit(1);
    if (!placement || placement.entityId !== entityId) throw new TRPCError({ code: "NOT_FOUND", message: "Linked placement not found" });
    if (placement.propertyId) await assertPropertyCapability(userId, entityId, placement.propertyId, "property.read");
    else if (access.role !== "owner" && !access.allProperties) throw new TRPCError({ code: "FORBIDDEN", message: "Placement scope is not available" });
  }
  return record;
}

async function loadRegime(entityId: number, regimeId: number) {
  const db = await requireDb();
  const [record] = await db.select().from(regulatoryRegimes).where(and(eq(regulatoryRegimes.id, regimeId), eq(regulatoryRegimes.entityId, entityId))).limit(1);
  if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Regulatory framework record not found" });
  return record;
}

async function loadMeasure(entityId: number, measureId: number) {
  const db = await requireDb();
  const [record] = await db.select().from(analyticsMeasures).where(and(eq(analyticsMeasures.id, measureId), eq(analyticsMeasures.entityId, entityId))).limit(1);
  if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Outcome measure not found" });
  return record;
}

export const governanceHubRouter = router({
  workspace: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const access = await assertEntityCapability(ctx.user.id, input.entityId, "data_rights.read");
    const db = await requireDb();
    const [caseRows, regimes, measures, observations, placementRows] = await Promise.all([
      db.select({ record: dataRightsCases, propertyId: placements.propertyId }).from(dataRightsCases).leftJoin(placements, eq(placements.id, dataRightsCases.placementId)).where(eq(dataRightsCases.entityId, input.entityId)).orderBy(desc(dataRightsCases.dueAt)).limit(100),
      db.select().from(regulatoryRegimes).where(eq(regulatoryRegimes.entityId, input.entityId)).orderBy(desc(regulatoryRegimes.updatedAt)).limit(100),
      db.select().from(analyticsMeasures).where(eq(analyticsMeasures.entityId, input.entityId)).orderBy(desc(analyticsMeasures.updatedAt)).limit(100),
      db.select().from(outcomeObservations).where(eq(outcomeObservations.entityId, input.entityId)).orderBy(desc(outcomeObservations.periodEnd)).limit(100),
      db.select({ id: placements.id, propertyId: placements.propertyId, status: placements.status }).from(placements).where(eq(placements.entityId, input.entityId)).orderBy(desc(placements.updatedAt)).limit(100),
    ]);
    const accessiblePropertyIds = access.role === "owner" || access.allProperties ? null : await listAccessiblePropertyIds(ctx.user.id, input.entityId, "property.read");
    const cases = caseRows.filter(row => accessiblePropertyIds === null || (row.propertyId !== null && accessiblePropertyIds.includes(row.propertyId))).map(({ record }) => ({
      ...record,
      requesterName: safeDecrypt(record.requesterNameCiphertext),
      requesterContact: safeDecrypt(record.requesterContactCiphertext),
      identityReference: safeDecrypt(record.identityReferenceCiphertext),
      requesterNameCiphertext: undefined,
      requesterContactCiphertext: undefined,
      identityReferenceCiphertext: undefined,
    }));
    const visibleObservations = observations.filter(row => accessiblePropertyIds === null || (row.propertyId !== null && accessiblePropertyIds.includes(row.propertyId))).map(row => ({ ...row, feedback: safeDecrypt(row.feedbackCiphertext), feedbackCiphertext: undefined, contextNotes: undefined }));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "governance.workspace_read", resourceType: "governance_workspace", resourceId: input.entityId, sensitivity: "restricted", result: "allowed", metadata: { cases: cases.length, regimes: regimes.length, measures: measures.length, observations: visibleObservations.length } });
    const placementOptions = placementRows.filter(row => accessiblePropertyIds === null || (row.propertyId !== null && accessiblePropertyIds.includes(row.propertyId)));
    return { cases, regimes, measures, observations: visibleObservations, placementOptions };
  }),

  createCase: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), placementId: z.number().int().positive().optional(), caseReference: z.string().trim().regex(/^[A-Z0-9-]{4,64}$/), requestType, requesterType, requesterName: z.string().trim().min(2).max(180), requesterContact: z.string().trim().max(320).optional(), scope: z.array(areas).min(1).max(7), receivedAt: z.number().int(), dueAt: z.number().int() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "data_rights.write");
    if (input.dueAt <= input.receivedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "The response due date must be after the received date" });
    if (input.placementId) await assertPlacementCapability(ctx.user.id, input.placementId, "young_person.read");
    const db = await requireDb();
    const [record] = await db.insert(dataRightsCases).values({ entityId: input.entityId, placementId: input.placementId, caseReference: input.caseReference, requestType: input.requestType, requesterType: input.requesterType, requesterNameCiphertext: encryptSensitive(input.requesterName), requesterContactCiphertext: input.requesterContact ? encryptSensitive(input.requesterContact) : undefined, scope: { areas: input.scope }, receivedAt: input.receivedAt, dueAt: input.dueAt, status: "identity_check", identityStatus: "pending", ownerUserId: ctx.user.id, createdBy: ctx.user.id }).$returningId();
    await db.insert(dataRightsEvents).values({ entityId: input.entityId, caseId: record.id, eventType: "case.created", occurredAt: Date.now(), actorUserId: ctx.user.id, metadata: { requestType: input.requestType, placementLinked: Boolean(input.placementId), dueAt: input.dueAt } });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "data_rights.case_create", resourceType: "data_rights_case", resourceId: record.id, sensitivity: "restricted", result: "success", metadata: { requestType: input.requestType, dueAt: input.dueAt } });
    return { id: record.id };
  }),

  verifyCaseIdentity: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), caseId: z.number().int().positive(), status: identityStatus, method: z.string().trim().min(3).max(160), reference: z.string().trim().min(3).max(500).optional() })).mutation(async ({ ctx, input }) => {
    const record = await loadCaseWithScope(ctx.user.id, input.entityId, input.caseId, "data_rights.write");
    if (record.createdBy === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "A different authorised user must verify case identity" });
    if (!["not_started", "pending"].includes(record.identityStatus)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Identity has already been decided" });
    const db = await requireDb();
    const nextStatus = input.status === "verified" || input.status === "not_required" ? "scoping" : "refused";
    await db.transaction(async tx => {
      await tx.update(dataRightsCases).set({ identityStatus: input.status, identityMethod: input.method, identityReferenceCiphertext: input.reference ? encryptSensitive(input.reference) : undefined, identityVerifiedBy: ctx.user.id, identityVerifiedAt: Date.now(), status: nextStatus }).where(eq(dataRightsCases.id, record.id));
      await tx.insert(dataRightsEvents).values({ entityId: input.entityId, caseId: record.id, eventType: "identity.decided", occurredAt: Date.now(), actorUserId: ctx.user.id, metadata: { status: input.status, method: input.method } });
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "data_rights.identity_decide", resourceType: "data_rights_case", resourceId: record.id, sensitivity: "restricted", result: "success", metadata: { status: input.status } });
    return { success: true };
  }),

  transitionCase: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), caseId: z.number().int().positive(), status: caseStatus, reasonCode: z.enum(["scope_confirmed", "records_collected", "redaction_complete", "approval_requested", "restriction_applied", "restriction_lifted", "request_withdrawn", "exemption_applied", "case_closed"]) })).mutation(async ({ ctx, input }) => {
    const record = await loadCaseWithScope(ctx.user.id, input.entityId, input.caseId, "data_rights.write");
    if (!dataRightsTransitionAllowed(record.status as DataRightsStatus, input.status as DataRightsStatus)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This case cannot move to the requested state" });
    if (input.status === "awaiting_approval" && !["verified", "not_required"].includes(record.identityStatus)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Identity verification is required before approval" });
    const db = await requireDb();
    await db.transaction(async tx => {
      await tx.update(dataRightsCases).set({ status: input.status }).where(eq(dataRightsCases.id, record.id));
      await tx.insert(dataRightsEvents).values({ entityId: input.entityId, caseId: record.id, eventType: "case.status_changed", occurredAt: Date.now(), actorUserId: ctx.user.id, metadata: { from: record.status, to: input.status, reasonCode: input.reasonCode } });
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "data_rights.status_change", resourceType: "data_rights_case", resourceId: record.id, sensitivity: "restricted", result: "success", metadata: { from: record.status, to: input.status, reasonCode: input.reasonCode } });
    return { success: true };
  }),

  approveCase: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), caseId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const record = await loadCaseWithScope(ctx.user.id, input.entityId, input.caseId, "data_rights.write");
    if (record.status !== "awaiting_approval") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only a prepared case can be approved" });
    if (!["verified", "not_required"].includes(record.identityStatus)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Identity verification is incomplete" });
    if (!independentlyApprovedBy(ctx.user.id, [record.createdBy, record.identityVerifiedBy])) throw new TRPCError({ code: "FORBIDDEN", message: "A different authorised user must approve the case" });
    const db = await requireDb();
    await db.transaction(async tx => {
      await tx.update(dataRightsCases).set({ status: "ready", approvedBy: ctx.user.id, approvedAt: Date.now() }).where(eq(dataRightsCases.id, record.id));
      await tx.insert(dataRightsEvents).values({ entityId: input.entityId, caseId: record.id, eventType: "case.approved", occurredAt: Date.now(), actorUserId: ctx.user.id, metadata: {} });
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "data_rights.case_approve", resourceType: "data_rights_case", resourceId: record.id, sensitivity: "restricted", result: "success" });
    return { success: true };
  }),

  recordCaseDelivery: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), caseId: z.number().int().positive(), method: z.enum(["secure_link", "secure_email", "post", "collection", "other"]), reference: z.string().trim().min(3).max(180) })).mutation(async ({ ctx, input }) => {
    const record = await loadCaseWithScope(ctx.user.id, input.entityId, input.caseId, "data_rights.write");
    if (record.status !== "ready") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only approved, ready cases can be delivered" });
    const db = await requireDb();
    await db.transaction(async tx => {
      await tx.update(dataRightsCases).set({ status: "delivered", deliveredAt: Date.now() }).where(eq(dataRightsCases.id, record.id));
      await tx.insert(dataRightsEvents).values({ entityId: input.entityId, caseId: record.id, eventType: "case.delivered", occurredAt: Date.now(), actorUserId: ctx.user.id, metadata: { method: input.method, reference: input.reference } });
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "data_rights.case_delivery", resourceType: "data_rights_case", resourceId: record.id, sensitivity: "restricted", result: "success", metadata: { method: input.method } });
    return { success: true };
  }),

  createRegime: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), name: z.string().trim().min(3).max(220), jurisdiction: z.string().trim().min(2).max(120), regulator: z.string().trim().max(180).optional(), sourceUrl: z.string().url().max(1000), effectiveFrom: z.number().int(), effectiveTo: z.number().int().optional(), applicability: z.array(regimeAreas).min(1).max(6) })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    if (input.effectiveTo !== undefined && input.effectiveTo <= input.effectiveFrom) throw new TRPCError({ code: "BAD_REQUEST", message: "The end date must be after the effective date" });
    const db = await requireDb();
    const [record] = await db.insert(regulatoryRegimes).values({ ...input, applicability: { areas: input.applicability }, status: "draft", createdBy: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "regulatory_regime.create", resourceType: "regulatory_regime", resourceId: record.id, sensitivity: "restricted", result: "success", metadata: { jurisdiction: input.jurisdiction } });
    return { id: record.id };
  }),

  submitRegimeForReview: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), regimeId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const record = await loadRegime(input.entityId, input.regimeId);
    if (!regimeTransitionAllowed(record.status as RegulatoryRegimeStatus, "in_review")) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This framework record cannot be submitted for review" });
    const db = await requireDb();
    await db.update(regulatoryRegimes).set({ status: "in_review" }).where(eq(regulatoryRegimes.id, record.id));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "regulatory_regime.submit", resourceType: "regulatory_regime", resourceId: record.id, sensitivity: "restricted", result: "success" });
    return { success: true };
  }),

  approveRegime: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), regimeId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const record = await loadRegime(input.entityId, input.regimeId);
    if (!regimeTransitionAllowed(record.status as RegulatoryRegimeStatus, "approved")) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This framework record is not ready for approval" });
    if (!independentlyApprovedBy(ctx.user.id, [record.createdBy])) throw new TRPCError({ code: "FORBIDDEN", message: "A different authorised user must approve this framework record" });
    const db = await requireDb();
    await db.update(regulatoryRegimes).set({ status: "approved", approvedBy: ctx.user.id, approvedAt: Date.now() }).where(eq(regulatoryRegimes.id, record.id));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "regulatory_regime.approve", resourceType: "regulatory_regime", resourceId: record.id, sensitivity: "restricted", result: "success" });
    return { success: true };
  }),

  activateRegime: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), regimeId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const record = await loadRegime(input.entityId, input.regimeId);
    if (!regimeTransitionAllowed(record.status as RegulatoryRegimeStatus, "active")) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This framework record is not approved for activation" });
    if (!independentlyApprovedBy(ctx.user.id, [record.createdBy, record.approvedBy])) throw new TRPCError({ code: "FORBIDDEN", message: "A different authorised user must activate this approved framework record" });
    const db = await requireDb();
    await db.transaction(async tx => {
      await tx.update(regulatoryRegimes).set({ status: "superseded" }).where(and(eq(regulatoryRegimes.entityId, input.entityId), eq(regulatoryRegimes.name, record.name), eq(regulatoryRegimes.jurisdiction, record.jurisdiction), eq(regulatoryRegimes.status, "active")));
      await tx.update(regulatoryRegimes).set({ status: "active", activatedBy: ctx.user.id, activatedAt: Date.now() }).where(eq(regulatoryRegimes.id, record.id));
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "regulatory_regime.activate", resourceType: "regulatory_regime", resourceId: record.id, sensitivity: "restricted", result: "success", metadata: { supersedesExisting: true } });
    return { success: true };
  }),

  createMeasure: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), key: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,98}$/), name: z.string().trim().min(3).max(220), domain: measureDomain, measureType, unit: z.string().trim().max(60).optional(), direction: z.enum(["higher_is_better", "lower_is_better", "neutral"]).default("neutral"), sourceType: measureSource.default("manual_observation"), numeratorDefinition: z.string().trim().max(2000).optional(), denominatorDefinition: z.string().trim().max(2000).optional(), exclusionNotes: z.string().trim().max(2000).optional() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "analytics.write");
    const db = await requireDb();
    const [record] = await db.insert(analyticsMeasures).values({ ...input, status: "draft", createdBy: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "outcome_measure.create", resourceType: "analytics_measure", resourceId: record.id, sensitivity: "restricted", result: "success", metadata: { key: input.key, domain: input.domain } });
    return { id: record.id };
  }),

  activateMeasure: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), measureId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "analytics.write");
    const record = await loadMeasure(input.entityId, input.measureId);
    if (!["draft", "paused"].includes(record.status)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only draft or paused measures can be activated" });
    if (!independentlyApprovedBy(ctx.user.id, [record.createdBy])) throw new TRPCError({ code: "FORBIDDEN", message: "A different authorised user must activate this measure" });
    const db = await requireDb();
    await db.update(analyticsMeasures).set({ status: "active", approvedBy: ctx.user.id, approvedAt: Date.now() }).where(eq(analyticsMeasures.id, record.id));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "outcome_measure.activate", resourceType: "analytics_measure", resourceId: record.id, sensitivity: "restricted", result: "success" });
    return { success: true };
  }),

  pauseMeasure: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), measureId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "analytics.write");
    const record = await loadMeasure(input.entityId, input.measureId);
    if (record.status !== "active") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only active measures can be paused" });
    const db = await requireDb();
    await db.update(analyticsMeasures).set({ status: "paused" }).where(eq(analyticsMeasures.id, record.id));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "outcome_measure.pause", resourceType: "analytics_measure", resourceId: record.id, sensitivity: "restricted", result: "success" });
    return { success: true };
  }),

  recordObservation: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), measureId: z.number().int().positive(), placementId: z.number().int().positive(), periodStart: z.number().int(), periodEnd: z.number().int(), numericValue: z.string().regex(/^-?\d{1,9}(\.\d{1,3})?$/).optional(), feedbackScore: z.number().int().min(0).max(10).optional(), feedback: z.string().trim().min(1).max(4000).optional(), source: z.enum(["young_person", "key_worker", "manager", "professional", "system_import"]) }).refine(input => Boolean(input.numericValue || input.feedbackScore !== undefined || input.feedback), { message: "Record a numeric value, score, or feedback", path: ["numericValue"] })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "analytics.write");
    const measure = await loadMeasure(input.entityId, input.measureId);
    if (measure.status !== "active") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only active measures can receive observations" });
    if (!validObservationPeriod(input.periodStart, input.periodEnd)) throw new TRPCError({ code: "BAD_REQUEST", message: "Observation period end must be after its start" });
    const placementAccess = await assertPlacementCapability(ctx.user.id, input.placementId, "young_person.write");
    if (placementAccess.placement.entityId !== input.entityId) throw new TRPCError({ code: "FORBIDDEN", message: "Placement is outside the selected entity" });
    const db = await requireDb();
    const [record] = await db.insert(outcomeObservations).values({ entityId: input.entityId, measureId: input.measureId, placementId: input.placementId, propertyId: placementAccess.placement.propertyId, periodStart: input.periodStart, periodEnd: input.periodEnd, numericValue: input.numericValue, feedbackScore: input.feedbackScore, feedbackCiphertext: input.feedback ? encryptSensitive(input.feedback) : undefined, source: input.source, capturedBy: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: placementAccess.placement.propertyId ?? undefined, action: "outcome_observation.record", resourceType: "outcome_observation", resourceId: record.id, sensitivity: "restricted", result: "success", metadata: { measureId: input.measureId, placementId: input.placementId, source: input.source } });
    return { id: record.id };
  }),
});
