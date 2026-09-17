import { randomBytes, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { colleagueInvitations, entities, entityMemberships, localAuthCredentials, users } from "../../drizzle/schema";
import { builtInRoleId } from "../services/roleResolution";
import { assertEntityCapability } from "../authz";
import * as db from "../db";
import { ENV } from "../_core/env";
import { credentialChangeProcedure, protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { writeAuditEvent } from "../services/audit";
import { acceptPendingColleagueInvitations } from "../services/colleagueProvisioning";
import { attemptLocalLogin, createOrReplaceLocalCredential, issueLocalPasswordReset, normaliseLocalEmail, resetLocalPassword, validateLocalPassword } from "../services/localAuth";
import { issueLocalSession } from "../services/localSession";
import { isPasswordResetEmailConfigured, sendPasswordResetEmail } from "../services/resetEmail";
import { isVisibleTestResetEligible, TEST_ENTITY_NAME } from "../services/testResetRules";

const emailInput = z.string().trim().email().max(320);
const passwordInput = z.string().min(1).max(256);
const publicFailure = () => new TRPCError({ code: "UNAUTHORIZED", message: "Unable to sign in with those details. Check the email and password, or contact your administrator." });

function normaliseContactPhone(value: string) {
  const compact = value.trim().replace(/[\s().-]/g, "");
  if (!/^\+?[0-9]{7,20}$/.test(compact)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid phone number using 7 to 20 digits, with an optional leading + country code." });
  }
  return compact;
}

function tokenMatches(actual: string, configured: string) {
  const left = Buffer.from(actual); const right = Buffer.from(configured);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function createVisibleTestResetLink(userId: number, email: string) {
  if (!ENV.appPublicUrl) return null;
  const database = await db.getDb();
  if (!database) return null;
  const [testMembership] = await database
    .select({ id: entityMemberships.id })
    .from(entityMemberships)
    .innerJoin(entities, eq(entities.id, entityMemberships.entityId))
    .where(and(eq(entityMemberships.userId, userId), eq(entityMemberships.status, "active"), eq(entities.name, TEST_ENTITY_NAME)))
    .limit(1);
  const [operationalMembership] = await database
    .select({ id: entityMemberships.id })
    .from(entityMemberships)
    .innerJoin(entities, eq(entities.id, entityMemberships.entityId))
    .where(and(eq(entityMemberships.userId, userId), eq(entityMemberships.status, "active"), ne(entities.name, TEST_ENTITY_NAME)))
    .limit(1);
  if (!isVisibleTestResetEligible({ email, hasActiveTestMembership: Boolean(testMembership), hasActiveOperationalMembership: Boolean(operationalMembership) })) return null;
  const { token, expiresAt } = await issueLocalPasswordReset(userId);
  const url = new URL("/", ENV.appPublicUrl);
  url.searchParams.set("resetToken", token);
  await writeAuditEvent({ actorUserId: userId, action: "auth.local.test_reset_link_displayed", resourceType: "local_auth_credential", resourceId: userId, sensitivity: "restricted", result: "success", reasonCode: "fictional_test_account_only", metadata: { expiresAt } });
  return { url: url.toString(), expiresAt };
}

export const localAuthRouter = router({
  bootstrapStatus: publicProcedure.query(async () => {
    const database = await db.getDb();
    if (!database) return { setupAvailable: false };
    const existingCredentials = await database.select({ id: localAuthCredentials.id }).from(localAuthCredentials).limit(1);
    return { setupAvailable: existingCredentials.length === 0 };
  }),
  login: publicProcedure.input(z.object({ email: emailInput, password: passwordInput })).mutation(async ({ ctx, input }) => {
    const result = await attemptLocalLogin(input);
    if (result.status !== "success") throw publicFailure();
    await acceptPendingColleagueInvitations({ userId: result.user.id, email: result.user.email });
    await issueLocalSession(ctx, result.user, result.passwordVersion);
    await writeAuditEvent({ actorUserId: result.user.id, action: "auth.local.login", resourceType: "session", resourceId: result.user.id, sensitivity: "restricted", result: "success", reasonCode: "email_password_verified" });
    return { success: true, mustChangePassword: result.mustChangePassword };
  }),
  bootstrapOwner: publicProcedure.input(z.object({ email: emailInput, password: passwordInput, bootstrapToken: z.string().min(32).max(512) })).mutation(async ({ ctx, input }) => {
    if (!ENV.localAuthBootstrapToken || !tokenMatches(input.bootstrapToken, ENV.localAuthBootstrapToken)) throw publicFailure();
    const database = await db.getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Authentication service is unavailable. Try again shortly." });
    const existingCredentials = await database.select({ id: localAuthCredentials.id }).from(localAuthCredentials).limit(1);
    // This token establishes the first local credential only. Later password changes must use
    // the authenticated self-service or company-admin paths, which are separately audited.
    if (existingCredentials.length) throw publicFailure();
    const user = await db.getUserByEmail(input.email);
    if (!user || (user.role !== "admin" && user.operationalRole !== "owner")) throw publicFailure();
    const { created, passwordVersion } = await createOrReplaceLocalCredential({ userId: user.id, email: input.email, password: input.password });
    await issueLocalSession(ctx, user, passwordVersion);
    await writeAuditEvent({ actorUserId: user.id, action: "auth.local.owner_bootstrap", resourceType: "local_auth_credential", resourceId: user.id, sensitivity: "restricted", result: "success", reasonCode: created ? "initial_owner_credential" : "owner_credential_rotated" });
    return { success: true };
  }),
  requestPasswordReset: publicProcedure.input(z.object({ email: emailInput })).mutation(async ({ input }) => {
    const user = await db.getUserByEmail(input.email);
    if (user?.email) {
      const testReset = await createVisibleTestResetLink(user.id, user.email);
      if (testReset) {
        return { success: true, emailDeliveryEnabled: false, testingResetUrl: testReset.url, expiresAt: testReset.expiresAt, message: "TEST account only: copy the visible reset link. It expires in one hour and cannot access operational-company records." };
      }
    }
    if (user && user.email && isPasswordResetEmailConfigured()) {
      try {
        const { token } = await issueLocalPasswordReset(user.id);
        const delivery = await sendPasswordResetEmail({ email: user.email, token });
        await writeAuditEvent({ actorUserId: user.id, action: "auth.local.reset_requested", resourceType: "local_auth_credential", resourceId: user.id, sensitivity: "restricted", result: delivery.delivered ? "success" : "failure", reasonCode: delivery.delivered ? "email_reset_link_sent" : delivery.reason });
      } catch {}
    } else if (user) {
      await writeAuditEvent({ actorUserId: user.id, action: "auth.local.reset_requested", resourceType: "local_auth_credential", resourceId: user.id, sensitivity: "restricted", result: "failure", reasonCode: "email_provider_not_configured" });
    }
    const emailDeliveryEnabled = isPasswordResetEmailConfigured();
    return {
      success: true,
      emailDeliveryEnabled,
      testingResetUrl: null,
      message: emailDeliveryEnabled
        ? "If the account is eligible, a password-reset link has been sent. Check your email or contact your company administrator."
        : "Password-reset email is disabled for testing. Contact your company administrator to issue a temporary password.",
    };
  }),
  resetPassword: publicProcedure.input(z.object({ token: z.string().min(32).max(512), password: passwordInput })).mutation(async ({ input }) => {
    const reset = await resetLocalPassword(input);
    if (!reset) throw new TRPCError({ code: "BAD_REQUEST", message: "This password reset link is invalid or has expired." });
    await writeAuditEvent({ actorUserId: reset.userId, action: "auth.local.reset_completed", resourceType: "local_auth_credential", resourceId: reset.userId, sensitivity: "restricted", result: "success", reasonCode: "one_time_reset_consumed" });
    return { success: true };
  }),
  setMyPassword: credentialChangeProcedure.input(z.object({ password: passwordInput })).mutation(async ({ ctx, input }) => {
    if (!ctx.user.email) throw new TRPCError({ code: "BAD_REQUEST", message: "A verified email address is required before setting a local password." });
    const result = await createOrReplaceLocalCredential({ userId: ctx.user.id, email: ctx.user.email, password: input.password, requireChangeOnNextLogin: false });
    await issueLocalSession(ctx, ctx.user, result.passwordVersion);
    await writeAuditEvent({ actorUserId: ctx.user.id, action: "auth.local.password_set", resourceType: "local_auth_credential", resourceId: ctx.user.id, sensitivity: "restricted", result: "success", reasonCode: result.created ? "local_credential_created" : "local_password_changed" });
    return { success: true };
  }),
  captureMyPhone: protectedProcedure.input(z.object({ phone: z.string().trim().min(7).max(60) })).mutation(async ({ ctx, input }) => {
    const phone = normaliseContactPhone(input.phone);
    const database = await db.getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Account details are temporarily unavailable. Please try again." });
    await database.update(users).set({ phone, phoneCapturedAt: Date.now() }).where(eq(users.id, ctx.user.id));
    await writeAuditEvent({ actorUserId: ctx.user.id, action: "user_profile.phone_capture", resourceType: "user", resourceId: ctx.user.id, sensitivity: "restricted", result: "success", metadata: { phoneLength: phone.length, firstCapture: !ctx.user.phoneCapturedAt } });
    return { success: true };
  }),
  adminSetPassword: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), email: emailInput, displayName: z.string().trim().min(2).max(180).optional(), temporaryPassword: passwordInput, reason: z.string().trim().min(12).max(1000) })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const normalizedEmail = normaliseLocalEmail(input.email);
    let user = await db.getUserByEmail(normalizedEmail);
    const database = await db.getDb(); if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const [pending] = await database.select({ id: colleagueInvitations.id }).from(colleagueInvitations).where(and(eq(colleagueInvitations.entityId, input.entityId), eq(colleagueInvitations.emailNormalized, normalizedEmail), eq(colleagueInvitations.status, "pending"))).limit(1);
    const [membershipBefore] = user ? await database.select({ id: entityMemberships.id }).from(entityMemberships).where(and(eq(entityMemberships.entityId, input.entityId), eq(entityMemberships.userId, user.id))).limit(1) : [];
    if (!membershipBefore && !pending) throw new TRPCError({ code: "FORBIDDEN", message: "Create an approved colleague invitation before issuing local credentials." });
    if (!user) {
      const [created] = await database.insert(users).values({ openId: `local_${randomBytes(18).toString("base64url")}`, name: input.displayName ?? normalizedEmail.split("@")[0], email: normalizedEmail, loginMethod: "email_password", roleId: await builtInRoleId("support_worker"), accountStatus: "active" }).$returningId();
      user = (await db.getUserByOpenId((await database.select({ openId: users.openId }).from(users).where(eq(users.id, created.id)).limit(1))[0]!.openId))!;
    }
    const result = await createOrReplaceLocalCredential({ userId: user.id, email: normalizedEmail, password: input.temporaryPassword, requireChangeOnNextLogin: true });
    await acceptPendingColleagueInvitations({ userId: user.id, email: normalizedEmail });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "auth.local.admin_password_set", resourceType: "local_auth_credential", resourceId: user.id, sensitivity: "restricted", result: "success", reasonCode: "authorised_colleague_credential", metadata: { targetUserId: user.id, reason: input.reason, created: result.created } });
    return { success: true };
  }),
  adminCreateReset: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), targetUserId: z.number().int().positive(), reason: z.string().trim().min(12).max(1000) })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const database = await db.getDb(); if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const [membership] = await database.select({ id: entityMemberships.id }).from(entityMemberships).where(and(eq(entityMemberships.entityId, input.entityId), eq(entityMemberships.userId, input.targetUserId), eq(entityMemberships.status, "active"))).limit(1);
    if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "The selected account is not active in this company." });
    const { token, expiresAt } = await issueLocalPasswordReset(input.targetUserId);
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "auth.local.reset_issued", resourceType: "local_auth_credential", resourceId: input.targetUserId, sensitivity: "restricted", result: "success", reasonCode: "company_admin_reset", metadata: { reason: input.reason, expiresAt } });
    return { token, expiresAt };
  }),
});
