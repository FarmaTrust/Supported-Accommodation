import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { entities, guestInvitations, properties } from "../../drizzle/schema";
import { assertEntityCapability } from "../authz";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { writeAuditEvent } from "../services/audit";
import { hashSecureToken, isGuestInvitationUsable } from "../services/security";
import { requireDb } from "./shared";

const invitationInput = z.object({
  entityId: z.number().int().positive(),
  propertyId: z.number().int().positive(),
  recipientLabel: z.string().trim().min(2).max(180).optional(),
  expiresInHours: z.number().int().min(1).max(168).default(72),
  maxUses: z.number().int().min(1).max(10).default(1),
});

const unavailableMessage = "This guest link is unavailable. Ask the organisation that issued it for a new invitation.";

export const guestInvitationsRouter = router({
  list: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const db = await requireDb();
    return db.select({
      id: guestInvitations.id,
      propertyId: guestInvitations.propertyId,
      propertyName: properties.name,
      propertyAddress: properties.addressLine1,
      purpose: guestInvitations.purpose,
      recipientLabel: guestInvitations.recipientLabel,
      expiresAt: guestInvitations.expiresAt,
      maxUses: guestInvitations.maxUses,
      useCount: guestInvitations.useCount,
      revokedAt: guestInvitations.revokedAt,
      lastAccessedAt: guestInvitations.lastAccessedAt,
      createdAt: guestInvitations.createdAt,
    }).from(guestInvitations).innerJoin(properties, eq(properties.id, guestInvitations.propertyId))
      .where(eq(guestInvitations.entityId, input.entityId)).orderBy(desc(guestInvitations.createdAt));
  }),

  create: protectedProcedure.input(invitationInput).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const db = await requireDb();
    const [property] = await db.select({ id: properties.id }).from(properties)
      .where(and(eq(properties.id, input.propertyId), eq(properties.entityId, input.entityId))).limit(1);
    if (!property) throw new TRPCError({ code: "NOT_FOUND", message: "The selected property does not belong to this company." });
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + input.expiresInHours * 3_600_000;
    const [created] = await db.insert(guestInvitations).values({
      entityId: input.entityId,
      propertyId: input.propertyId,
      purpose: "property_summary",
      recipientLabel: input.recipientLabel?.trim() || null,
      tokenHash: hashSecureToken(token),
      expiresAt,
      maxUses: input.maxUses,
      createdBy: ctx.user.id,
    }).$returningId();
    await writeAuditEvent({
      actorUserId: ctx.user.id,
      entityId: input.entityId,
      propertyId: input.propertyId,
      action: "guest_invitation.create",
      resourceType: "guest_invitation",
      resourceId: created.id,
      sensitivity: "restricted",
      result: "success",
      metadata: { purpose: "property_summary", expiresAt, maxUses: input.maxUses, hasRecipientLabel: Boolean(input.recipientLabel?.trim()) },
    });
    return { id: created.id, token, expiresAt, maxUses: input.maxUses };
  }),

  revoke: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const db = await requireDb();
    const [invitation] = await db.select({ id: guestInvitations.id, propertyId: guestInvitations.propertyId, revokedAt: guestInvitations.revokedAt })
      .from(guestInvitations).where(and(eq(guestInvitations.id, input.id), eq(guestInvitations.entityId, input.entityId))).limit(1);
    if (!invitation) throw new TRPCError({ code: "NOT_FOUND", message: "Guest invitation not found." });
    if (!invitation.revokedAt) await db.update(guestInvitations).set({ revokedAt: Date.now() }).where(eq(guestInvitations.id, invitation.id));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: invitation.propertyId, action: "guest_invitation.revoke", resourceType: "guest_invitation", resourceId: invitation.id, sensitivity: "restricted", result: "success", metadata: { alreadyRevoked: Boolean(invitation.revokedAt) } });
    return { success: true };
  }),

  redeem: publicProcedure.input(z.object({ token: z.string().min(32).max(200) })).mutation(async ({ input }) => {
    const db = await requireDb();
    const now = Date.now();
    const tokenHash = hashSecureToken(input.token);
    const outcome = await db.transaction(async tx => {
      const [invitation] = await tx.select().from(guestInvitations).where(eq(guestInvitations.tokenHash, tokenHash)).limit(1);
      if (!invitation || !isGuestInvitationUsable(invitation, now)) return { status: "denied" as const, entityId: invitation?.entityId, propertyId: invitation?.propertyId, reasonCode: "invalid_or_unusable" };
      const updateResult = await tx.update(guestInvitations).set({ useCount: sql`${guestInvitations.useCount} + 1`, lastAccessedAt: now }).where(and(
        eq(guestInvitations.id, invitation.id),
        isNull(guestInvitations.revokedAt),
        gt(guestInvitations.expiresAt, now),
        lt(guestInvitations.useCount, guestInvitations.maxUses),
      ));
      const affectedRows = Number((updateResult as any).affectedRows ?? (updateResult as any)[0]?.affectedRows ?? 0);
      if (affectedRows !== 1) return { status: "denied" as const, entityId: invitation.entityId, propertyId: invitation.propertyId, reasonCode: "concurrent_or_exhausted" };
      const [[entity], [property]] = await Promise.all([
        tx.select({ name: entities.name }).from(entities).where(eq(entities.id, invitation.entityId)).limit(1),
        tx.select({ id: properties.id, name: properties.name, addressLine1: properties.addressLine1, addressLine2: properties.addressLine2, city: properties.city, postcode: properties.postcode, accommodationType: properties.accommodationType, capacity: properties.capacity, status: properties.status }).from(properties).where(and(eq(properties.id, invitation.propertyId), eq(properties.entityId, invitation.entityId))).limit(1),
      ]);
      if (!entity || !property) return { status: "denied" as const, entityId: invitation.entityId, propertyId: invitation.propertyId, reasonCode: "scope_missing" };
      return { status: "allowed" as const, invitationId: invitation.id, entityId: invitation.entityId, propertyId: invitation.propertyId, expiresAt: invitation.expiresAt, remainingUses: Math.max(0, invitation.maxUses - invitation.useCount - 1), entity, property };
    });
    if (outcome.status === "denied") {
      await writeAuditEvent({ actorType: "secure_link", entityId: outcome.entityId, propertyId: outcome.propertyId, action: "guest_invitation.redeem", resourceType: "guest_invitation", sensitivity: "restricted", result: "denied", reasonCode: outcome.reasonCode });
      throw new TRPCError({ code: "NOT_FOUND", message: unavailableMessage });
    }
    await writeAuditEvent({ actorType: "secure_link", entityId: outcome.entityId, propertyId: outcome.propertyId, action: "guest_invitation.redeem", resourceType: "guest_invitation", resourceId: outcome.invitationId, sensitivity: "restricted", result: "allowed", reasonCode: "property_summary_only", metadata: { remainingUses: outcome.remainingUses } });
    return { purpose: "property_summary" as const, expiresAt: outcome.expiresAt, remainingUses: outcome.remainingUses, organisation: { name: outcome.entity.name }, property: outcome.property };
  }),
});
