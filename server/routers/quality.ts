import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  documentVersions, documents, entities, properties, qualityReviewConsultations, qualityReviewEvidence, qualityReviews,
} from "../../drizzle/schema";
import { assertEntityCapability, assertPropertyCapability, getUserAccess, listAccessiblePropertyIds } from "../authz";
import { protectedProcedure, router } from "../_core/trpc";
import { writeAuditEvent } from "../services/audit";
import { appendQualityReviewApproval, qualityReviewPdfFileName, renderQualityReviewPdf } from "../services/qualityReviewPdf";
import {
  assertIndependentQualityApproval, isQualityReportManager, qualityReviewAuditMetadata, qualityReviewDocumentTitle,
  qualityReviewRetentionBasis, qualityReviewRetentionMs,
} from "../services/qualityReviewRules";
import { storageGetSignedUrl, storagePut } from "../storage";
import { independentReviewAllowed, missingReviewAudiences, qualityPeriodError } from "../services/upgradeRules";
import { requireDb } from "./shared";

const entity = z.object({ entityId: z.number().int().positive() });
const reportFields = z.object({
  methodology: z.string().min(20).max(8_000), strengths: z.string().min(10).max(8_000), shortfalls: z.string().min(10).max(8_000),
  outcomesSummary: z.string().min(10).max(8_000), youngPeopleSummary: z.string().min(10).max(8_000), consultationSummary: z.string().min(10).max(8_000),
  managementEvaluation: z.string().min(10).max(8_000),
});
const evidenceCategory = z.enum(["outcomes", "safeguarding", "staffing", "placement_stability", "complaints", "incidents", "compliance", "feedback", "education_health", "independence", "other"]);
const controlledMimeTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
const evidenceFileInput = z.object({ fileName: z.string().min(1).max(300), mimeType: z.string().min(3).max(160), base64: z.string().min(1).max(14_500_000) });

function qualityAccessError() {
  return new TRPCError({ code: "FORBIDDEN", message: "Quality reviews are available only to authorised Managers, RSMs, Owners, Nominated Individuals and compliance users." });
}

async function assertQualityAccess(userId: number, entityId: number, capability: "compliance.read" | "compliance.write") {
  const { user, memberships } = await getUserAccess(userId);
  const membership = memberships.find(item => item.entityId === entityId);
  if (user.operationalRole === "platform_admin" && membership) {
    if (capability === "compliance.write") throw qualityAccessError();
    return { role: "platform_admin", allProperties: true } as const;
  }
  const access = await assertEntityCapability(userId, entityId, capability);
  if (!["owner", "registered_manager", "hr_compliance"].includes(access.role)) throw qualityAccessError();
  return access;
}

async function reviewForWrite(userId: number, entityId: number, reviewId: number) {
  await assertQualityAccess(userId, entityId, "compliance.write");
  const db = await requireDb();
  const [row] = await db.select().from(qualityReviews).where(and(eq(qualityReviews.id, reviewId), eq(qualityReviews.entityId, entityId))).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Quality review not found." });
  if (row.propertyId) await assertPropertyCapability(userId, entityId, row.propertyId, "compliance.write");
  return { db, row };
}

async function assertEvidenceDocumentScope(db: any, entityId: number, propertyId: number | null, documentId?: number) {
  if (!documentId) return;
  const [document] = await db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.entityId, entityId))).limit(1);
  if (!document || (propertyId && document.propertyId && document.propertyId !== propertyId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "The selected evidence document is outside this review’s authorised entity or premise scope." });
  }
}

