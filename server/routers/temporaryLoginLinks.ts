import { and, desc, eq, exists, gt, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { entityMemberships, localAuthCredentials, temporaryLoginLinks, users } from "../../drizzle/schema";
import { assertEntityCapability } from "../authz";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { writeAuditEvent } from "../services/audit";
import { issueLocalSession } from "../services/localSession";
import {
  createTemporaryLoginToken,
  isTemporaryLoginLinkUsable,
  MAX_TEMPORARY_LOGIN_LINK_DAYS,
  MIN_TEMPORARY_LOGIN_LINK_DAYS,
  temporaryLoginLinkUnavailableReason,
  temporaryLoginLinkExpiresAt,
} from "../services/temporaryLoginLinks";
import { hashSecureToken } from "../services/security";
import { requireDb } from "./shared";

const linkInput = z.object({
  entityId: z.number().int().positive(),
  targetUserId: z.number().int().positive(),
  expiresInDays: z.number().int().min(MIN_TEMPORARY_LOGIN_LINK_DAYS).max(MAX_TEMPORARY_LOGIN_LINK_DAYS),
  reason: z.string().trim().min(20).max(1_200),
});

const unavailableMessage = "This temporary sign-in link is unavailable. Ask your company administrator for a new link.";

function affectedRows(result: unknown) {
  const candidate = result as { affectedRows?: number } | [{ affectedRows?: number }?];
  if (Array.isArray(candidate)) return Number(candidate[0]?.affectedRows ?? 0);
  return Number(candidate?.affectedRows ?? 0);
}

function activeMembershipConditions(userId: number, entityId: number, now: number) {
  return and(
    eq(entityMemberships.userId, userId),
    eq(entityMemberships.entityId, entityId),
    eq(entityMemberships.status, "active"),
    or(isNull(entityMemberships.startsAt), lte(entityMemberships.startsAt, now)),
    or(isNull(entityMemberships.endsAt), gt(entityMemberships.endsAt, now)),
  );
}

export const temporaryLoginLinksRouter = router({
  list: protectedProcedure
    .input(z.object({ entityId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
      const db = await requireDb();
      return db
        .select({
          id: temporaryLoginLinks.id,
          targetUserId: temporaryLoginLinks.targetUserId,
          recipientName: users.name,
          recipientEmail: users.email,
          expiresAt: temporaryLoginLinks.expiresAt,
          redeemedAt: temporaryLoginLinks.redeemedAt,
          revokedAt: temporaryLoginLinks.revokedAt,
          createdAt: temporaryLoginLinks.createdAt,
        })
        .from(temporaryLoginLinks)
        .innerJoin(users, eq(users.id, temporaryLoginLinks.targetUserId))
        .where(eq(temporaryLoginLinks.entityId, input.entityId))
        .orderBy(desc(temporaryLoginLinks.createdAt));
    }),

  issue: protectedProcedure.input(linkInput).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const db = await requireDb();
    const now = Date.now();
    const [[target], [membership], [credential]] = await Promise.all([
      db.select({ id: users.id, accountStatus: users.accountStatus }).from(users).where(eq(users.id, input.targetUserId)).limit(1),
      db.select({ id: entityMemberships.id }).from(entityMemberships).where(activeMembershipConditions(input.targetUserId, input.entityId, now)).limit(1),
      db.select({ id: localAuthCredentials.id, lockedUntil: localAuthCredentials.lockedUntil }).from(localAuthCredentials).where(eq(localAuthCredentials.userId, input.targetUserId)).limit(1),
    ]);

    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "The selected account is not available." });
    if (target.accountStatus !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "The selected account is not active. Reactivate it before issuing temporary access." });
    if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "The selected account does not have active access to this company." });
    if (!credential) throw new TRPCError({ code: "BAD_REQUEST", message: "The selected account does not have local sign-in credentials. Issue approved local credentials first." });
    if (credential.lockedUntil && credential.lockedUntil > now) throw new TRPCError({ code: "FORBIDDEN", message: "The selected account is temporarily locked. Use the normal recovery process before issuing temporary access." });

    const token = createTemporaryLoginToken();
    const tokenHash = hashSecureToken(token);
    const expiresAt = temporaryLoginLinkExpiresAt(input.expiresInDays, now);
    const created = await db.transaction(async tx => {
      const superseded = await tx
        .update(temporaryLoginLinks)
        .set({ revokedAt: now })
        .where(and(
          eq(temporaryLoginLinks.entityId, input.entityId),
          eq(temporaryLoginLinks.targetUserId, input.targetUserId),
          isNull(temporaryLoginLinks.revokedAt),
          isNull(temporaryLoginLinks.redeemedAt),
          gt(temporaryLoginLinks.expiresAt, now),
        ));
      const [link] = await tx.insert(temporaryLoginLinks).values({
        entityId: input.entityId,
        targetUserId: input.targetUserId,
        tokenHash,
        expiresAt,
        createdBy: ctx.user.id,
      }).$returningId();
      return { id: link.id, supersededCount: affectedRows(superseded) };
    });

    await writeAuditEvent({
      actorUserId: ctx.user.id,
      entityId: input.entityId,
      action: "temporary_login_link.issued",
      resourceType: "temporary_login_link",
      resourceId: created.id,
      sensitivity: "restricted",
      result: "success",
      reasonCode: "company_admin_existing_account_access",
      metadata: {
        targetUserId: input.targetUserId,
        expiresAt,
        expiresInDays: input.expiresInDays,
        reason: input.reason,
        supersededActiveLinks: created.supersededCount,
      },
    });

    return { id: created.id, token, expiresAt };
  }),

  revoke: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(),
    id: z.number().int().positive(),
    reason: z.string().trim().min(20).max(1_200),
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const db = await requireDb();
    const [link] = await db.select({
      id: temporaryLoginLinks.id,
      targetUserId: temporaryLoginLinks.targetUserId,
      revokedAt: temporaryLoginLinks.revokedAt,
      redeemedAt: temporaryLoginLinks.redeemedAt,
      expiresAt: temporaryLoginLinks.expiresAt,
    }).from(temporaryLoginLinks).where(and(
      eq(temporaryLoginLinks.id, input.id),
      eq(temporaryLoginLinks.entityId, input.entityId),
    )).limit(1);
    if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "Temporary sign-in link not found." });
    if (link.redeemedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "This link has already been redeemed. Reset the password or suspend the account to revoke its session." });

    const now = Date.now();
    if (!link.revokedAt) {
      await db.update(temporaryLoginLinks).set({ revokedAt: now }).where(and(
        eq(temporaryLoginLinks.id, link.id),
        isNull(temporaryLoginLinks.redeemedAt),
        isNull(temporaryLoginLinks.revokedAt),
      ));
    }
    await writeAuditEvent({
      actorUserId: ctx.user.id,
      entityId: input.entityId,
      action: "temporary_login_link.revoked",
      resourceType: "temporary_login_link",
      resourceId: link.id,
      sensitivity: "restricted",
      result: "success",
      reasonCode: "company_admin_revocation",
      metadata: { targetUserId: link.targetUserId, reason: input.reason, alreadyRevoked: Boolean(link.revokedAt), expiredAtRevocation: link.expiresAt <= now },
    });
    return { success: true };
  }),

  redeem: publicProcedure.input(z.object({ token: z.string().min(32).max(200) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const now = Date.now();
    const tokenHash = hashSecureToken(input.token);
    const outcome = await db.transaction(async tx => {
      const [link] = await tx.select().from(temporaryLoginLinks).where(eq(temporaryLoginLinks.tokenHash, tokenHash)).limit(1);
      if (!link || !isTemporaryLoginLinkUsable(link, now)) {
        return { status: "denied" as const, entityId: link?.entityId, linkId: link?.id, reasonCode: `unavailable_${temporaryLoginLinkUnavailableReason(link, now)}` };
      }

      const [[target], [membership], [credential]] = await Promise.all([
        tx.select().from(users).where(eq(users.id, link.targetUserId)).limit(1),
        tx.select({ id: entityMemberships.id }).from(entityMemberships).where(activeMembershipConditions(link.targetUserId, link.entityId, now)).limit(1),
        tx.select({ passwordVersion: localAuthCredentials.passwordVersion, lockedUntil: localAuthCredentials.lockedUntil, mustChangePassword: localAuthCredentials.mustChangePassword }).from(localAuthCredentials).where(eq(localAuthCredentials.userId, link.targetUserId)).limit(1),
      ]);
      if (!target || target.accountStatus !== "active" || !membership || !credential || (credential.lockedUntil && credential.lockedUntil > now)) {
        return { status: "denied" as const, entityId: link.entityId, linkId: link.id, reasonCode: "recipient_not_eligible" };
      }

      const consumed = await tx.update(temporaryLoginLinks).set({ redeemedAt: now }).where(and(
        eq(temporaryLoginLinks.id, link.id),
        eq(temporaryLoginLinks.tokenHash, tokenHash),
        isNull(temporaryLoginLinks.revokedAt),
        isNull(temporaryLoginLinks.redeemedAt),
        gt(temporaryLoginLinks.expiresAt, now),
        exists(tx.select({ id: users.id }).from(users).where(and(
          eq(users.id, temporaryLoginLinks.targetUserId),
          eq(users.accountStatus, "active"),
        ))),
        exists(tx.select({ id: entityMemberships.id }).from(entityMemberships).where(activeMembershipConditions(link.targetUserId, link.entityId, now))),
      ));
      if (affectedRows(consumed) !== 1) {
        return { status: "denied" as const, entityId: link.entityId, linkId: link.id, reasonCode: "concurrent_or_unusable" };
      }
      return { status: "allowed" as const, entityId: link.entityId, linkId: link.id, user: target, passwordVersion: credential.passwordVersion, mustChangePassword: Boolean(credential.mustChangePassword) };
    });

    if (outcome.status === "denied") {
      await writeAuditEvent({
        actorType: "secure_link",
        entityId: outcome.entityId,
        action: "temporary_login_link.redeem",
        resourceType: "temporary_login_link",
        resourceId: outcome.linkId,
        sensitivity: "restricted",
        result: "denied",
        reasonCode: outcome.reasonCode,
      });
      throw new TRPCError({ code: "NOT_FOUND", message: unavailableMessage });
    }

    await issueLocalSession(ctx, outcome.user, outcome.passwordVersion);
    await writeAuditEvent({
      actorUserId: outcome.user.id,
      actorType: "secure_link",
      entityId: outcome.entityId,
      action: "temporary_login_link.redeem",
      resourceType: "temporary_login_link",
      resourceId: outcome.linkId,
      sensitivity: "restricted",
      result: "success",
      reasonCode: "one_time_existing_account_session",
      metadata: { mustChangePassword: outcome.mustChangePassword },
    });
    return { success: true, mustChangePassword: outcome.mustChangePassword };
  }),
});
