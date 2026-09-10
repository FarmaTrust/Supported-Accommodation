import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { colleagueInvitationPropertyGrants, colleagueInvitations, entityMemberships, properties } from "../../drizzle/schema";
import { assertEntityCapability } from "../authz";
import { protectedProcedure, router } from "../_core/trpc";
import { writeAuditEvent } from "../services/audit";
import { MANAGEABLE_CAPABILITIES, MANAGEABLE_ROLES, normaliseManagedCapabilities, propertyAssignmentTypeForRole, requireMeaningfulAccessReason } from "../services/rbacRules";
import { normaliseProvisioningEmail } from "../services/colleagueProvisioning";
import { requireDb } from "./shared";

const invitationRoles = MANAGEABLE_ROLES.filter(role => role !== "owner") as ["registered_manager", "support_worker", "hr_compliance", "finance", "read_only", ...Array<"registered_manager" | "support_worker" | "hr_compliance" | "finance" | "read_only">];
const roleSchema = z.enum(invitationRoles);
const capabilitySchema = z.enum(MANAGEABLE_CAPABILITIES);

export const colleagueInvitationsRouter = router({
  list: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const db = await requireDb();
    const invitations = await db.select().from(colleagueInvitations).where(eq(colleagueInvitations.entityId, input.entityId)).orderBy(desc(colleagueInvitations.createdAt));
    const ids = invitations.map(item => item.id);
    const grants = ids.length ? await db.select({ invitationId: colleagueInvitationPropertyGrants.invitationId, propertyId: colleagueInvitationPropertyGrants.propertyId, propertyName: properties.name, addressLine1: properties.addressLine1 }).from(colleagueInvitationPropertyGrants).innerJoin(properties, eq(properties.id, colleagueInvitationPropertyGrants.propertyId)).where(inArray(colleagueInvitationPropertyGrants.invitationId, ids)) : [];
    const grantsByInvitation = new Map<number, typeof grants>();
    for (const grant of grants) grantsByInvitation.set(grant.invitationId, [...(grantsByInvitation.get(grant.invitationId) ?? []), grant]);
    const now = Date.now();
    return invitations.map(invitation => ({ ...invitation, effectiveStatus: invitation.status === "pending" && invitation.expiresAt <= now ? "expired" : invitation.status, propertyGrants: grantsByInvitation.get(invitation.id) ?? [] }));
  }),

  create: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(),
    email: z.string().trim().email().max(320),
    role: roleSchema,
    allProperties: z.boolean(),
    propertyIds: z.array(z.number().int().positive()).max(250),
    extraCapabilities: z.array(capabilitySchema).max(MANAGEABLE_CAPABILITIES.length),
    expiresInDays: z.number().int().min(1).max(30).default(14),
    reason: z.string().trim().min(20).max(1200),
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const db = await requireDb();
    const emailNormalized = normaliseProvisioningEmail(input.email);
    const propertyIds = input.allProperties ? [] : Array.from(new Set(input.propertyIds)).sort((a, b) => a - b);
    if (!input.allProperties && !propertyIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Select at least one property or grant access to all company properties." });
    const reason = requireMeaningfulAccessReason(input.reason);
    const expiresAt = Date.now() + input.expiresInDays * 86_400_000;
    const extras = normaliseManagedCapabilities(input.extraCapabilities);
    const result = await db.transaction(async tx => {
      const existingPending = await tx.select({ id: colleagueInvitations.id }).from(colleagueInvitations).where(and(eq(colleagueInvitations.entityId, input.entityId), eq(colleagueInvitations.emailNormalized, emailNormalized), eq(colleagueInvitations.status, "pending"), gt(colleagueInvitations.expiresAt, Date.now()))).limit(1);
      if (existingPending.length) throw new TRPCError({ code: "CONFLICT", message: "This colleague already has a pending invitation for this company. Revoke it first or wait for it to expire." });
      if (propertyIds.length) {
        const valid = await tx.select({ id: properties.id }).from(properties).where(and(eq(properties.entityId, input.entityId), inArray(properties.id, propertyIds)));
        if (valid.length !== propertyIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "One or more selected properties do not belong to this company." });
      }
      const [created] = await tx.insert(colleagueInvitations).values({ entityId: input.entityId, email: input.email.trim(), emailNormalized, operationalRole: input.role, allProperties: input.allProperties ? 1 : 0, extraCapabilities: extras, expiresAt, createdBy: ctx.user.id }).$returningId();
      if (propertyIds.length) await tx.insert(colleagueInvitationPropertyGrants).values(propertyIds.map(propertyId => ({ invitationId: created.id, propertyId })));
      return { id: created.id, propertyIds };
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "colleague_invitation.create", resourceType: "colleague_invitation", resourceId: result.id, sensitivity: "restricted", result: "success", reasonCode: "preauthorised_provider_signin", metadata: { emailDomain: emailNormalized.split("@")[1] ?? null, role: input.role, allProperties: input.allProperties, propertyIds: result.propertyIds, extraCapabilities: extras, expiresAt, reason } });
    return { id: result.id, expiresAt };
  }),

  revoke: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), id: z.number().int().positive(), reason: z.string().trim().min(20).max(1200) })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const db = await requireDb();
    const [invitation] = await db.select({ id: colleagueInvitations.id, status: colleagueInvitations.status, emailNormalized: colleagueInvitations.emailNormalized }).from(colleagueInvitations).where(and(eq(colleagueInvitations.id, input.id), eq(colleagueInvitations.entityId, input.entityId))).limit(1);
    if (!invitation) throw new TRPCError({ code: "NOT_FOUND", message: "Colleague invitation not found." });
    const reason = requireMeaningfulAccessReason(input.reason);
    if (invitation.status === "pending") await db.update(colleagueInvitations).set({ status: "revoked", revokedAt: Date.now() }).where(eq(colleagueInvitations.id, invitation.id));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "colleague_invitation.revoke", resourceType: "colleague_invitation", resourceId: invitation.id, sensitivity: "restricted", result: "success", metadata: { emailDomain: invitation.emailNormalized.split("@")[1] ?? null, alreadyFinal: invitation.status !== "pending", reason } });
    return { success: true };
  }),
});
