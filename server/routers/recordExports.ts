import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  documentVersions, documents, entities, printableRecordExports, properties, timesheets, users,
} from "../../drizzle/schema";
import {
  assertCurrentShiftPlacementCapability, assertEntityCapability, assertPropertyCapability, listAccessiblePropertyIds,
} from "../authz";
import { protectedProcedure, router } from "../_core/trpc";
import { decryptSensitive, encryptSensitive } from "../services/crypto";
import { appendRecordExportApproval, renderRecordExportPdf } from "../services/recordExportPdf";
import {
  assertIndependentPrintableReview, assertPrintableRange, isPrintableDocumentExportRole, isPrintableExportManagerRole,
  isPrintableShiftExportRole, printableAuditMetadata, printableExportClassification, printableExportFileName,
  printableExportFailureCode, printableExportRequiresIndependentApproval, printableExportRetentionBasis,
  printableExportRetentionMs, printableExportTitle, printableExportTypes,
} from "../services/printableRecordExportRules";
import {
  buildDocumentRegisterPrintableSnapshot, buildShiftPrintableSnapshot, buildTimesheetPrintableSnapshot,
  buildYoungPersonPrintableSnapshot, type PrintableSnapshot,
} from "../services/printableRecordExportSnapshots";
import { writeAuditEvent } from "../services/audit";
import { storageGetSignedUrl, storagePut } from "../storage";
import { requireDb } from "./shared";

const entityInput = z.object({ entityId: z.number().int().positive() });
const rangeInput = z.object({ rangeStart: z.number().int().positive(), rangeEnd: z.number().int().positive() });
const youngPersonRequestInput = entityInput.merge(rangeInput).extend({ placementId: z.number().int().positive() });
const propertyRequestInput = entityInput.merge(rangeInput).extend({ propertyId: z.number().int().positive().optional() });
const reviewInput = entityInput.extend({ id: z.number().int().positive(), decision: z.enum(["approved", "returned", "declined"]), notes: z.string().trim().max(4_000).optional() });
const printableReviewer = alias(users, "printableReviewer");

function snapshotHash(snapshot: PrintableSnapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function safeManifest(input: { snapshot: PrintableSnapshot; entityId: number; propertyId?: number | null; placementId?: number | null; timesheetId?: number | null; rangeStart: number; rangeEnd: number; generatedAt: number }) {
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    entityId: input.entityId,
    propertyId: input.propertyId ?? null,
    placementId: input.placementId ?? null,
    timesheetId: input.timesheetId ?? null,
    exportType: input.snapshot.type,
    sourceCounts: input.snapshot.sourceCounts,
    recordCount: input.snapshot.recordCount,
    dateRange: { start: input.rangeStart, end: input.rangeEnd },
    renderer: "record_export_pdf_v1",
  };
}

async function entityName(db: any, entityId: number) {
  const [entity] = await db.select({ name: entities.name }).from(entities).where(eq(entities.id, entityId)).limit(1);
  if (!entity) throw new TRPCError({ code: "NOT_FOUND", message: "Entity not found" });
  return entity.name;
}

async function propertyName(db: any, entityId: number, propertyId?: number) {
  if (!propertyId) return null;
  const [property] = await db.select({ name: properties.name }).from(properties).where(and(eq(properties.id, propertyId), eq(properties.entityId, entityId))).limit(1);
  if (!property) throw new TRPCError({ code: "NOT_FOUND", message: "Property not found" });
  return property.name;
}