function toPdfInput(input: { review: any; entityName: string; propertyName?: string | null; generatedAt: number; generatedBy: string; status: "draft" | "approved"; evidence: any[]; consultations: any[] }) {
  const { review } = input;
  return {
    entityName: input.entityName, propertyName: input.propertyName, title: review.title, periodStart: review.periodStart, periodEnd: review.periodEnd,
    generatedAt: input.generatedAt, generatedBy: input.generatedBy, status: input.status,
    methodology: review.methodology ?? "", strengths: review.strengths ?? "", shortfalls: review.shortfalls ?? "", outcomesSummary: review.outcomesSummary ?? "",
    youngPeopleSummary: review.youngPeopleSummary ?? "", consultationSummary: review.consultationSummary ?? "", managementEvaluation: review.managementEvaluation ?? "",
    evidence: input.evidence.map(item => ({ category: item.category, title: item.title, status: item.status, analysis: item.analysis, documentAttached: Boolean(item.documentId) })),
    consultations: input.consultations.map(item => ({ audience: item.audience, method: item.method, responseStatus: item.responseStatus, summary: item.responseStatus === "no_response" ? item.noResponseReason : item.responseSummary })),
  };
}

async function loadReportContext(db: any, review: any) {
  const [[entityRow], [propertyRow], consultations, evidence] = await Promise.all([
    db.select({ name: entities.name }).from(entities).where(eq(entities.id, review.entityId)).limit(1),
    review.propertyId ? db.select({ name: properties.name }).from(properties).where(and(eq(properties.id, review.propertyId), eq(properties.entityId, review.entityId))).limit(1) : Promise.resolve([]),
    db.select().from(qualityReviewConsultations).where(eq(qualityReviewConsultations.qualityReviewId, review.id)),
    db.select().from(qualityReviewEvidence).where(eq(qualityReviewEvidence.qualityReviewId, review.id)),
  ]);
  if (!entityRow) throw new TRPCError({ code: "NOT_FOUND", message: "Entity not found." });
  return { entityName: entityRow.name, propertyName: propertyRow?.name ?? null, consultations, evidence };
}

async function archiveDraftReport(input: { db: any; review: any; actorId: number; actorName: string }) {
  const generatedAt = Date.now();
  const context = await loadReportContext(input.db, input.review);
  const bytes = await renderQualityReviewPdf(toPdfInput({ review: input.review, ...context, generatedAt, generatedBy: input.actorName, status: "draft" }));
  const fileName = qualityReviewPdfFileName(input.review.id, "draft", generatedAt);
  const stored = await storagePut(`entities/${input.review.entityId}/quality-reviews/${input.review.id}/draft-${randomUUID()}-${fileName}`, bytes, "application/pdf");
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const [document] = await input.db.insert(documents).values({
    entityId: input.review.entityId, propertyId: input.review.propertyId ?? undefined, title: qualityReviewDocumentTitle(input.review.title, input.review.id),
    documentType: "generated", classification: "restricted", status: "in_review", retentionBasis: qualityReviewRetentionBasis,
    retentionUntil: generatedAt + qualityReviewRetentionMs, createdBy: input.actorId,
  }).$returningId();
  await input.db.insert(documentVersions).values({
    documentId: document.id, version: 1, fileKey: stored.key, fileUrl: stored.url, fileName, mimeType: "application/pdf", sizeBytes: bytes.length,
    contentHash, scanStatus: "not_available", changeSummary: "Editable quality review draft snapshot prepared for independent approval", createdBy: input.actorId,
  });
  if (input.review.reportDocumentId) await input.db.update(documents).set({ status: "superseded" }).where(eq(documents.id, input.review.reportDocumentId));
  await input.db.update(qualityReviews).set({ reportDocumentId: document.id }).where(eq(qualityReviews.id, input.review.id));
  return { documentId: document.id, generatedAt, evidenceCount: context.evidence.length, consultationCount: context.consultations.length };
}

