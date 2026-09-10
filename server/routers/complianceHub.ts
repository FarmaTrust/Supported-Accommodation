import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  documentFolders,
  documents,
  documentVersions,
  integrationAttempts,
  integrationConnections,
  integrationDeliveries,
  properties,
  propertyAssignments,
  propertyEvidence,
  staffProfiles,
  workforceChecks,
} from "../../drizzle/schema";
import { assertEntityCapability, listAccessiblePropertyIds, roleHasCapability } from "../authz";
import { protectedProcedure, router } from "../_core/trpc";
import { writeAuditEvent } from "../services/audit";
import {
  CERTIFICATE_LIBRARY_FOLDERS,
  propertyCategory,
  renewalBand,
  STAFF_COMPLIANCE_CATEGORIES,
  STAFF_COMPLIANCE_LABELS,
  staffCategory,
} from "../services/complianceRenewalRules";
import { runComplianceRenewalEvaluation } from "../services/complianceRenewals";
import {
  PROPERTY_COMPLIANCE_KINDS,
  PROPERTY_COMPLIANCE_LABELS,
} from "../services/propertyComplianceRules";
import { requireDb } from "./shared";

const entityInput = z.object({ entityId: z.number().int().positive() });

function counts(items: Array<{ ragStatus: string }>) {
  return items.reduce(
    (result, item) => ({ ...result, [item.ragStatus]: (result[item.ragStatus as keyof typeof result] ?? 0) + 1 }),
    { green: 0, amber: 0, red: 0, grey: 0 },
  );
}

