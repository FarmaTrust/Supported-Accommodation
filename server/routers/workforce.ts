import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { documents, documentTemplates, staffProfiles, workforceChecks } from "../../drizzle/schema";
import { assertEntityCapability } from "../authz";
import { protectedProcedure, router } from "../_core/trpc";
import { writeAuditEvent } from "../services/audit";
import { calculateRagStatus } from "../services/rules";
import { requireDb } from "./shared";
import { STAFF_COMPLIANCE_CATEGORIES, renewalBand } from "../services/complianceRenewalRules";
import { TRPCError } from "@trpc/server";

export const workforceRouter = router({
  list: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "staff.read");
    const db = await requireDb();
    return db.select().from(staffProfiles).where(eq(staffProfiles.entityId, input.entityId));
  }),

  create: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(), fullName: z.string().min(2).max(180), email: z.string().email().optional().or(z.literal("")),
    phone: z.string().max(40).optional(), jobTitle: z.string().min(2).max(160), employeeNumber: z.string().max(40).optional(),
    employmentType: z.enum(["permanent", "fixed_term", "casual", "agency", "volunteer"]), startDate: z.number().int().optional(),
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "staff.write");
    const db = await requireDb();
    const existing = await db.select({ id: staffProfiles.id, email: staffProfiles.email, employeeNumber: staffProfiles.employeeNumber }).from(staffProfiles).where(eq(staffProfiles.entityId, input.entityId));
    const duplicate = existing.find(item => (input.email && item.email?.toLowerCase() === input.email.toLowerCase()) || (input.employeeNumber && item.employeeNumber?.toLowerCase() === input.employeeNumber.toLowerCase()));
    if (duplicate) throw new Error(`A workforce profile with this email or employee number already exists (#${duplicate.id}). Review it instead of adding a duplicate.`);
    const [result] = await db.insert(staffProfiles).values({ ...input, email: input.email || null, createdBy: ctx.user.id }).$returningId();
    const starterChecks = [
      { checkType: "identity" as const, title: "Identity verified" },
      { checkType: "dbs" as const, title: "Eligible DBS check" },
      { checkType: "right_to_work" as const, title: "Right to Work check" },
      { checkType: "reference" as const, title: "First verified reference" },
      { checkType: "reference" as const, title: "Second verified reference" },
      { checkType: "induction" as const, title: "Induction completed" },
    ];
    await db.insert(workforceChecks).values(starterChecks.map(item => ({ ...item, entityId: input.entityId, staffProfileId: result.id, status: "missing" as const, createdBy: ctx.user.id })));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "staff.create", resourceType: "staff_profile", resourceId: result.id, sensitivity: "hr", result: "success" });
    return { id: result.id };
  }),

  checks: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), staffProfileId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "staff.sensitive");
    const db = await requireDb();
    const rows = await db.select().from(workforceChecks).where(eq(workforceChecks.staffProfileId, input.staffProfileId));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "staff_checks.read", resourceType: "staff_profile", resourceId: input.staffProfileId, sensitivity: "hr", result: "allowed" });
    return rows.map(item => ({ ...item, ragStatus: calculateRagStatus(item.expiresAt, item.status === "valid" && !item.expiresAt ? Date.now() : null, 30) }));
  }),

  createCheck: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(), staffProfileId: z.number().int().positive(),
    checkType: z.enum(["identity", "dbs", "right_to_work", "reference", "employment_gap", "qualification", "training", "induction", "probation", "supervision", "appraisal", "policy_acknowledgement"]),
    title: z.string().min(3).max(200), issuedAt: z.number().int().optional(), expiresAt: z.number().int().optional(), reference: z.string().max(160).optional(), level: z.enum(STAFF_COMPLIANCE_CATEGORIES).optional(), evidenceDocumentId: z.number().int().positive().optional(),
    notes: z.string().max(8000).optional(), templateId: z.number().int().positive().optional(),
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "staff.sensitive"); const db = await requireDb();
    const [profile] = await db.select({ id: staffProfiles.id }).from(staffProfiles).where(and(eq(staffProfiles.id, input.staffProfileId), eq(staffProfiles.entityId, input.entityId))).limit(1); if (!profile) throw new Error("Staff member is not available in this entity");
    if (input.issuedAt != null && input.expiresAt != null && input.expiresAt <= input.issuedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Renewal or expiry date must be after the issue or completion date. Correct the date before saving.", cause: { field: "expiresAt", overrideAvailable: false } });
    const [evidence] = input.evidenceDocumentId ? await db.select({ id: documents.id, status: documents.status, classification: documents.classification }).from(documents).where(and(eq(documents.id, input.evidenceDocumentId), eq(documents.entityId, input.entityId))).limit(1) : [];
    if (input.evidenceDocumentId && !evidence) throw new Error("Selected certificate evidence is not available in this entity"); if (evidence && evidence.classification !== "hr") throw new Error("Staff certificate evidence must use the HR classification"); if (evidence && evidence.status !== "approved") throw new Error("Staff certificate evidence must be approved before it can validate this record");
    const [template] = input.templateId ? await db.select().from(documentTemplates).where(eq(documentTemplates.id, input.templateId)).limit(1) : [];
    if (template && (template.entityId !== input.entityId || template.category !== "supervision" || template.status !== "active")) throw new Error("Selected supervision template is not available");
    const { templateId: _templateId, ...record } = input; const notes = input.notes || template?.bodyTemplate; const renewal = renewalBand(input.expiresAt); const status = input.evidenceDocumentId ? renewal.band === "overdue" ? "expired" : ["one_month", "two_months", "three_months"].includes(renewal.band) ? "expiring" : "valid" : "pending";
    const [result] = await db.insert(workforceChecks).values({ ...record, notes, status, verifiedAt: input.evidenceDocumentId ? Date.now() : undefined, verifiedBy: input.evidenceDocumentId ? ctx.user.id : undefined, createdBy: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "staff_check.create", resourceType: "workforce_check", resourceId: result.id, sensitivity: "hr", result: "success", metadata: { checkType: input.checkType, templateId: template?.id ?? null, templateVersion: template?.version ?? null } });
    return { id: result.id };
  }),

  updateCheck: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(), id: z.number().int().positive(), status: z.enum(["missing", "pending", "valid", "expiring", "expired", "rejected", "not_applicable"]),
    reference: z.string().max(160).optional(), level: z.enum(STAFF_COMPLIANCE_CATEGORIES).optional(), issuedAt: z.number().int().optional(), expiresAt: z.number().int().optional(), evidenceDocumentId: z.number().int().positive().optional(), notes: z.string().max(2000).optional(),
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "staff.sensitive");
    const db = await requireDb();
    if (input.issuedAt != null && input.expiresAt != null && input.expiresAt <= input.issuedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Renewal or expiry date must be after the issue or completion date. Correct the date before saving.", cause: { field: "expiresAt", overrideAvailable: false } });
    const [evidence] = input.evidenceDocumentId ? await db.select({ id: documents.id, status: documents.status, classification: documents.classification }).from(documents).where(and(eq(documents.id, input.evidenceDocumentId), eq(documents.entityId, input.entityId))).limit(1) : []; if (input.evidenceDocumentId && (!evidence || evidence.classification !== "hr" || evidence.status !== "approved")) throw new Error("Select an approved HR-classified certificate document");
    const { id, entityId, ...changes } = input;
    await db.update(workforceChecks).set({ ...changes, verifiedAt: ["valid", "expiring"].includes(changes.status) ? Date.now() : undefined, verifiedBy: ["valid", "expiring"].includes(changes.status) ? ctx.user.id : undefined }).where(and(eq(workforceChecks.id, id), eq(workforceChecks.entityId, entityId)));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId, action: "staff_check.update", resourceType: "workforce_check", resourceId: id, sensitivity: "hr", result: "success", metadata: { status: changes.status } });
    return { success: true };
  }),
});