export const qualityRouter = router({
  workspace: protectedProcedure.input(entity).query(async ({ ctx, input }) => {
    const access = await assertQualityAccess(ctx.user.id, input.entityId, "compliance.read");
    const db = await requireDb();
    const propertyIds = access.role === "platform_admin" ? (await db.select({ id: properties.id }).from(properties).where(eq(properties.entityId, input.entityId))).map(item => item.id) : await listAccessiblePropertyIds(ctx.user.id, input.entityId, "property.read");
    const all = await db.select().from(qualityReviews).where(eq(qualityReviews.entityId, input.entityId)).orderBy(desc(qualityReviews.periodEnd));
    const reviews = all.filter(row => row.propertyId ? propertyIds.includes(row.propertyId) : access.role === "owner" || access.allProperties);
    const ids = reviews.map(row => row.id);
    const [consultations, evidence] = await Promise.all([
      ids.length ? db.select().from(qualityReviewConsultations).where(inArray(qualityReviewConsultations.qualityReviewId, ids)) : Promise.resolve([]),
      ids.length ? db.select().from(qualityReviewEvidence).where(inArray(qualityReviewEvidence.qualityReviewId, ids)) : Promise.resolve([]),
    ]);
    return { reviews, consultations, evidence };
  }),

  createReview: protectedProcedure.input(entity.extend({ propertyId: z.number().int().positive().optional(), title: z.string().min(3).max(220), periodStart: z.number().int(), periodEnd: z.number().int(), ownerUserId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
    const periodError = qualityPeriodError(input.periodStart, input.periodEnd);
    if (periodError) throw new TRPCError({ code: "BAD_REQUEST", message: periodError });
    await assertQualityAccess(ctx.user.id, input.entityId, "compliance.write");
    if (input.propertyId) await assertPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "compliance.write");
    const db = await requireDb();
    const [record] = await db.insert(qualityReviews).values({ ...input, submissionDueAt: input.periodEnd + 28 * 86_400_000, nextReviewDueAt: input.periodEnd + 183 * 86_400_000, createdBy: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: "quality_review.create", resourceType: "quality_review", resourceId: record.id, sensitivity: "restricted", result: "success" });
    return record;
  }),

  addConsultation: protectedProcedure.input(entity.extend({ reviewId: z.number().int().positive(), audience: z.enum(["young_person", "placing_authority", "staff", "professional", "family_advocate", "other"]), participantReference: z.string().max(180).optional(), method: z.enum(["conversation", "meeting", "telephone", "email", "survey", "written", "advocate", "other"]), responseStatus: z.enum(["planned", "invited", "responded", "declined", "no_response", "not_applicable"]), accessibilityNeeds: z.string().max(3000).optional(), responseSummary: z.string().max(6000).optional(), noResponseReason: z.string().max(3000).optional() })).mutation(async ({ ctx, input }) => {
    const { db, row } = await reviewForWrite(ctx.user.id, input.entityId, input.reviewId);
    if (["approved", "submitted", "closed"].includes(row.status)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This quality review is controlled and cannot be amended." });
    const { reviewId, ...values } = input;
    const [record] = await db.insert(qualityReviewConsultations).values({ ...values, qualityReviewId: reviewId, invitedAt: Date.now(), respondedAt: input.responseStatus === "responded" ? Date.now() : undefined, recordedBy: ctx.user.id }).$returningId();
    if (row.status === "draft") await db.update(qualityReviews).set({ status: "consultation" }).where(eq(qualityReviews.id, row.id));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: row.propertyId ?? undefined, action: "quality_review.consultation_add", resourceType: "quality_review_consultation", resourceId: record.id, sensitivity: "restricted", result: "success", metadata: { reviewId: row.id, audience: input.audience, responseStatus: input.responseStatus } });
    return record;
  }),

  addEvidence: protectedProcedure.input(entity.extend({ reviewId: z.number().int().positive(), category: evidenceCategory, title: z.string().min(3).max(220), status: z.enum(["identified", "collected", "reviewed", "excluded"]).default("identified"), analysis: z.string().max(6000).optional(), exclusionReason: z.string().max(3000).optional(), documentId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
    const { db, row } = await reviewForWrite(ctx.user.id, input.entityId, input.reviewId);
    if (["approved", "submitted", "closed"].includes(row.status)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This quality review is controlled and cannot be amended." });
    await assertEvidenceDocumentScope(db, input.entityId, row.propertyId, input.documentId);
    const { reviewId, ...values } = input;
    const [record] = await db.insert(qualityReviewEvidence).values({ ...values, qualityReviewId: reviewId, addedBy: ctx.user.id, reviewedAt: input.status === "reviewed" ? Date.now() : undefined, reviewedBy: input.status === "reviewed" ? ctx.user.id : undefined }).$returningId();
    if (["draft", "consultation"].includes(row.status)) await db.update(qualityReviews).set({ status: "evidence_review" }).where(eq(qualityReviews.id, row.id));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: row.propertyId ?? undefined, action: "quality_review.evidence_add", resourceType: "quality_review_evidence", resourceId: record.id, sensitivity: "restricted", result: "success", metadata: { reviewId: row.id, category: input.category, status: input.status, hasDocument: Boolean(input.documentId) } });
    return record;
  }),

  attachEvidenceFiles: protectedProcedure.input(entity.extend({ reviewId: z.number().int().positive(), evidenceId: z.number().int().positive(), files: z.array(evidenceFileInput).min(1).max(8) })).mutation(async ({ ctx, input }) => {
    const { db, row } = await reviewForWrite(ctx.user.id, input.entityId, input.reviewId);
    if (["approved", "submitted", "closed"].includes(row.status)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This quality review is controlled and cannot be amended." });
    const [evidence] = await db.select().from(qualityReviewEvidence).where(and(eq(qualityReviewEvidence.id, input.evidenceId), eq(qualityReviewEvidence.qualityReviewId, row.id), eq(qualityReviewEvidence.entityId, input.entityId))).limit(1);
    if (!evidence) throw new TRPCError({ code: "NOT_FOUND", message: "Quality-review evidence item not found." });
    if (evidence.documentId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This evidence item already has a controlled file bundle. Add a separate evidence item for additional files." });
    const materialised = input.files.map(file => ({ ...file, bytes: Buffer.from(file.base64, "base64") }));
    for (const file of materialised) {
      if (!controlledMimeTypes.has(file.mimeType)) throw new TRPCError({ code: "BAD_REQUEST", message: "Only approved image, PDF or Word evidence files can be attached." });
      if (!file.bytes.length || file.bytes.length > 10 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "Each evidence file must be between 1 byte and 10 MB." });
    }
    const [document] = await db.insert(documents).values({
      entityId: input.entityId, propertyId: row.propertyId ?? undefined, title: evidence.title, documentType: "evidence", classification: "restricted", status: "in_review",
      retentionBasis: "Quality review supporting evidence — retain under organisation retention schedule", retentionUntil: Date.now() + qualityReviewRetentionMs, createdBy: ctx.user.id,
    }).$returningId();
    try {
      const versions = [] as Array<{ version: number; fileKey: string; fileUrl: string; fileName: string; mimeType: string; sizeBytes: number; contentHash: string }>;
      for (let index = 0; index < materialised.length; index += 1) {
        const file = materialised[index]!;
        const safeName = file.fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-180);
        const version = index + 1;
        const stored = await storagePut(`entities/${input.entityId}/quality-reviews/${row.id}/evidence/${document.id}/${version}-${randomUUID()}-${safeName}`, file.bytes, file.mimeType);
        versions.push({ version, fileKey: stored.key, fileUrl: stored.url, fileName: safeName, mimeType: file.mimeType, sizeBytes: file.bytes.length, contentHash: createHash("sha256").update(file.bytes).digest("hex") });
      }
      await db.transaction(async (tx: any) => {
        await tx.insert(documentVersions).values(versions.map(file => ({ documentId: document.id, ...file, scanStatus: "not_available", changeSummary: "Quality review evidence attachment", createdBy: ctx.user.id })));
        await tx.update(documents).set({ currentVersion: versions.length }).where(eq(documents.id, document.id));
        await tx.update(qualityReviewEvidence).set({ documentId: document.id }).where(eq(qualityReviewEvidence.id, evidence.id));
      });
      await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: row.propertyId ?? undefined, action: "quality_review.evidence_upload", resourceType: "quality_review_evidence", resourceId: evidence.id, sensitivity: "restricted", result: "success", metadata: { reviewId: row.id, documentId: document.id, fileCount: versions.length, contentHashes: versions.map(item => item.contentHash) } });
      return { documentId: document.id, fileCount: versions.length };
    } catch (error) {
      await db.update(documents).set({ status: "archived" }).where(eq(documents.id, document.id));
      throw error;
    }
  }),

  completeReview: protectedProcedure.input(entity.extend({ reviewId: z.number().int().positive() }).merge(reportFields)).mutation(async ({ ctx, input }) => {
    const { db, row } = await reviewForWrite(ctx.user.id, input.entityId, input.reviewId);
    if (["approved", "submitted", "closed"].includes(row.status)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This quality review is controlled and cannot be amended." });
    const [consultations, evidence] = await Promise.all([
      db.select().from(qualityReviewConsultations).where(eq(qualityReviewConsultations.qualityReviewId, row.id)),
      db.select().from(qualityReviewEvidence).where(eq(qualityReviewEvidence.qualityReviewId, row.id)),
    ]);
    const missing = missingReviewAudiences(consultations);
    if (missing.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Consultation evidence is incomplete: ${missing.join(", ")}` });
    if (!evidence.some(item => item.status === "reviewed")) throw new TRPCError({ code: "BAD_REQUEST", message: "At least one evidence item must be reviewed before creating the report draft." });
    const { reviewId, ...values } = input;
    const reviewForPdf = { ...row, ...values };
    await db.update(qualityReviews).set({ ...values, status: "report_draft", completedAt: Date.now(), completedBy: ctx.user.id, approvedAt: null, approvedBy: null }).where(eq(qualityReviews.id, reviewId));
    const archive = await archiveDraftReport({ db, review: reviewForPdf, actorId: ctx.user.id, actorName: ctx.user.name ?? "Authorised user" });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: row.propertyId ?? undefined, action: "quality_review.report_draft", resourceType: "quality_review", resourceId: row.id, sensitivity: "restricted", result: "success", metadata: qualityReviewAuditMetadata({ state: "draft", documentId: archive.documentId, version: 1, evidenceCount: archive.evidenceCount, consultationCount: archive.consultationCount }) });
    return { success: true, reportDocumentId: archive.documentId };
  }),

  previewReport: protectedProcedure.input(entity.extend({ reviewId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const access = await assertQualityAccess(ctx.user.id, input.entityId, "compliance.read");
    const db = await requireDb();
    const [review] = await db.select().from(qualityReviews).where(and(eq(qualityReviews.id, input.reviewId), eq(qualityReviews.entityId, input.entityId))).limit(1);
    if (!review?.reportDocumentId || !["report_draft", "approved", "submitted"].includes(review.status)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A printable quality review report has not been prepared yet." });
    if (review.propertyId && access.role !== "platform_admin") await assertPropertyCapability(ctx.user.id, input.entityId, review.propertyId, "compliance.read");
    const [version] = await db.select().from(documentVersions).where(and(eq(documentVersions.documentId, review.reportDocumentId), eq(documentVersions.version, review.status === "report_draft" ? 1 : 2))).limit(1);
    if (!version?.fileKey) throw new TRPCError({ code: "NOT_FOUND", message: "The controlled quality-review PDF is unavailable." });
    const [evidence, consultations] = await Promise.all([
      db.select({ id: qualityReviewEvidence.id }).from(qualityReviewEvidence).where(eq(qualityReviewEvidence.qualityReviewId, review.id)),
      db.select({ id: qualityReviewConsultations.id }).from(qualityReviewConsultations).where(eq(qualityReviewConsultations.qualityReviewId, review.id)),
    ]);
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: review.propertyId ?? undefined, action: "quality_review.report_preview", resourceType: "quality_review", resourceId: review.id, sensitivity: "restricted", result: "allowed", metadata: qualityReviewAuditMetadata({ state: review.status === "report_draft" ? "draft" : "approved", documentId: review.reportDocumentId, version: version.version, evidenceCount: evidence.length, consultationCount: consultations.length }) });
    return { url: await storageGetSignedUrl(version.fileKey), fileName: version.fileName ?? qualityReviewPdfFileName(review.id, review.status === "report_draft" ? "draft" : "approved", Date.now()), status: review.status };
  }),

  approveReview: protectedProcedure.input(entity.extend({ reviewId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const access = await assertQualityAccess(ctx.user.id, input.entityId, "compliance.write");
    if (!isQualityReportManager(access.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Only an Owner, RSM, Manager or Nominated Individual can independently approve a quality review." });
    const { db, row } = await reviewForWrite(ctx.user.id, input.entityId, input.reviewId);
    assertIndependentQualityApproval({ status: row.status, reviewerId: ctx.user.id, createdBy: row.createdBy, completedBy: row.completedBy, existingReportDocumentId: row.reportDocumentId });
    if (!independentReviewAllowed(ctx.user.id, [row.createdBy, row.completedBy])) throw new TRPCError({ code: "FORBIDDEN", message: "A different authorised manager must approve the review." });
    const [draft] = await db.select().from(documentVersions).where(and(eq(documentVersions.documentId, row.reportDocumentId!), eq(documentVersions.version, 1))).limit(1);
    if (!draft?.fileKey) throw new TRPCError({ code: "NOT_FOUND", message: "The reviewed quality-report draft is unavailable." });
    const signedUrl = await storageGetSignedUrl(draft.fileKey); const response = await fetch(signedUrl);
    if (!response.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The quality-review draft could not be loaded for approval." });
    const approvedAt = Date.now();
    const context = await loadReportContext(db, row);
    const approvedBytes = await appendQualityReviewApproval({ stagedPdf: new Uint8Array(await response.arrayBuffer()), entityName: context.entityName, title: row.title, reviewId: row.id, approvedAt, approverName: ctx.user.name ?? "Authorised reviewer", approverRole: access.role });
    const fileName = qualityReviewPdfFileName(row.id, "approved", approvedAt);
    const stored = await storagePut(`entities/${input.entityId}/quality-reviews/${row.id}/approved-${randomUUID()}-${fileName}`, approvedBytes, "application/pdf");
    const contentHash = createHash("sha256").update(approvedBytes).digest("hex");
    await db.transaction(async (tx: any) => {
      await tx.insert(documentVersions).values({ documentId: row.reportDocumentId!, version: 2, fileKey: stored.key, fileUrl: stored.url, fileName, mimeType: "application/pdf", sizeBytes: approvedBytes.length, contentHash, scanStatus: "not_available", changeSummary: "Independent quality-review approval certificate appended", approvedAt, approvedBy: ctx.user.id, createdBy: ctx.user.id });
      await tx.update(documents).set({ status: "approved", currentVersion: 2 }).where(eq(documents.id, row.reportDocumentId!));
      await tx.update(qualityReviews).set({ status: "approved", approvedAt, approvedBy: ctx.user.id }).where(eq(qualityReviews.id, row.id));
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: row.propertyId ?? undefined, action: "quality_review.approved", resourceType: "quality_review", resourceId: row.id, sensitivity: "restricted", result: "success", metadata: qualityReviewAuditMetadata({ state: "approved", documentId: row.reportDocumentId!, version: 2, evidenceCount: context.evidence.length, consultationCount: context.consultations.length }) });
    return { success: true, reportDocumentId: row.reportDocumentId };
  }),

  submitReview: protectedProcedure.input(entity.extend({ reviewId: z.number().int().positive(), submissionMethod: z.enum(["email", "portal", "secure_link", "post", "other"]), submissionReference: z.string().max(180).optional(), submissionEvidenceDocumentId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
    const { db, row } = await reviewForWrite(ctx.user.id, input.entityId, input.reviewId);
    if (row.status !== "approved") throw new TRPCError({ code: "BAD_REQUEST", message: "Only an approved review can be recorded as submitted." });
    await assertEvidenceDocumentScope(db, input.entityId, row.propertyId, input.submissionEvidenceDocumentId);
    await db.update(qualityReviews).set({ status: "submitted", submittedAt: Date.now(), submittedBy: ctx.user.id, submissionMethod: input.submissionMethod, submissionReference: input.submissionReference, submissionEvidenceDocumentId: input.submissionEvidenceDocumentId }).where(eq(qualityReviews.id, row.id));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: row.propertyId ?? undefined, action: "quality_review.submitted", resourceType: "quality_review", resourceId: row.id, sensitivity: "restricted", result: "success", metadata: { submissionMethod: input.submissionMethod, hasSubmissionEvidence: Boolean(input.submissionEvidenceDocumentId) } });
    return { success: true };
  }),
});