export const complianceHubRouter = router({
  workspace: protectedProcedure.input(entityInput).query(async ({ ctx, input }) => {
    const access = await assertEntityCapability(ctx.user.id, input.entityId, "compliance.read");
    const propertyIds = await listAccessiblePropertyIds(ctx.user.id, input.entityId, "compliance.read");
    const canReadStaff = roleHasCapability(access.role, "staff.sensitive");
    const unrestrictedProperties = access.role === "owner" || access.allProperties;
    const db = await requireDb();

    const propertyRows = propertyIds.length
      ? await db.select({ id: properties.id, name: properties.name, addressLine1: properties.addressLine1 })
        .from(properties).where(and(eq(properties.entityId, input.entityId), inArray(properties.id, propertyIds)))
      : [];
    const propertyNames = new Map(propertyRows.map(item => [item.id, item.name]));
    const evidenceRows = propertyIds.length
      ? await db.select().from(propertyEvidence)
        .where(and(eq(propertyEvidence.entityId, input.entityId), inArray(propertyEvidence.propertyId, propertyIds)))
      : [];
    const propertyItems = evidenceRows.map(row => {
      const category = propertyCategory(row);
      if (!category) return null;
      const renewal = renewalBand(row.dueAt);
      const evidenceReady = Boolean(row.documentId) && !["draft", "action_required"].includes(row.status);
      return {
        id: row.id,
        propertyId: row.propertyId,
        propertyName: propertyNames.get(row.propertyId) ?? "Property",
        category,
        categoryLabel: PROPERTY_COMPLIANCE_LABELS[category],
        title: row.title,
        reference: row.reference,
        dueAt: row.dueAt,
        documentId: row.documentId,
        hasEvidence: evidenceReady,
        ...renewal,
        ragStatus: evidenceReady ? renewal.ragStatus : "red" as const,
        label: evidenceReady ? renewal.label : "Approved evidence required",
      };
    }).filter(Boolean) as Array<any>;

    let staffItems: Array<any> = [];
    let staffOptions: Array<{ id: number; fullName: string }> = [];
    if (canReadStaff) {
      const profiles = await db.select().from(staffProfiles).where(eq(staffProfiles.entityId, input.entityId));
      let visibleProfiles = profiles;
      if (!unrestrictedProperties) {
        const assignments = propertyIds.length
          ? await db.select({ userId: propertyAssignments.userId }).from(propertyAssignments)
            .where(and(eq(propertyAssignments.entityId, input.entityId), inArray(propertyAssignments.propertyId, propertyIds)))
          : [];
        const assignedUserIds = new Set(assignments.map(item => item.userId));
        visibleProfiles = profiles.filter(item => Boolean(item.userId && assignedUserIds.has(item.userId)));
      }
      staffOptions = visibleProfiles.map(item => ({ id: item.id, fullName: item.fullName }));
      const profileIds = visibleProfiles.map(item => item.id);
      const profileNames = new Map(visibleProfiles.map(item => [item.id, item.fullName]));
      const checkRows = profileIds.length
        ? await db.select().from(workforceChecks)
          .where(and(eq(workforceChecks.entityId, input.entityId), inArray(workforceChecks.staffProfileId, profileIds)))
        : [];
      staffItems = checkRows.map(row => {
        const category = staffCategory(row);
        if (!category) return null;
        const renewal = renewalBand(row.expiresAt);
        const evidenceReady = Boolean(row.evidenceDocumentId) && ["valid", "expiring", "expired"].includes(row.status);
        return {
          id: row.id,
          staffProfileId: row.staffProfileId,
          staffName: profileNames.get(row.staffProfileId) ?? "Staff member",
          category,
          categoryLabel: STAFF_COMPLIANCE_LABELS[category],
          title: row.title,
          reference: row.reference,
          dueAt: row.expiresAt,
          documentId: row.evidenceDocumentId,
          hasEvidence: evidenceReady,
          ...renewal,
          ragStatus: evidenceReady ? renewal.ragStatus : "red" as const,
          label: evidenceReady ? renewal.label : "Approved evidence required",
        };
      }).filter(Boolean);
    }

    const [connection] = await db.select().from(integrationConnections)
      .where(and(eq(integrationConnections.entityId, input.entityId), eq(integrationConnections.integrationType, "email")))
      .limit(1);
    const deliveries = connection
      ? await db.select().from(integrationDeliveries)
        .where(and(eq(integrationDeliveries.entityId, input.entityId), eq(integrationDeliveries.connectionId, connection.id), eq(integrationDeliveries.deliveryType, "email")))
        .orderBy(desc(integrationDeliveries.createdAt)).limit(50)
      : [];
    const deliveryIds = deliveries.map(item => item.id);
    const attempts = deliveryIds.length
      ? await db.select().from(integrationAttempts).where(inArray(integrationAttempts.deliveryId, deliveryIds)).orderBy(desc(integrationAttempts.startedAt))
      : [];

    let documentRows = unrestrictedProperties
      ? await db.select({ id: documents.id, title: documents.title, propertyId: documents.propertyId, folderId: documents.folderId, classification: documents.classification, status: documents.status, documentType: documents.documentType, currentVersion: documents.currentVersion })
        .from(documents).where(and(eq(documents.entityId, input.entityId), eq(documents.documentType, "certificate")))
      : propertyIds.length
        ? await db.select({ id: documents.id, title: documents.title, propertyId: documents.propertyId, folderId: documents.folderId, classification: documents.classification, status: documents.status, documentType: documents.documentType, currentVersion: documents.currentVersion })
          .from(documents).where(and(eq(documents.entityId, input.entityId), eq(documents.documentType, "certificate"), inArray(documents.propertyId, propertyIds)))
        : [];
    if (!canReadStaff) documentRows = documentRows.filter(item => item.classification !== "hr");
    const documentIds = documentRows.map(item => item.id);
    const versions = documentIds.length
      ? await db.select({ documentId: documentVersions.documentId, scanStatus: documentVersions.scanStatus, fileName: documentVersions.fileName, createdAt: documentVersions.createdAt })
        .from(documentVersions).where(inArray(documentVersions.documentId, documentIds)).orderBy(desc(documentVersions.createdAt))
      : [];
    const latestVersions = new Map<number, typeof versions[number]>();
    for (const version of versions) if (!latestVersions.has(version.documentId)) latestVersions.set(version.documentId, version);
    const folders = await db.select().from(documentFolders).where(eq(documentFolders.entityId, input.entityId));
    const folderNames = new Map(folders.map(item => [item.id, item.name]));
    const certificateLibrary = documentRows.map(row => ({
      ...row,
      folderName: row.folderId ? folderNames.get(row.folderId) ?? "Uncategorised" : "Uncategorised",
      scanStatus: latestVersions.get(row.id)?.scanStatus ?? "pending",
      fileName: latestVersions.get(row.id)?.fileName ?? null,
    }));

    return {
      summary: { all: counts([...propertyItems, ...staffItems]), property: counts(propertyItems), staff: counts(staffItems) },
      propertyCategories: PROPERTY_COMPLIANCE_KINDS.map(value => ({ value, label: PROPERTY_COMPLIANCE_LABELS[value] })),
      staffCategories: STAFF_COMPLIANCE_CATEGORIES.map(value => ({ value, label: STAFF_COMPLIANCE_LABELS[value] })),
      properties: propertyRows,
      propertyItems,
      staffItems,
      staffOptions,
      staffRestricted: !canReadStaff,
      staffEvidenceDocuments: canReadStaff
        ? certificateLibrary.filter(item => item.classification === "hr" && item.status === "approved" && item.scanStatus === "clean")
          .map(item => ({ id: item.id, title: item.title, folderName: item.folderName }))
        : [],
      email: {
        providerStatus: connection?.status ?? "not_connected",
        connectionName: connection?.name ?? null,
        outboxCount: deliveries.length,
        deliveries: deliveries.map(item => ({ ...item, latestAttempt: attempts.find(attempt => attempt.deliveryId === item.id) ?? null })),
      },
      certificateLibrary,
      folders,
    };
  }),

  runRenewalCheck: protectedProcedure.input(entityInput).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "compliance.write");
    const result = await runComplianceRenewalEvaluation(input.entityId);
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "compliance_renewal.manual_run", resourceType: "entity", resourceId: input.entityId, result: "success", metadata: result });
    return result;
  }),

  ensureCertificateLibrary: protectedProcedure.input(entityInput).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "document.write");
    const db = await requireDb();
    const existing = await db.select().from(documentFolders).where(eq(documentFolders.entityId, input.entityId));
    let root = existing.find(item => item.parentFolderId == null && item.name === "Certificates");
    if (!root) {
      const [result] = await db.insert(documentFolders).values({ entityId: input.entityId, name: "Certificates", classification: "restricted", createdBy: ctx.user.id }).$returningId();
      root = { id: result.id, entityId: input.entityId, parentFolderId: null, name: "Certificates", classification: "restricted", createdBy: ctx.user.id, createdAt: new Date() };
    }
    let created = 0;
    for (const name of CERTIFICATE_LIBRARY_FOLDERS) {
      if (existing.some(item => item.parentFolderId === root!.id && item.name === name)) continue;
      await db.insert(documentFolders).values({ entityId: input.entityId, parentFolderId: root.id, name, classification: name.startsWith("Staff") ? "hr" : "restricted", createdBy: ctx.user.id });
      created += 1;
    }
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "certificate_library.ensure", resourceType: "document_folder", resourceId: root.id, result: "success", metadata: { created } });
    return { rootFolderId: root.id, created, total: CERTIFICATE_LIBRARY_FOLDERS.length };
  }),
});
