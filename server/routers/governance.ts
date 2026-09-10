import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  complianceObligations, documentFolders, documentTemplates, documentVersions, documents, entityMemberships,
  exportJobs, policyAcknowledgements, properties, propertyEvidence, retentionReviews, workPlanActions,
} from "../../drizzle/schema";
import { assertEntityCapability, assertPropertyCapability } from "../authz";
import { protectedProcedure, router } from "../_core/trpc";
import { writeAuditEvent } from "../services/audit";
import { storagePut } from "../storage";
import { canCompleteDeletion, validateRetentionDecision } from "../services/retention";
import { requireDb } from "./shared";

const classification = z.enum(["general", "hr", "finance", "safeguarding", "bank", "restricted"]);
const allowedMimeTypes = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv", "application/json", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);

async function assertDocumentAccess(userId: number, documentId: number, action: "read" | "write") {
  const db = await requireDb();
  const [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
  await assertEntityCapability(userId, document.entityId, action === "write" ? "document.write" : "document.read");
  if (document.classification === "hr") await assertEntityCapability(userId, document.entityId, "staff.read");
  if (document.classification === "finance" || document.classification === "bank") await assertEntityCapability(userId, document.entityId, "finance.read");
  if (document.classification === "safeguarding") await assertEntityCapability(userId, document.entityId, "young_person.read");
  return document;
}

export const governanceRouter = router({
  folders: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "document.read");
    const db = await requireDb();
    return db.select().from(documentFolders).where(eq(documentFolders.entityId, input.entityId));
  }),

  createFolder: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), parentFolderId: z.number().int().positive().optional(), name: z.string().min(2).max(180), classification })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "document.write");
    const db = await requireDb();
    const [folder] = await db.insert(documentFolders).values({ ...input, createdBy: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "document_folder.create", resourceType: "document_folder", resourceId: folder.id, sensitivity: input.classification, result: "success" });
    return { id: folder.id };
  }),

  templates: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "document.read");
    const db = await requireDb();
    return db.select().from(documentTemplates).where(and(eq(documentTemplates.entityId, input.entityId), eq(documentTemplates.status, "active")));
  }),

  createTemplate: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), templateKey: z.string().min(2).max(100), title: z.string().min(3).max(220), category: z.enum(["provider_pack", "support_plan", "pathway_plan", "risk_assessment", "incident_notification", "supervision", "placement_commencement", "inspection_export", "other"]), bodyTemplate: z.string().min(20).max(100_000), fieldSchema: z.record(z.string(), z.unknown()).optional() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "document.write");
    const db = await requireDb();
    const existing = await db.select().from(documentTemplates).where(and(eq(documentTemplates.entityId, input.entityId), eq(documentTemplates.templateKey, input.templateKey))).orderBy(desc(documentTemplates.version)).limit(1);
    const version = (existing[0]?.version ?? 0) + 1;
    if (existing[0]) await db.update(documentTemplates).set({ status: "superseded" }).where(eq(documentTemplates.id, existing[0].id));
    const [template] = await db.insert(documentTemplates).values({ ...input, version, createdBy: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "document_template.create", resourceType: "document_template", resourceId: template.id, result: "success", metadata: { category: input.category, version } });
    return { id: template.id, version };
  }),

  versions: protectedProcedure.input(z.object({ documentId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const document = await assertDocumentAccess(ctx.user.id, input.documentId, "read");
    const db = await requireDb();
    const rows = await db.select({ id: documentVersions.id, version: documentVersions.version, fileName: documentVersions.fileName, mimeType: documentVersions.mimeType, sizeBytes: documentVersions.sizeBytes, contentHash: documentVersions.contentHash, scanStatus: documentVersions.scanStatus, changeSummary: documentVersions.changeSummary, approvedAt: documentVersions.approvedAt, createdAt: documentVersions.createdAt }).from(documentVersions).where(eq(documentVersions.documentId, input.documentId)).orderBy(desc(documentVersions.version));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: document.entityId, propertyId: document.propertyId ?? undefined, action: "document_versions.read", resourceType: "document", resourceId: document.id, sensitivity: document.classification, result: "allowed", metadata: { resultCount: rows.length } });
    return rows;
  }),

  uploadVersion: protectedProcedure.input(z.object({ documentId: z.number().int().positive(), fileName: z.string().min(1).max(300), mimeType: z.string().min(3).max(160), base64: z.string().min(1).max(14_500_000), changeSummary: z.string().max(2000).optional() })).mutation(async ({ ctx, input }) => {
    const document = await assertDocumentAccess(ctx.user.id, input.documentId, "write");
    if (!allowedMimeTypes.has(input.mimeType)) throw new TRPCError({ code: "BAD_REQUEST", message: "This file type is not permitted" });
    const bytes = Buffer.from(input.base64, "base64");
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "Files must be between 1 byte and 10 MB" });
    const db = await requireDb();
    const existing = await db.select().from(documentVersions).where(eq(documentVersions.documentId, input.documentId)).orderBy(desc(documentVersions.version)).limit(1);
    const version = (existing[0]?.version ?? 0) + 1;
    const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-180);
    const stored = await storagePut(`entities/${document.entityId}/documents/${document.id}/${version}-${randomUUID()}-${safeName}`, bytes, input.mimeType);
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const [record] = await db.insert(documentVersions).values({ documentId: document.id, version, fileKey: stored.key, fileUrl: stored.url, fileName: safeName, mimeType: input.mimeType, sizeBytes: bytes.length, contentHash, scanStatus: "not_available", changeSummary: input.changeSummary, createdBy: ctx.user.id }).$returningId();
    await db.update(documents).set({ currentVersion: version }).where(eq(documents.id, document.id));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: document.entityId, propertyId: document.propertyId ?? undefined, action: "document_version.upload", resourceType: "document_version", resourceId: record.id, sensitivity: document.classification, result: "success", metadata: { documentId: document.id, version, sizeBytes: bytes.length, contentHash, scanStatus: "not_available" } });
    return { id: record.id, version, scanStatus: "not_available" as const };
  }),

  downloadVersion: protectedProcedure.input(z.object({ documentId: z.number().int().positive(), versionId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const document = await assertDocumentAccess(ctx.user.id, input.documentId, "read");
    const db = await requireDb();
    const [version] = await db.select().from(documentVersions).where(and(eq(documentVersions.id, input.versionId), eq(documentVersions.documentId, input.documentId))).limit(1);
    if (!version?.fileUrl || version.scanStatus === "quarantined") throw new TRPCError({ code: "NOT_FOUND", message: "File is unavailable" });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: document.entityId, propertyId: document.propertyId ?? undefined, action: "document.download", resourceType: "document_version", resourceId: version.id, sensitivity: document.classification, result: "allowed", metadata: { documentId: document.id, version: version.version } });
    return { url: version.fileUrl, fileName: version.fileName };
  }),

  approveDocument: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), documentId: z.number().int().positive(), acknowledgementDueAt: z.number().int().optional() })).mutation(async ({ ctx, input }) => {
    const document = await assertDocumentAccess(ctx.user.id, input.documentId, "write");
    if (document.entityId !== input.entityId) throw new TRPCError({ code: "FORBIDDEN" });
    const db = await requireDb();
    await db.transaction(async tx => {
      await tx.update(documents).set({ status: "approved" }).where(eq(documents.id, input.documentId));
      if (document.documentType === "policy") {
        const members = await tx.select({ userId: entityMemberships.userId }).from(entityMemberships).where(and(eq(entityMemberships.entityId, input.entityId), eq(entityMemberships.status, "active")));
        for (const member of members) await tx.insert(policyAcknowledgements).values({ entityId: input.entityId, documentId: input.documentId, documentVersion: document.currentVersion, userId: member.userId, dueAt: input.acknowledgementDueAt }).onDuplicateKeyUpdate({ set: { dueAt: input.acknowledgementDueAt, status: "pending", acknowledgedAt: null } });
      }
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "document.approve", resourceType: "document", resourceId: input.documentId, sensitivity: document.classification, result: "success", metadata: { version: document.currentVersion } });
    return { success: true };
  }),

  myAcknowledgements: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "document.read");
    const db = await requireDb();
    return db.select({ acknowledgement: policyAcknowledgements, title: documents.title }).from(policyAcknowledgements).innerJoin(documents, eq(documents.id, policyAcknowledgements.documentId)).where(and(eq(policyAcknowledgements.entityId, input.entityId), eq(policyAcknowledgements.userId, ctx.user.id)));
  }),

  acknowledgePolicy: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [record] = await db.select().from(policyAcknowledgements).where(and(eq(policyAcknowledgements.id, input.id), eq(policyAcknowledgements.userId, ctx.user.id))).limit(1);
    if (!record) throw new TRPCError({ code: "NOT_FOUND" });
    await db.update(policyAcknowledgements).set({ status: "acknowledged", acknowledgedAt: Date.now() }).where(eq(policyAcknowledgements.id, input.id));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: record.entityId, action: "policy.acknowledge", resourceType: "policy_acknowledgement", resourceId: record.id, result: "success", metadata: { documentId: record.documentId, version: record.documentVersion } });
    return { success: true };
  }),

  retentionReviews: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "document.write");
    const db = await requireDb();
    return db.select().from(retentionReviews).where(eq(retentionReviews.entityId, input.entityId)).orderBy(desc(retentionReviews.reviewDueAt));
  }),

  createRetentionReview: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), resourceType: z.string().min(2).max(80), resourceId: z.number().int().positive(), classification, retentionBasis: z.string().min(5).max(240), retentionUntil: z.number().int(), reviewDueAt: z.number().int(), legalHold: z.boolean().default(false) })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "document.write");
    const db = await requireDb();
    const [review] = await db.insert(retentionReviews).values({ ...input, legalHold: input.legalHold ? 1 : 0, status: input.legalHold ? "hold" : "pending", requestedBy: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "retention_review.create", resourceType: "retention_review", resourceId: review.id, sensitivity: input.classification, result: "success", metadata: { retentionBasis: input.retentionBasis, legalHold: input.legalHold } });
    return { id: review.id };
  }),

  decideRetentionReview: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), id: z.number().int().positive(), decision: z.enum(["hold", "approved_delete", "approved_transfer", "cancelled"]), notes: z.string().min(5).max(4000) })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "document.write");
    const db = await requireDb();
    const [review] = await db.select().from(retentionReviews).where(and(eq(retentionReviews.id, input.id), eq(retentionReviews.entityId, input.entityId))).limit(1);
    if (!review) throw new TRPCError({ code: "NOT_FOUND" });
    const decision = validateRetentionDecision({ requestedBy: review.requestedBy ?? -1, decidedBy: ctx.user.id, legalHold: Boolean(review.legalHold), decision: input.decision });
    if (!decision.allowed) throw new TRPCError({ code: decision.reason === "legal_hold" ? "PRECONDITION_FAILED" : "FORBIDDEN", message: decision.reason === "legal_hold" ? "Records under legal hold cannot be approved for deletion" : "A different authorised person must approve deletion or transfer" });
    await db.update(retentionReviews).set({ status: input.decision, legalHold: input.decision === "hold" ? 1 : review.legalHold, approvedBy: ctx.user.id, decisionAt: Date.now(), decisionNotes: input.notes }).where(eq(retentionReviews.id, input.id));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "retention_review.decide", resourceType: "retention_review", resourceId: input.id, sensitivity: review.classification, result: "success", metadata: { decision: input.decision } });
    return { success: true };
  }),

  completeDocumentDeletion: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), id: z.number().int().positive(), confirmation: z.literal("DELETE APPROVED RECORD") })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "document.write");
    const db = await requireDb();
    const [review] = await db.select().from(retentionReviews).where(and(eq(retentionReviews.id, input.id), eq(retentionReviews.entityId, input.entityId))).limit(1);
    if (!review || !canCompleteDeletion({ status: review.status, legalHold: Boolean(review.legalHold), resourceType: review.resourceType })) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This record is not approved for document deletion" });
    await db.transaction(async tx => {
      await tx.update(documentVersions).set({ fileKey: null, fileUrl: null }).where(eq(documentVersions.documentId, review.resourceId));
      await tx.update(documents).set({ status: "archived" }).where(and(eq(documents.id, review.resourceId), eq(documents.entityId, input.entityId)));
      await tx.update(retentionReviews).set({ status: "completed", completedAt: Date.now() }).where(eq(retentionReviews.id, input.id));
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "retention_delete.complete", resourceType: "document", resourceId: review.resourceId, sensitivity: review.classification, result: "success", metadata: { retentionReviewId: review.id, deletionReceipt: createHash("sha256").update(`${review.id}:${review.resourceId}:${Date.now()}`).digest("hex") } });
    return { success: true };
  }),

  exports: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "document.read");
    const db = await requireDb();
    return db.select().from(exportJobs).where(eq(exportJobs.entityId, input.entityId)).orderBy(desc(exportJobs.createdAt));
  }),

  createInspectionExport: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), propertyId: z.number().int().positive().optional(), includeDocumentIndex: z.boolean().default(true), redactYoungPersonReferences: z.boolean().default(true) })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "document.write");
    if (input.propertyId) await assertPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "compliance.read");
    const db = await requireDb();
    const [job] = await db.insert(exportJobs).values({ entityId: input.entityId, propertyId: input.propertyId, exportType: "inspection", scope: { propertyId: input.propertyId ?? "all" }, redaction: { youngPersonReferences: input.redactYoungPersonReferences }, status: "generating", requestedBy: ctx.user.id }).$returningId();
    try {
      const propertyPredicate = input.propertyId ? eq(properties.id, input.propertyId) : eq(properties.entityId, input.entityId);
      const evidencePredicate = input.propertyId ? and(eq(propertyEvidence.entityId, input.entityId), eq(propertyEvidence.propertyId, input.propertyId)) : eq(propertyEvidence.entityId, input.entityId);
      const compliancePredicate = input.propertyId ? and(eq(complianceObligations.entityId, input.entityId), eq(complianceObligations.propertyId, input.propertyId)) : eq(complianceObligations.entityId, input.entityId);
      const workPredicate = input.propertyId ? and(eq(workPlanActions.entityId, input.entityId), eq(workPlanActions.propertyId, input.propertyId)) : eq(workPlanActions.entityId, input.entityId);
      const [propertyRows, evidenceRows, complianceRows, workRows, documentRows] = await Promise.all([
        db.select().from(properties).where(propertyPredicate), db.select().from(propertyEvidence).where(evidencePredicate), db.select().from(complianceObligations).where(compliancePredicate), db.select().from(workPlanActions).where(workPredicate), input.includeDocumentIndex ? db.select({ id: documents.id, title: documents.title, type: documents.documentType, classification: documents.classification, status: documents.status, currentVersion: documents.currentVersion, reviewDueAt: documents.reviewDueAt }).from(documents).where(eq(documents.entityId, input.entityId)) : Promise.resolve([]),
      ]);
      const generatedAt = Date.now();
      const manifest = { schemaVersion: 1, generatedAt, generatedBy: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId ?? null, redaction: { youngPersonReferences: input.redactYoungPersonReferences }, counts: { properties: propertyRows.length, propertyEvidence: evidenceRows.length, compliance: complianceRows.length, workPlans: workRows.length, documents: documentRows.length }, sections: ["properties", "propertyEvidence", "compliance", "workPlans", ...(input.includeDocumentIndex ? ["documents"] : [])] };
      const payload = JSON.stringify({ manifest, properties: propertyRows, propertyEvidence: evidenceRows, compliance: complianceRows, workPlans: workRows, documents: documentRows }, null, 2);
      const stored = await storagePut(`entities/${input.entityId}/exports/inspection-${job.id}-${generatedAt}.json`, payload, "application/json");
      const [document] = await db.insert(documents).values({ entityId: input.entityId, propertyId: input.propertyId, title: `Inspection evidence export ${new Date(generatedAt).toISOString().slice(0, 10)}`, documentType: "generated", classification: "restricted", status: "approved", retentionBasis: "Inspection evidence export — review after purpose completed", retentionUntil: generatedAt + 365 * 86_400_000, createdBy: ctx.user.id }).$returningId();
      await db.insert(documentVersions).values({ documentId: document.id, version: 1, fileKey: stored.key, fileUrl: stored.url, fileName: `inspection-export-${job.id}.json`, mimeType: "application/json", sizeBytes: Buffer.byteLength(payload), contentHash: createHash("sha256").update(payload).digest("hex"), scanStatus: "not_available", changeSummary: "System-generated inspection evidence manifest", approvedAt: generatedAt, approvedBy: ctx.user.id, createdBy: ctx.user.id });
      await db.update(exportJobs).set({ status: "ready", manifest, documentId: document.id, completedAt: generatedAt, expiresAt: generatedAt + 30 * 86_400_000 }).where(eq(exportJobs.id, job.id));
      await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: "inspection_export.create", resourceType: "export_job", resourceId: job.id, sensitivity: "restricted", result: "success", metadata: { documentId: document.id, counts: manifest.counts, redaction: manifest.redaction } });
      return { id: job.id, status: "ready" as const };
    } catch (error) {
      await db.update(exportJobs).set({ status: "failed", errorMessage: error instanceof Error ? error.message : "Export failed" }).where(eq(exportJobs.id, job.id));
      throw error;
    }
  }),

  downloadExport: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "document.read");
    const db = await requireDb();
    const [job] = await db.select().from(exportJobs).where(and(eq(exportJobs.id, input.id), eq(exportJobs.entityId, input.entityId))).limit(1);
    if (!job?.documentId || job.status !== "ready" || (job.expiresAt && job.expiresAt < Date.now())) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Export is unavailable or expired" });
    const [version] = await db.select().from(documentVersions).where(eq(documentVersions.documentId, job.documentId)).orderBy(desc(documentVersions.version)).limit(1);
    if (!version?.fileUrl) throw new TRPCError({ code: "NOT_FOUND" });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: job.propertyId ?? undefined, action: "inspection_export.download", resourceType: "export_job", resourceId: job.id, sensitivity: "restricted", result: "allowed", metadata: { documentId: job.documentId } });
    return { url: version.fileUrl, fileName: version.fileName };
  }),
});
