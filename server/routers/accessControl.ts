import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { entities, entityMemberships, localAuthCredentials, properties, propertyAssignments, staffProfiles, users } from "../../drizzle/schema";
import { assertEntityCapability, type OperationalRole } from "../authz";
import { protectedProcedure, router } from "../_core/trpc";
import { writeAuditEvent } from "../services/audit";
import { CAPABILITY_LABELS, canRemoveOwner, MANAGEABLE_CAPABILITIES, MANAGEABLE_ROLES, normaliseManagedCapabilities, propertyAssignmentTypeForRole, requireMeaningfulAccessReason, ROLE_LABELS } from "../services/rbacRules";
import { requireDb } from "./shared";

const roleSchema = z.enum(MANAGEABLE_ROLES);
const capabilitySchema = z.enum(MANAGEABLE_CAPABILITIES);

function cleanExtras(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && MANAGEABLE_CAPABILITIES.includes(item as typeof MANAGEABLE_CAPABILITIES[number])) : []; }

export const accessControlRouter = router({
  workspace: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const db = await requireDb();
    const [[entity], membershipRows, propertyRows, grantRows, profileRows] = await Promise.all([
      db.select({ supportContactName: entities.supportContactName, supportEmail: entities.supportEmail, supportPhone: entities.supportPhone, supportGuidance: entities.supportGuidance }).from(entities).where(eq(entities.id, input.entityId)).limit(1),
      db.select({ id: entityMemberships.id, userId: entityMemberships.userId, role: entityMemberships.operationalRole, allProperties: entityMemberships.allProperties, extraCapabilities: entityMemberships.extraCapabilities, status: entityMemberships.status, startsAt: entityMemberships.startsAt, endsAt: entityMemberships.endsAt, updatedAt: entityMemberships.updatedAt, name: users.name, email: users.email, accountStatus: users.accountStatus, localCredentialUserId: localAuthCredentials.userId }).from(entityMemberships).innerJoin(users, eq(users.id, entityMemberships.userId)).leftJoin(localAuthCredentials, eq(localAuthCredentials.userId, users.id)).where(eq(entityMemberships.entityId, input.entityId)).orderBy(asc(users.name)),
      db.select({ id: properties.id, name: properties.name, addressLine1: properties.addressLine1, postcode: properties.postcode, status: properties.status }).from(properties).where(eq(properties.entityId, input.entityId)).orderBy(asc(properties.name)),
      db.select({ userId: propertyAssignments.userId, propertyId: propertyAssignments.propertyId, assignmentType: propertyAssignments.assignmentType }).from(propertyAssignments).where(eq(propertyAssignments.entityId, input.entityId)),
      db.select({ userId: staffProfiles.userId, jobTitle: staffProfiles.jobTitle, staffStatus: staffProfiles.status }).from(staffProfiles).where(eq(staffProfiles.entityId, input.entityId)),
    ]);
    const profileByUser = new Map(profileRows.filter(item => item.userId).map(item => [item.userId!, item]));
    const grantsByUser = new Map<number, Array<{ propertyId: number; assignmentType: string }>>();
    for (const grant of grantRows) grantsByUser.set(grant.userId, [...(grantsByUser.get(grant.userId) ?? []), grant]);
    return {
      roles: MANAGEABLE_ROLES.map(value => ({ value, label: ROLE_LABELS[value] })),
      capabilities: MANAGEABLE_CAPABILITIES.map(value => ({ value, label: CAPABILITY_LABELS[value] })),
      supportContact: entity ?? { supportContactName: null, supportEmail: null, supportPhone: null, supportGuidance: null },
      properties: propertyRows,
      members: membershipRows.map(item => ({ ...item, hasLocalCredential: item.localCredentialUserId !== null, allProperties: item.allProperties === 1, extraCapabilities: cleanExtras(item.extraCapabilities), propertyGrants: grantsByUser.get(item.userId) ?? [], staffProfile: profileByUser.get(item.userId) ?? null })),
    };
  }),

  updateSupportContact: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(),
    supportContactName: z.string().trim().max(180).optional().or(z.literal("")),
    supportEmail: z.string().trim().email().max(320).optional().or(z.literal("")),
    supportPhone: z.string().trim().max(40).optional().or(z.literal("")),
    supportGuidance: z.string().trim().max(1200).optional().or(z.literal("")),
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const db = await requireDb();
    const supportContactName = input.supportContactName?.trim() || null;
    const supportEmail = input.supportEmail?.trim() || null;
    const supportPhone = input.supportPhone?.trim() || null;
    const supportGuidance = input.supportGuidance?.trim() || null;
    if (!supportEmail && !supportPhone) throw new Error("Add at least a support email address or telephone number so users have a clear route for help.");
    await db.update(entities).set({ supportContactName, supportEmail, supportPhone, supportGuidance }).where(eq(entities.id, input.entityId));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "access_control.support_contact.update", resourceType: "entity", resourceId: input.entityId, sensitivity: "restricted", result: "success", metadata: { hasSupportEmail: Boolean(supportEmail), hasSupportPhone: Boolean(supportPhone), hasGuidance: Boolean(supportGuidance) } });
    return { success: true };
  }),

  updateMemberAccess: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(), targetUserId: z.number().int().positive(), role: roleSchema,
    allProperties: z.boolean(), propertyIds: z.array(z.number().int().positive()).max(250),
    extraCapabilities: z.array(capabilitySchema).max(MANAGEABLE_CAPABILITIES.length), reason: z.string().trim().min(20).max(1200),
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const db = await requireDb();
    const [membership] = await db.select().from(entityMemberships).where(and(eq(entityMemberships.entityId, input.entityId), eq(entityMemberships.userId, input.targetUserId))).limit(1);
    if (!membership) throw new Error("This Key Worker is not an active member of the selected company. Add or reactivate their company membership first.");
    if (membership.status !== "active") throw new Error("This member is not active. Reactivate their membership before changing access.");
    if (ctx.user.id === input.targetUserId && membership.operationalRole === "owner" && input.role !== "owner") throw new Error("You cannot remove your own company administrator role. Ask another company administrator to make this change.");
    const activeOwners = await db.select({ id: entityMemberships.id }).from(entityMemberships).where(and(eq(entityMemberships.entityId, input.entityId), eq(entityMemberships.operationalRole, "owner"), eq(entityMemberships.status, "active")));
    if (!canRemoveOwner({ currentRole: membership.operationalRole as OperationalRole, nextRole: input.role, activeOwnerCount: activeOwners.length })) throw new Error("This is the last active company administrator. Assign another active administrator before changing this role.");
    const nextAllProperties = input.role === "owner" ? true : input.allProperties;
    const nextExtras = input.role === "owner" ? [] : normaliseManagedCapabilities(input.extraCapabilities);
    const nextPropertyIds = nextAllProperties ? [] : Array.from(new Set(input.propertyIds)).sort((a, b) => a - b);
    if (!nextAllProperties && !nextPropertyIds.length) throw new Error("Select at least one property or enable access to all company properties.");
    const propertyRows = nextPropertyIds.length ? await db.select({ id: properties.id }).from(properties).where(and(eq(properties.entityId, input.entityId), inArray(properties.id, nextPropertyIds))) : [];
    if (propertyRows.length !== nextPropertyIds.length) throw new Error("One or more selected properties do not belong to this company. Refresh the page and select authorised properties only.");
    const reason = requireMeaningfulAccessReason(input.reason);
    const previous = { role: membership.operationalRole, allProperties: membership.allProperties === 1, extraCapabilities: cleanExtras(membership.extraCapabilities), propertyIds: (await db.select({ propertyId: propertyAssignments.propertyId }).from(propertyAssignments).where(and(eq(propertyAssignments.entityId, input.entityId), eq(propertyAssignments.userId, input.targetUserId)))).map(item => item.propertyId).sort((a, b) => a - b) };
    await db.transaction(async tx => {
      await tx.update(entityMemberships).set({ operationalRole: input.role, allProperties: nextAllProperties ? 1 : 0, extraCapabilities: nextExtras }).where(eq(entityMemberships.id, membership.id));
      await tx.delete(propertyAssignments).where(and(eq(propertyAssignments.entityId, input.entityId), eq(propertyAssignments.userId, input.targetUserId)));
      if (!nextAllProperties) await tx.insert(propertyAssignments).values(nextPropertyIds.map(propertyId => ({ entityId: input.entityId, propertyId, userId: input.targetUserId, assignmentType: propertyAssignmentTypeForRole(input.role), createdBy: ctx.user.id })));
    });
    const next = { role: input.role, allProperties: nextAllProperties, extraCapabilities: nextExtras, propertyIds: nextPropertyIds };
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "access_control.member.update", resourceType: "entity_membership", resourceId: membership.id, sensitivity: "restricted", result: "success", reasonCode: "company_admin_access_change", metadata: { targetUserId: input.targetUserId, reason, previous, next } });
    return { success: true, next };
  }),
});