async function assertManagerApprovalRole(userId: number, entityId: number) {
  const access = await assertEntityCapability(userId, entityId, "young_person.read");
  if (!isPrintableExportManagerRole(access.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only an Owner, RSM or Manager can approve young-person record exports." });
  }
  return access;
}

async function assertShiftExportScope(userId: number, entityId: number, propertyId?: number) {
  const access = await assertEntityCapability(userId, entityId, "shift.read");
  if (!isPrintableShiftExportRole(access.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only an Owner, RSM, Manager or HR/Compliance user can export shift records." });
  }
  if (propertyId) await assertPropertyCapability(userId, entityId, propertyId, "shift.read");
  const propertyIds = propertyId ? [propertyId] : await listAccessiblePropertyIds(userId, entityId, "shift.read");
  if (!propertyIds.length) throw new TRPCError({ code: "FORBIDDEN", message: "No authorised property is available for this shift export." });
  return { access, propertyIds };
}

async function assertDocumentExportScope(userId: number, entityId: number, propertyId?: number) {
  const access = await assertEntityCapability(userId, entityId, "document.read");
  if (!isPrintableDocumentExportRole(access.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only an Owner, RSM, Manager or HR/Compliance user can export a controlled document register." });
  }
  if (propertyId) await assertPropertyCapability(userId, entityId, propertyId, "document.read");
  const propertyIds = propertyId ? [propertyId] : await listAccessiblePropertyIds(userId, entityId, "document.read");
  return { access, propertyIds };
}

async function loadExport(db: any, entityId: number, id: number) {
  const [row] = await db.select({ export: printableRecordExports, requestedByName: users.name }).from(printableRecordExports)
    .innerJoin(users, eq(users.id, printableRecordExports.requestedBy))
    .where(and(eq(printableRecordExports.id, id), eq(printableRecordExports.entityId, entityId))).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Printable export request not found." });
  return row;
}

async function archiveStagedSnapshot(input: { db: any; requestId: number; requesterId: number; requesterName: string; entityId: number; propertyId?: number | null; placementId?: number | null; timesheetId?: number | null; rangeStart: number; rangeEnd: number; snapshot: PrintableSnapshot; snapshotHash: string }) {
  const createdAt = Date.now();
  const type = input.snapshot.type;
  const title = printableExportTitle(type);
  const fileName = printableExportFileName(type, input.requestId, createdAt);
  const bytes = await renderRecordExportPdf({
    title, entityName: input.snapshot.entityName, propertyName: input.snapshot.propertyName,
    placementReference: input.snapshot.placementReference, preferredName: input.snapshot.preferredName,
    rangeStart: input.rangeStart, rangeEnd: input.rangeEnd, generatedAt: createdAt, snapshotHash: input.snapshotHash,
    requestedByName: input.requesterName, sections: input.snapshot.sections,
  });
  const stored = await storagePut(`entities/${input.entityId}/printable-record-exports/${input.requestId}/staged-${fileName}`, bytes, "application/pdf");
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const classification = printableExportClassification(type);
  const [document] = await input.db.insert(documents).values({
    entityId: input.entityId, propertyId: input.propertyId ?? undefined,
    title: `${title} · ${input.snapshot.placementReference ?? `Export ${input.requestId}`}`.slice(0, 240),
    documentType: "generated", classification, status: printableExportRequiresIndependentApproval(type) ? "in_review" : "approved",
    retentionBasis: printableExportRetentionBasis, retentionUntil: createdAt + printableExportRetentionMs, createdBy: input.requesterId,
  }).$returningId();
  await input.db.insert(documentVersions).values({
    documentId: document.id, version: 1, fileKey: stored.key, fileUrl: stored.url, fileName, mimeType: "application/pdf", sizeBytes: bytes.length,
    contentHash, scanStatus: "not_available", changeSummary: printableExportRequiresIndependentApproval(type) ? "Immutable staged printable-record snapshot awaiting independent approval" : "System-generated controlled printable-record snapshot",
    approvedAt: printableExportRequiresIndependentApproval(type) ? undefined : createdAt,
    approvedBy: printableExportRequiresIndependentApproval(type) ? undefined : input.requesterId,
    createdBy: input.requesterId,
  });
  return { documentId: document.id, createdAt, contentHash };
}

async function createExport(input: { db: any; entityId: number; propertyId?: number | null; placementId?: number | null; timesheetId?: number | null; requesterId: number; requesterName: string; rangeStart: number; rangeEnd: number; snapshot: PrintableSnapshot }) {
  const createdAt = Date.now();
  const hash = snapshotHash(input.snapshot);
  const manifest = safeManifest({ snapshot: input.snapshot, entityId: input.entityId, propertyId: input.propertyId, placementId: input.placementId, timesheetId: input.timesheetId, rangeStart: input.rangeStart, rangeEnd: input.rangeEnd, generatedAt: createdAt });
  const requiresApproval = printableExportRequiresIndependentApproval(input.snapshot.type);
  const [request] = await input.db.insert(printableRecordExports).values({
    entityId: input.entityId, propertyId: input.propertyId ?? undefined, placementId: input.placementId ?? undefined, timesheetId: input.timesheetId ?? undefined,
    exportType: input.snapshot.type, rangeStart: input.rangeStart, rangeEnd: input.rangeEnd, status: requiresApproval ? "awaiting_approval" : "generating",
    snapshotHash: hash, manifest, requestedBy: input.requesterId,
  }).$returningId();
  try {
    const archive = await archiveStagedSnapshot({ ...input, requestId: request.id, snapshotHash: hash });
    await input.db.update(printableRecordExports).set({ documentId: archive.documentId, status: requiresApproval ? "awaiting_approval" : "ready", releasedAt: requiresApproval ? undefined : archive.createdAt }).where(eq(printableRecordExports.id, request.id));
    await writeAuditEvent({ actorUserId: input.requesterId, entityId: input.entityId, propertyId: input.propertyId ?? undefined, action: "printable_record_export.request", resourceType: "printable_record_export", resourceId: request.id, sensitivity: printableExportClassification(input.snapshot.type), result: "success", metadata: printableAuditMetadata({ exportType: input.snapshot.type, recordCount: input.snapshot.recordCount, documentId: archive.documentId }) });
    return { id: request.id, status: requiresApproval ? "awaiting_approval" as const : "ready" as const };
  } catch (error) {
    const errorCode = printableExportFailureCode(error);
    await input.db.update(printableRecordExports).set({ status: "failed", errorCode }).where(eq(printableRecordExports.id, request.id));
    await writeAuditEvent({ actorUserId: input.requesterId, entityId: input.entityId, propertyId: input.propertyId ?? undefined, action: "printable_record_export.generate", resourceType: "printable_record_export", resourceId: request.id, sensitivity: printableExportClassification(input.snapshot.type), result: "failure", reasonCode: errorCode, metadata: printableAuditMetadata({ exportType: input.snapshot.type, recordCount: input.snapshot.recordCount }) });
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The printable record could not be generated. The failed request was retained for audit review." });
  }
}

async function assertExportReadScope(userId: number, row: typeof printableRecordExports.$inferSelect) {
  if (row.exportType === "young_person_compilation") {
    if (!row.placementId) throw new TRPCError({ code: "NOT_FOUND", message: "Export scope is incomplete." });
    await assertCurrentShiftPlacementCapability(userId, row.placementId, "young_person.read");
    return;
  }
  if (row.exportType === "document_register") { await assertDocumentExportScope(userId, row.entityId, row.propertyId ?? undefined); return; }
  if (row.exportType === "shift_register") { await assertShiftExportScope(userId, row.entityId, row.propertyId ?? undefined); return; }
  const access = await assertEntityCapability(userId, row.entityId, "shift.read");
  if (!isPrintableShiftExportRole(access.role) && row.requestedBy !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "You are not authorised to download this controlled timesheet record." });
}

function exportSummary(row: typeof printableRecordExports.$inferSelect, requestedByName: string | null, reviewerName?: string | null) {
  const manifest = row.manifest as Record<string, any>;
  return {
    id: row.id, exportType: row.exportType, propertyId: row.propertyId, placementId: row.placementId, timesheetId: row.timesheetId,
    rangeStart: row.rangeStart, rangeEnd: row.rangeEnd, status: row.status, snapshotHash: row.snapshotHash, sourceCounts: manifest?.sourceCounts ?? {}, recordCount: manifest?.recordCount ?? 0,
    requestedByName: requestedByName ?? "Authorised user", requestedAt: row.createdAt, reviewerName: reviewerName ?? null, reviewerRole: row.reviewerRole, reviewedAt: row.reviewedAt, releasedAt: row.releasedAt, errorCode: row.errorCode,
  };
}

export const recordExportsRouter = router({
  requestYoungPersonCompilation: protectedProcedure.input(youngPersonRequestInput).mutation(async ({ ctx, input }) => {
    assertPrintableRange(input.rangeStart, input.rangeEnd);
    const scope = await assertCurrentShiftPlacementCapability(ctx.user.id, input.placementId, "young_person.read");
    if (scope.placement.entityId !== input.entityId) throw new TRPCError({ code: "FORBIDDEN", message: "Placement access denied." });
    const db = await requireDb(); const name = await entityName(db, input.entityId);
    const snapshot = await buildYoungPersonPrintableSnapshot(db, { ...input, entityName: name });
    return createExport({ db, entityId: input.entityId, propertyId: scope.placement.propertyId, placementId: input.placementId, requesterId: ctx.user.id, requesterName: ctx.user.name ?? "Authorised user", rangeStart: input.rangeStart, rangeEnd: input.rangeEnd, snapshot });
  }),

  requestShiftRegister: protectedProcedure.input(propertyRequestInput).mutation(async ({ ctx, input }) => {
    assertPrintableRange(input.rangeStart, input.rangeEnd);
    const { access, propertyIds } = await assertShiftExportScope(ctx.user.id, input.entityId, input.propertyId);
    const db = await requireDb(); const [name, selectedPropertyName] = await Promise.all([entityName(db, input.entityId), propertyName(db, input.entityId, input.propertyId)]);
    const snapshot = await buildShiftPrintableSnapshot(db, { ...input, entityName: name, propertyIds, propertyName: selectedPropertyName ?? "All authorised properties", includeSensitiveHandover: access.role === "owner" || access.role === "registered_manager" });
    return createExport({ db, entityId: input.entityId, propertyId: input.propertyId, requesterId: ctx.user.id, requesterName: ctx.user.name ?? "Authorised user", rangeStart: input.rangeStart, rangeEnd: input.rangeEnd, snapshot });
  }),

  requestDocumentRegister: protectedProcedure.input(propertyRequestInput).mutation(async ({ ctx, input }) => {
    assertPrintableRange(input.rangeStart, input.rangeEnd);
    const { propertyIds } = await assertDocumentExportScope(ctx.user.id, input.entityId, input.propertyId);
    const db = await requireDb(); const [name, selectedPropertyName] = await Promise.all([entityName(db, input.entityId), propertyName(db, input.entityId, input.propertyId)]);
    const snapshot = await buildDocumentRegisterPrintableSnapshot(db, { ...input, entityName: name, propertyIds, propertyName: selectedPropertyName ?? "All authorised properties" });
    return createExport({ db, entityId: input.entityId, propertyId: input.propertyId, requesterId: ctx.user.id, requesterName: ctx.user.name ?? "Authorised user", rangeStart: input.rangeStart, rangeEnd: input.rangeEnd, snapshot });
  }),

  requestTimesheet: protectedProcedure.input(entityInput.extend({ timesheetId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [sheet] = await db.select().from(timesheets).where(and(eq(timesheets.id, input.timesheetId), eq(timesheets.entityId, input.entityId))).limit(1);
    if (!sheet) throw new TRPCError({ code: "NOT_FOUND", message: "Timesheet not found." });
    const access = await assertEntityCapability(ctx.user.id, input.entityId, "shift.read");
    if (!isPrintableShiftExportRole(access.role) && sheet.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "You are not authorised to export this timesheet." });
    if (!['approved', 'exported'].includes(sheet.status)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only an independently approved timesheet can be exported as a printable record." });
    const [worker] = await db.select({ name: users.name }).from(users).where(eq(users.id, sheet.userId)).limit(1);
    const name = await entityName(db, input.entityId);
    const snapshot = await buildTimesheetPrintableSnapshot(db, { entityId: input.entityId, timesheetId: sheet.id, entityName: name, workerName: worker?.name ?? "Worker", rangeStart: sheet.periodStart, rangeEnd: sheet.periodEnd, approvedAt: sheet.approvedAt });
    return createExport({ db, entityId: input.entityId, timesheetId: sheet.id, requesterId: ctx.user.id, requesterName: ctx.user.name ?? "Authorised user", rangeStart: sheet.periodStart, rangeEnd: sheet.periodEnd, snapshot });
  }),

  placementExports: protectedProcedure.input(entityInput.extend({ placementId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const scope = await assertCurrentShiftPlacementCapability(ctx.user.id, input.placementId, "young_person.read");
    if (scope.placement.entityId !== input.entityId) throw new TRPCError({ code: "FORBIDDEN", message: "Placement access denied." });
    const db = await requireDb();
    const rows = await db.select({ export: printableRecordExports, requestedByName: users.name, reviewerName: printableReviewer.name }).from(printableRecordExports).innerJoin(users, eq(users.id, printableRecordExports.requestedBy)).leftJoin(printableReviewer, eq(printableReviewer.id, printableRecordExports.reviewedBy)).where(and(eq(printableRecordExports.entityId, input.entityId), eq(printableRecordExports.placementId, input.placementId))).orderBy(desc(printableRecordExports.createdAt));
    return rows.map((row: any) => exportSummary(row.export, row.requestedByName, row.reviewerName));
  }),

  shiftExports: protectedProcedure.input(entityInput.extend({ propertyId: z.number().int().positive().optional() })).query(async ({ ctx, input }) => {
    await assertShiftExportScope(ctx.user.id, input.entityId, input.propertyId);
    const db = await requireDb();
    const rows = await db.select({ export: printableRecordExports, requestedByName: users.name, reviewerName: printableReviewer.name }).from(printableRecordExports).innerJoin(users, eq(users.id, printableRecordExports.requestedBy)).leftJoin(printableReviewer, eq(printableReviewer.id, printableRecordExports.reviewedBy)).where(and(eq(printableRecordExports.entityId, input.entityId), eq(printableRecordExports.exportType, "shift_register"), input.propertyId ? eq(printableRecordExports.propertyId, input.propertyId) : undefined)).orderBy(desc(printableRecordExports.createdAt));
    return rows.map((row: any) => exportSummary(row.export, row.requestedByName, row.reviewerName));
  }),

  documentExports: protectedProcedure.input(entityInput.extend({ propertyId: z.number().int().positive().optional() })).query(async ({ ctx, input }) => {
    await assertDocumentExportScope(ctx.user.id, input.entityId, input.propertyId);
    const db = await requireDb();
    const rows = await db.select({ export: printableRecordExports, requestedByName: users.name, reviewerName: printableReviewer.name }).from(printableRecordExports).innerJoin(users, eq(users.id, printableRecordExports.requestedBy)).leftJoin(printableReviewer, eq(printableReviewer.id, printableRecordExports.reviewedBy)).where(and(eq(printableRecordExports.entityId, input.entityId), eq(printableRecordExports.exportType, "document_register"), input.propertyId ? eq(printableRecordExports.propertyId, input.propertyId) : undefined)).orderBy(desc(printableRecordExports.createdAt));
    return rows.map((row: any) => exportSummary(row.export, row.requestedByName, row.reviewerName));
  }),

  approvalQueue: protectedProcedure.input(entityInput).query(async ({ ctx, input }) => {
    await assertManagerApprovalRole(ctx.user.id, input.entityId);
    const db = await requireDb();
    const rows = await db.select({ export: printableRecordExports, requestedByName: users.name, propertyName: properties.name }).from(printableRecordExports)
      .innerJoin(users, eq(users.id, printableRecordExports.requestedBy)).leftJoin(properties, eq(properties.id, printableRecordExports.propertyId))
      .where(and(eq(printableRecordExports.entityId, input.entityId), eq(printableRecordExports.exportType, "young_person_compilation"), inArray(printableRecordExports.status, ["awaiting_approval", "failed"]))).orderBy(desc(printableRecordExports.createdAt));
    return rows.map((row: any) => ({ ...exportSummary(row.export, row.requestedByName), propertyName: row.propertyName }));
  }),

  preview: protectedProcedure.input(entityInput.extend({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertManagerApprovalRole(ctx.user.id, input.entityId);
    const db = await requireDb(); const { export: row } = await loadExport(db, input.entityId, input.id);
    if (row.exportType !== "young_person_compilation" || !row.documentId || !["awaiting_approval", "failed"].includes(row.status)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A staged young-person record PDF is not available for review." });
    const [version] = await db.select().from(documentVersions).where(and(eq(documentVersions.documentId, row.documentId), eq(documentVersions.version, 1))).limit(1);
    if (!version?.fileKey) throw new TRPCError({ code: "NOT_FOUND", message: "The staged PDF is unavailable." });
    const url = await storageGetSignedUrl(version.fileKey);
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: row.propertyId ?? undefined, action: "printable_record_export.preview", resourceType: "printable_record_export", resourceId: row.id, sensitivity: "safeguarding", result: "allowed", metadata: printableAuditMetadata({ exportType: row.exportType, recordCount: Number((row.manifest as any)?.recordCount ?? 0), documentId: row.documentId }) });
    return { url, fileName: version.fileName ?? "staged-record.pdf" };
  }),

  review: protectedProcedure.input(reviewInput).mutation(async ({ ctx, input }) => {
    const access = await assertManagerApprovalRole(ctx.user.id, input.entityId);
    const db = await requireDb(); const { export: row, requestedByName } = await loadExport(db, input.entityId, input.id);
    if (row.exportType !== "young_person_compilation") throw new TRPCError({ code: "BAD_REQUEST", message: "Only young-person record compilations use this approval workflow." });
    assertIndependentPrintableReview({ status: row.status, requestedBy: row.requestedBy, reviewerId: ctx.user.id, decision: input.decision, notes: input.notes });
    const reviewedAt = Date.now();
    if (input.decision !== "approved") {
      await db.update(printableRecordExports).set({ status: input.decision, reviewedBy: ctx.user.id, reviewerRole: access.role, reviewedAt, reviewNotesCiphertext: input.notes ? encryptSensitive(input.notes) : null }).where(eq(printableRecordExports.id, row.id));
      await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: row.propertyId ?? undefined, action: `printable_record_export.${input.decision}`, resourceType: "printable_record_export", resourceId: row.id, sensitivity: "safeguarding", result: "success", metadata: printableAuditMetadata({ exportType: row.exportType, recordCount: Number((row.manifest as any)?.recordCount ?? 0), documentId: row.documentId ?? undefined }) });
      return { id: row.id, status: input.decision };
    }
    if (!row.documentId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The staged PDF is unavailable for approval." });
    try {
      const [staged] = await db.select().from(documentVersions).where(and(eq(documentVersions.documentId, row.documentId), eq(documentVersions.version, 1))).limit(1);
      if (!staged?.fileKey) throw new Error("Staged PDF missing");
      const stagedUrl = await storageGetSignedUrl(staged.fileKey); const stagedResponse = await fetch(stagedUrl);
      if (!stagedResponse.ok) throw new Error("Staged PDF retrieval failed");
      const approvedBytes = await appendRecordExportApproval({ stagedPdf: new Uint8Array(await stagedResponse.arrayBuffer()), title: printableExportTitle(row.exportType), entityName: await entityName(db, input.entityId), snapshotHash: row.snapshotHash, approvedAt: reviewedAt, approverName: ctx.user.name ?? "Authorised reviewer", approverRole: access.role, exportId: row.id });
      const finalFileName = printableExportFileName(row.exportType, row.id, reviewedAt); const stored = await storagePut(`entities/${input.entityId}/printable-record-exports/${row.id}/approved-${finalFileName}`, approvedBytes, "application/pdf");
      const contentHash = createHash("sha256").update(approvedBytes).digest("hex");
      await db.transaction(async (tx: any) => {
        await tx.insert(documentVersions).values({ documentId: row.documentId!, version: 2, fileKey: stored.key, fileUrl: stored.url, fileName: finalFileName, mimeType: "application/pdf", sizeBytes: approvedBytes.length, contentHash, scanStatus: "not_available", changeSummary: "Independent approval certificate appended to immutable staged record snapshot", approvedAt: reviewedAt, approvedBy: ctx.user.id, createdBy: ctx.user.id });
        await tx.update(documents).set({ status: "approved", currentVersion: 2 }).where(eq(documents.id, row.documentId!));
        await tx.update(printableRecordExports).set({ status: "ready", reviewedBy: ctx.user.id, reviewerRole: access.role, reviewedAt, reviewNotesCiphertext: input.notes ? encryptSensitive(input.notes) : null, releasedAt: reviewedAt, errorCode: null }).where(eq(printableRecordExports.id, row.id));
      });
      await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: row.propertyId ?? undefined, action: "printable_record_export.approved", resourceType: "printable_record_export", resourceId: row.id, sensitivity: "safeguarding", result: "success", metadata: printableAuditMetadata({ exportType: row.exportType, recordCount: Number((row.manifest as any)?.recordCount ?? 0), documentId: row.documentId }) });
      return { id: row.id, status: "ready" as const };
    } catch (error) {
      const errorCode = printableExportFailureCode(error);
      await db.update(printableRecordExports).set({ status: "failed", reviewedBy: ctx.user.id, reviewerRole: access.role, reviewedAt, errorCode }).where(eq(printableRecordExports.id, row.id));
      await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: row.propertyId ?? undefined, action: "printable_record_export.approval_generate", resourceType: "printable_record_export", resourceId: row.id, sensitivity: "safeguarding", result: "failure", reasonCode: errorCode, metadata: printableAuditMetadata({ exportType: row.exportType, recordCount: Number((row.manifest as any)?.recordCount ?? 0), documentId: row.documentId }) });
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The approved PDF could not be generated. The staged request is retained for controlled review and retry." });
    }
  }),

  download: protectedProcedure.input(entityInput.extend({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb(); const { export: row } = await loadExport(db, input.entityId, input.id);
    await assertExportReadScope(ctx.user.id, row);
    if (row.status !== "ready" || !row.documentId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This printable record is not approved and ready for controlled download." });
    const [version] = await db.select().from(documentVersions).where(and(eq(documentVersions.documentId, row.documentId), eq(documentVersions.version, row.exportType === "young_person_compilation" ? 2 : 1))).limit(1);
    if (!version?.fileKey) throw new TRPCError({ code: "NOT_FOUND", message: "The approved PDF is unavailable." });
    const url = await storageGetSignedUrl(version.fileKey);
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: row.propertyId ?? undefined, action: "printable_record_export.download", resourceType: "printable_record_export", resourceId: row.id, sensitivity: printableExportClassification(row.exportType), result: "allowed", metadata: printableAuditMetadata({ exportType: row.exportType, recordCount: Number((row.manifest as any)?.recordCount ?? 0), documentId: row.documentId }) });
    return { url, fileName: version.fileName ?? printableExportFileName(row.exportType, row.id, Date.now()) };
  }),
});

export function printableExportReviewNoteForTest(value: string | null | undefined) {
  return value ? decryptSensitive(value) : null;
}
