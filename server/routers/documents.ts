import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { documentTemplates, documents, entities, feeSchedules, localAuthorities, properties, providerPacks, secureLinks } from "../../drizzle/schema";
import { assertEntityCapability } from "../authz";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { writeAuditEvent } from "../services/audit";
import { requireDb } from "./shared";
import { hashSecureToken, isSecureLinkUsable } from "../services/security";
import { decryptSensitive } from "../services/crypto";

export const documentsRouter = router({
  resolveSecureLink: publicProcedure.input(z.object({ token: z.string().min(32).max(200) })).query(async ({ input }) => {
    const db = await requireDb();
    const tokenHash = hashSecureToken(input.token);
    const result = await db.transaction(async tx => {
      const [link] = await tx.select().from(secureLinks).where(eq(secureLinks.tokenHash, tokenHash)).limit(1);
      if (!link || !isSecureLinkUsable(link)) throw new TRPCError({ code: "NOT_FOUND", message: "This secure link is invalid, expired, revoked or has reached its view limit" });
      if (!link.providerPackId) throw new TRPCError({ code: "NOT_FOUND", message: "Shared pack is unavailable" });
      const [pack] = await tx.select().from(providerPacks).where(eq(providerPacks.id, link.providerPackId)).limit(1);
      if (!pack || !["ready", "shared"].includes(pack.status)) throw new TRPCError({ code: "NOT_FOUND", message: "Shared pack is unavailable" });
      await tx.update(secureLinks).set({ viewCount: link.viewCount + 1, lastViewedAt: Date.now() }).where(eq(secureLinks.id, link.id));
      await tx.update(providerPacks).set({ status: "shared" }).where(eq(providerPacks.id, pack.id));
      return { link, pack };
    });
    await writeAuditEvent({ actorType: "secure_link", entityId: result.pack.entityId, propertyId: result.pack.propertyId ?? undefined, action: "provider_pack.external_view", resourceType: "provider_pack", resourceId: result.pack.id, sensitivity: result.pack.includeBankDetails ? "bank" : "general", result: "allowed", metadata: { secureLinkId: result.link.id, viewNumber: result.link.viewCount + 1 } });
    return { title: result.pack.title, snapshot: result.pack.snapshot, expiresAt: result.link.expiresAt };
  }),

  list: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "document.read");
    const db = await requireDb();
    return db.select().from(documents).where(eq(documents.entityId, input.entityId)).orderBy(desc(documents.updatedAt));
  }),

  createMetadata: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(), propertyId: z.number().int().positive().optional(), folderId: z.number().int().positive().optional(), title: z.string().min(3).max(240),
    documentType: z.enum(["policy", "template", "certificate", "contract", "plan", "evidence", "generated", "other"]),
    classification: z.enum(["general", "hr", "finance", "safeguarding", "bank", "restricted"]), reviewDueAt: z.number().int().optional(), retentionUntil: z.number().int().optional(), retentionBasis: z.string().max(220).optional(), legalHold: z.boolean().default(false),
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "document.write");
    const db = await requireDb();
    const [result] = await db.insert(documents).values({ ...input, legalHold: input.legalHold ? 1 : 0, createdBy: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: "document.create", resourceType: "document", resourceId: result.id, sensitivity: input.classification, result: "success" });
    return { id: result.id };
  }),

  packs: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "pack.read");
    const db = await requireDb();
    return db.select().from(providerPacks).where(eq(providerPacks.entityId, input.entityId)).orderBy(desc(providerPacks.updatedAt));
  }),

  createPack: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), propertyId: z.number().int().positive().optional(), localAuthorityId: z.number().int().positive().optional(), templateId: z.number().int().positive().optional(), title: z.string().min(3).max(240), includeBankDetails: z.boolean().default(false) })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "pack.write");
    if (input.includeBankDetails) await assertEntityCapability(ctx.user.id, input.entityId, "finance.read");
    const db = await requireDb();
    const [entity] = await db.select().from(entities).where(eq(entities.id, input.entityId)).limit(1);
    const [property] = input.propertyId ? await db.select().from(properties).where(and(eq(properties.id, input.propertyId), eq(properties.entityId, input.entityId))).limit(1) : [];
    const [authority] = input.localAuthorityId ? await db.select().from(localAuthorities).where(and(eq(localAuthorities.id, input.localAuthorityId), eq(localAuthorities.entityId, input.entityId))).limit(1) : [];
    const [template] = input.templateId ? await db.select().from(documentTemplates).where(and(eq(documentTemplates.id, input.templateId), eq(documentTemplates.entityId, input.entityId), eq(documentTemplates.category, "provider_pack"), eq(documentTemplates.status, "active"))).limit(1) : [];
    const availableFees = await db.select().from(feeSchedules).where(and(eq(feeSchedules.entityId, input.entityId), eq(feeSchedules.status, "active")));
    const fee = availableFees.filter(item => (!item.propertyId || item.propertyId === input.propertyId) && (!item.localAuthorityId || item.localAuthorityId === input.localAuthorityId)).sort((a, b) => Number(Boolean(b.propertyId)) + Number(Boolean(b.localAuthorityId)) - Number(Boolean(a.propertyId)) - Number(Boolean(a.localAuthorityId)))[0];
    if (!entity) throw new Error("Entity not found");
    const sortCode = input.includeBankDetails ? decryptSensitive(entity.bankSortCodeCiphertext) : null;
    const accountNumber = input.includeBankDetails ? decryptSensitive(entity.bankAccountNumberCiphertext) : null;
    const templateValues: Record<string, string> = { "entity.name": entity.name, "entity.legalName": entity.legalName, "entity.ofstedUrn": entity.ofstedUrn ?? "", "entity.companyNumber": entity.companyNumber ?? "", "property.name": property?.name ?? "", "property.address": property ? [property.addressLine1, property.addressLine2, property.city, property.postcode].filter(Boolean).join(", ") : "", "property.vacancy": property ? String(Math.max(0, property.capacity - property.occupiedBeds)) : "", "authority.name": authority?.name ?? "", "fee.rate": fee?.rate ?? "", "fee.billingUnit": fee?.billingUnit ?? "" };
    const renderedTemplate = template?.bodyTemplate.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, key: string) => templateValues[key] ?? `{{${key}}}`) ?? null;
    const snapshot = {
      generatedAt: Date.now(), entity: { name: entity.name, legalName: entity.legalName, companyNumber: entity.companyNumber, ofstedUrn: entity.ofstedUrn, email: entity.email, phone: entity.phone, address: [entity.addressLine1, entity.addressLine2, entity.city, entity.postcode].filter(Boolean).join(", ") },
      property: property ? { name: property.name, address: [property.addressLine1, property.addressLine2, property.city, property.postcode].filter(Boolean).join(", "), accommodationType: property.accommodationType, capacity: property.capacity, ofstedSettingReference: property.ofstedSettingReference, vacancy: Math.max(0, property.capacity - property.occupiedBeds) } : null,
      authority: authority ? { name: authority.name, placementEmail: authority.placementEmail } : null,
      fee: fee ? { name: fee.name, billingUnit: fee.billingUnit, rate: fee.rate, vatRate: fee.vatRate, vatTreatment: fee.vatTreatment, placementType: fee.placementType, contractReference: fee.contractReference, effectiveFrom: fee.effectiveFrom, effectiveTo: fee.effectiveTo } : null,
      bankDetailsIncluded: input.includeBankDetails && Boolean(entity.bankAccountName && accountNumber),
      bankDetails: input.includeBankDetails && entity.bankAccountName && sortCode && accountNumber ? { accountName: entity.bankAccountName, sortCode: sortCode.replace(/(\d{2})(\d{2})(\d{2})/, "$1-$2-$3"), accountNumber } : null,
      template: template ? { id: template.id, title: template.title, version: template.version, renderedBody: renderedTemplate } : null,
    };
    const [result] = await db.insert(providerPacks).values({ ...input, includeBankDetails: input.includeBankDetails ? 1 : 0, snapshot, status: "ready", createdBy: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: "provider_pack.create", resourceType: "provider_pack", resourceId: result.id, sensitivity: input.includeBankDetails ? "bank" : "general", result: "success", metadata: { templateId: template?.id ?? null, templateVersion: template?.version ?? null } });
    return { id: result.id, snapshot };
  }),

  createSecureLink: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), providerPackId: z.number().int().positive(), recipientEmail: z.string().email().optional(), expiresInHours: z.number().int().min(1).max(720).default(72), maxViews: z.number().int().min(1).max(100).default(10) })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "pack.write");
    const db = await requireDb();
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashSecureToken(token);
    const [result] = await db.insert(secureLinks).values({ entityId: input.entityId, providerPackId: input.providerPackId, tokenHash, recipientEmail: input.recipientEmail, expiresAt: Date.now() + input.expiresInHours * 3_600_000, maxViews: input.maxViews, createdBy: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "secure_link.create", resourceType: "secure_link", resourceId: result.id, sensitivity: "restricted", result: "success", metadata: { expiresInHours: input.expiresInHours, maxViews: input.maxViews } });
    return { id: result.id, path: `/share/${token}` };
  }),

  revokeSecureLink: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "pack.write");
    const db = await requireDb();
    await db.update(secureLinks).set({ revokedAt: Date.now() }).where(and(eq(secureLinks.id, input.id), eq(secureLinks.entityId, input.entityId)));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "secure_link.revoke", resourceType: "secure_link", resourceId: input.id, sensitivity: "restricted", result: "success" });
    return { success: true };
  }),
});
