import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import { roles as rolesTable, entityMemberships, localAuthCredentials, properties, propertyAssignments, users } from "../../drizzle/schema";
import { allCapabilities, assertEntityCapability, roleCapabilities, type OperationalRole } from "../authz";
import { protectedProcedure, router } from "../_core/trpc";
import { writeAuditEvent } from "../services/audit";
import {
  capabilityDelta,
  cleanCapabilityList,
  cleanPathList,
  effectiveCapabilities,
  effectivePaths,
  validateCustomRole,
} from "../services/roleDefinitions";
import { createOrReplaceLocalCredential, normaliseLocalEmail, validateLocalPassword } from "../services/localAuth";
import {
  CAPABILITY_LABELS,
  MANAGEABLE_CAPABILITIES,
  MANAGEABLE_ROLES,
  ROLE_LABELS,
  canRemoveOwner,
  normaliseManagedCapabilities,
  propertyAssignmentTypeForRole,
} from "../services/rbacRules";

/** The audit trail always carries a reason field, even when the operator left it blank. */
function optionalReason(reason: string | undefined) {
  return reason?.trim() || "Not given";
}
import { visibleWorkspacePaths } from "../../client/src/lib/roleNavigation";
import { requireDb } from "./shared";
import { builtInRoleId } from "../services/roleResolution";

/** One entry per workspace page, so the client never keeps its own copy of this list. */
const WORKSPACE_PAGES = [
  { path: "/", label: "Overview" },
  { path: "/properties", label: "Properties" },
  { path: "/workforce", label: "Workforce" },
  { path: "/access-control", label: "Access control" },
  { path: "/role-management", label: "Roles & permissions" },
  { path: "/manager-app", label: "RSM App" },
  { path: "/nominated-individual", label: "Nominated Individual App" },
  { path: "/staff", label: "Staff workspace" },
  { path: "/placements", label: "Young people" },
  { path: "/rota", label: "Rota & shifts" },
  { path: "/rota-controls", label: "Rota controls" },
  { path: "/compliance-dashboard", label: "Compliance dashboard" },
  { path: "/compliance", label: "Compliance calendar" },
  { path: "/governance", label: "Governance & outcomes" },
  { path: "/work-plans", label: "Work plans" },
  { path: "/finance", label: "Finance" },
  { path: "/documents", label: "Documents" },
  { path: "/assurance", label: "Assurance" },
  { path: "/quality-reviews", label: "Quality reviews" },
  { path: "/regulation-28", label: "Regulation 28" },
  { path: "/care", label: "Care operations" },
  { path: "/safeguarding", label: "Safeguarding" },
  { path: "/keyworker-app", label: "Key Worker App" },
] as const;

const baseRoleSchema = z.enum(MANAGEABLE_ROLES);
// Optional: an empty reason is recorded as "not given" rather than blocking the change.
const reasonSchema = z.string().trim().max(1200).optional();
const roleDefinitionInput = {
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(600).optional(),
  baseRole: baseRoleSchema,
  grantedCapabilities: z.array(z.string()).max(allCapabilities.length),
  deniedCapabilities: z.array(z.string()).max(allCapabilities.length),
  visiblePaths: z.array(z.string()).max(64).nullable(),
};

/** Shape one stored role for the client, with its resolved effect already worked out. */
function presentRole(row: typeof rolesTable.$inferSelect, memberCount: number) {
  const definition = {
    baseRole: row.baseRole as OperationalRole,
    grantedCapabilities: cleanCapabilityList(row.grantedCapabilities, allCapabilities),
    deniedCapabilities: cleanCapabilityList(row.deniedCapabilities, allCapabilities),
    visiblePaths: cleanPathList(row.visiblePaths),
  };
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    isBuiltIn: row.isBuiltIn === 1,
    isAdminAccount: row.isAdminAccount === 1,
    memberCount,
    /** The widest page list this role may be given; the ceiling lives in code, not the database. */
    availablePaths: visibleWorkspacePaths(row.baseRole as OperationalRole),
    baseCapabilities: Array.from(roleCapabilities[row.baseRole as OperationalRole] ?? []).sort(),
    ...definition,
    effectiveCapabilities: effectiveCapabilities(definition),
    effectivePaths: effectivePaths(definition),
    delta: capabilityDelta(definition),
  };
}

export const roleManagementRouter = router({
  /** Everything the admin screen renders: built-in roles, custom roles, members and the pickers. */
  workspace: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const db = await requireDb();
    const [roleRows, membershipRows, propertyRows, grantRows] = await Promise.all([
      db.select().from(rolesTable)
        .where(or(isNull(rolesTable.entityId), eq(rolesTable.entityId, input.entityId)))
        .orderBy(desc(rolesTable.isBuiltIn), asc(rolesTable.name)),
      db.select({
        userId: entityMemberships.userId,
        role: entityMemberships.operationalRole,
        roleId: entityMemberships.roleId,
        allProperties: entityMemberships.allProperties,
        extraCapabilities: entityMemberships.extraCapabilities,
        status: entityMemberships.status,
        name: users.name,
        email: users.email,
        accountStatus: users.accountStatus,
        credentialUserId: localAuthCredentials.userId,
      }).from(entityMemberships)
        .innerJoin(users, eq(users.id, entityMemberships.userId))
        .leftJoin(localAuthCredentials, eq(localAuthCredentials.userId, users.id))
        .where(eq(entityMemberships.entityId, input.entityId))
        .orderBy(asc(users.name)),
      db.select({ id: properties.id, name: properties.name, addressLine1: properties.addressLine1 })
        .from(properties).where(eq(properties.entityId, input.entityId)).orderBy(asc(properties.name)),
      db.select({ userId: propertyAssignments.userId, propertyId: propertyAssignments.propertyId })
        .from(propertyAssignments).where(eq(propertyAssignments.entityId, input.entityId)),
    ]);

    const memberCountByRole = new Map<number, number>();
    for (const row of membershipRows) {
      if (row.roleId) memberCountByRole.set(row.roleId, (memberCountByRole.get(row.roleId) ?? 0) + 1);
    }
    const propertiesByUser = new Map<number, number[]>();
    for (const grant of grantRows) propertiesByUser.set(grant.userId, [...(propertiesByUser.get(grant.userId) ?? []), grant.propertyId]);

    return {
      roles: roleRows.map(row => presentRole(row, memberCountByRole.get(row.id) ?? 0)),
      /** Every page the workspace has, with the label the sidebar uses. */
      pages: WORKSPACE_PAGES,
      grantableCapabilities: MANAGEABLE_CAPABILITIES.map(value => ({ value, label: CAPABILITY_LABELS[value] })),
      allCapabilities: allCapabilities.map(value => ({ value, label: CAPABILITY_LABELS[value as never] ?? value })),
      properties: propertyRows,
      members: membershipRows.map(row => ({
        userId: row.userId,
        name: row.name,
        email: row.email,
        role: row.role,
        roleId: row.roleId,
        allProperties: row.allProperties === 1,
        extraCapabilities: cleanCapabilityList(row.extraCapabilities, MANAGEABLE_CAPABILITIES),
        propertyIds: propertiesByUser.get(row.userId) ?? [],
        status: row.status,
        accountStatus: row.accountStatus,
        hasLocalCredential: row.credentialUserId !== null,
      })),
    };
  }),

  createRole: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(),
    ...roleDefinitionInput,
    reason: reasonSchema,
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const db = await requireDb();
    const definition = validateCustomRole(input);
    const reason = optionalReason(input.reason);

    const [clash] = await db.select({ id: rolesTable.id }).from(rolesTable)
      .where(and(eq(rolesTable.entityId, input.entityId), eq(rolesTable.slug, definition.slug))).limit(1);
    if (clash) throw new TRPCError({ code: "CONFLICT", message: `A role named "${definition.name}" already exists in this company.` });

    const [created] = await db.insert(rolesTable).values({
      entityId: input.entityId,
      name: definition.name,
      slug: definition.slug,
      description: input.description?.trim() || null,
      baseRole: definition.baseRole,
      grantedCapabilities: definition.grantedCapabilities,
      deniedCapabilities: definition.deniedCapabilities,
      visiblePaths: definition.visiblePaths,
      createdBy: ctx.user.id,
    }).$returningId();

    await writeAuditEvent({
      actorUserId: ctx.user.id, entityId: input.entityId, action: "role_management.role.create",
      resourceType: "custom_role", resourceId: created.id, sensitivity: "restricted", result: "success",
      reasonCode: "custom_role_definition",
      metadata: { name: definition.name, slug: definition.slug, baseRole: definition.baseRole, granted: definition.grantedCapabilities, denied: definition.deniedCapabilities, visiblePaths: definition.visiblePaths, reason },
    });
    return { id: created.id, slug: definition.slug };
  }),

  updateRole: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(),
    id: z.number().int().positive(),
    ...roleDefinitionInput,
    reason: reasonSchema,
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const db = await requireDb();
    const reason = optionalReason(input.reason);

    const [existing] = await db.select().from(rolesTable)
      .where(and(eq(rolesTable.id, input.id), or(isNull(rolesTable.entityId), eq(rolesTable.entityId, input.entityId)))).limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "That role was not found." });

    // A built-in role keeps its slug and base role: those are its identity in server/authz.ts.
    const definition = validateCustomRole({ ...input, builtInSlug: existing.isBuiltIn ? existing.slug : null });

    const [clash] = await db.select({ id: rolesTable.id }).from(rolesTable)
      .where(and(eq(rolesTable.entityId, input.entityId), eq(rolesTable.slug, definition.slug), ne(rolesTable.id, input.id))).limit(1);
    if (clash) throw new TRPCError({ code: "CONFLICT", message: `A different role named "${definition.name}" already exists.` });

    // Holders pick the change up on their next request, because authz reads the role live.
    const holders = await db.select({ userId: entityMemberships.userId }).from(entityMemberships)
      .where(and(eq(entityMemberships.entityId, input.entityId), eq(entityMemberships.roleId, input.id)));

    await db.update(rolesTable).set({
      name: definition.name,
      slug: definition.slug,
      description: input.description?.trim() || null,
      baseRole: definition.baseRole,
      grantedCapabilities: definition.grantedCapabilities,
      deniedCapabilities: definition.deniedCapabilities,
      visiblePaths: definition.visiblePaths,
    }).where(eq(rolesTable.id, input.id));

    // The base role is authoritative on every membership, so a changed base must be written through.
    if (existing.baseRole !== definition.baseRole && holders.length) {
      await db.update(entityMemberships)
        .set({ operationalRole: definition.baseRole as typeof MANAGEABLE_ROLES[number] })
        .where(and(eq(entityMemberships.entityId, input.entityId), eq(entityMemberships.roleId, input.id)));
      await db.update(users)
        .set({ roleId: input.id })
        .where(inArray(users.id, holders.map(holder => holder.userId)));
    }

    await writeAuditEvent({
      actorUserId: ctx.user.id, entityId: input.entityId, action: "role_management.role.update",
      resourceType: "custom_role", resourceId: input.id, sensitivity: "restricted", result: "success",
      reasonCode: "custom_role_definition",
      metadata: {
        previous: { name: existing.name, baseRole: existing.baseRole, granted: existing.grantedCapabilities, denied: existing.deniedCapabilities, visiblePaths: existing.visiblePaths },
        next: { name: definition.name, baseRole: definition.baseRole, granted: definition.grantedCapabilities, denied: definition.deniedCapabilities, visiblePaths: definition.visiblePaths },
        affectedMembers: holders.length, reason,
      },
    });
    return { success: true, affectedMembers: holders.length };
  }),

  archiveRole: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(),
    id: z.number().int().positive(),
    reason: reasonSchema,
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const db = await requireDb();
    const reason = optionalReason(input.reason);
    const [existing] = await db.select().from(rolesTable)
      .where(and(eq(rolesTable.id, input.id), or(isNull(rolesTable.entityId), eq(rolesTable.entityId, input.entityId)))).limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "That role was not found." });
    if (existing.isBuiltIn) throw new TRPCError({ code: "FORBIDDEN", message: "Built-in roles cannot be archived. Edit what they may do instead." });

    const holders = await db.select({ userId: entityMemberships.userId }).from(entityMemberships)
      .where(and(eq(entityMemberships.entityId, input.entityId), eq(entityMemberships.roleId, input.id)));
    if (holders.length) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `${holders.length} member${holders.length === 1 ? " is" : "s are"} still on this role. Move them to another role before archiving it.`,
      });
    }

    await db.update(rolesTable).set({ status: "archived" }).where(eq(rolesTable.id, input.id));
    await writeAuditEvent({
      actorUserId: ctx.user.id, entityId: input.entityId, action: "role_management.role.archive",
      resourceType: "custom_role", resourceId: input.id, sensitivity: "restricted", result: "success",
      reasonCode: "custom_role_definition", metadata: { name: existing.name, reason },
    });
    return { success: true };
  }),

  /** Create the account and its first membership in one step, or re-provision an existing email. */
  createUser: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(),
    email: z.string().trim().email().max(320),
    name: z.string().trim().min(2).max(180),
    roleId: z.number().int().positive().nullable(),
    role: baseRoleSchema,
    allProperties: z.boolean(),
    propertyIds: z.array(z.number().int().positive()).max(250),
    extraCapabilities: z.array(z.enum(MANAGEABLE_CAPABILITIES)).max(MANAGEABLE_CAPABILITIES.length),
    temporaryPassword: z.string().min(1).max(256),
    reason: reasonSchema,
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const db = await requireDb();
    const reason = optionalReason(input.reason);
    const email = normaliseLocalEmail(input.email);

    // Validate the password and the access plan before writing anything, so a rejected
    // request never leaves an account behind with no membership and no way to sign in.
    const passwordIssue = validateLocalPassword(input.temporaryPassword);
    if (passwordIssue) throw new TRPCError({ code: "BAD_REQUEST", message: passwordIssue });
    const plan = await resolveAssignment(db, input);

    const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    let userId = existingUser?.id;
    if (!userId) {
      const [created] = await db.insert(users).values({
        openId: `local_${crypto.randomUUID().replace(/-/g, "")}`,
        name: input.name,
        email,
        loginMethod: "email",
        roleId: plan.roleId ?? await builtInRoleId(plan.role),
        accountStatus: "active",
      }).$returningId();
      userId = created.id;
    } else {
      await db.update(users).set({ name: input.name, loginMethod: "email", accountStatus: "active" }).where(eq(users.id, userId));
    }

    await writeAssignment(db, plan, { userId, actorUserId: ctx.user.id, entityId: input.entityId });
    await createOrReplaceLocalCredential({ userId, email, password: input.temporaryPassword, requireChangeOnNextLogin: true });

    await writeAuditEvent({
      actorUserId: ctx.user.id, entityId: input.entityId, action: "role_management.user.create",
      resourceType: "user", resourceId: userId, sensitivity: "restricted", result: "success",
      reasonCode: "cli_access_change",
      metadata: { targetUserId: userId, created: !existingUser, role: plan.role, roleId: plan.roleId, allProperties: plan.allProperties, propertyIds: plan.propertyIds, extraCapabilities: plan.extras, reason },
    });
    return { userId, created: !existingUser };
  }),

  /** Move an existing member onto a different role, or adjust their scope. */
  assignRole: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(),
    targetUserId: z.number().int().positive(),
    roleId: z.number().int().positive().nullable(),
    role: baseRoleSchema,
    allProperties: z.boolean(),
    propertyIds: z.array(z.number().int().positive()).max(250),
    extraCapabilities: z.array(z.enum(MANAGEABLE_CAPABILITIES)).max(MANAGEABLE_CAPABILITIES.length),
    reason: reasonSchema,
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "config.write");
    const db = await requireDb();
    const reason = optionalReason(input.reason);

    const [membership] = await db.select().from(entityMemberships)
      .where(and(eq(entityMemberships.entityId, input.entityId), eq(entityMemberships.userId, input.targetUserId))).limit(1);
    if (!membership) throw new TRPCError({ code: "NOT_FOUND", message: "That person is not a member of this company yet. Create their account first." });
    if (membership.status !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Reactivate this membership before changing its role." });

    const plan = await resolveAssignment(db, input);

    if (ctx.user.id === input.targetUserId && membership.operationalRole === "owner" && plan.role !== "owner") {
      throw new TRPCError({ code: "FORBIDDEN", message: "You cannot remove your own company administrator role. Ask another administrator to make this change." });
    }
    const activeOwners = await db.select({ id: entityMemberships.id }).from(entityMemberships)
      .where(and(eq(entityMemberships.entityId, input.entityId), eq(entityMemberships.operationalRole, "owner"), eq(entityMemberships.status, "active")));
    if (!canRemoveOwner({ currentRole: membership.operationalRole as OperationalRole, nextRole: plan.role, activeOwnerCount: activeOwners.length })) {
      throw new TRPCError({ code: "CONFLICT", message: "This is the last active company administrator. Assign another administrator first." });
    }

    await writeAssignment(db, plan, { userId: input.targetUserId, actorUserId: ctx.user.id, entityId: input.entityId });
    await writeAuditEvent({
      actorUserId: ctx.user.id, entityId: input.entityId, action: "role_management.user.assign",
      resourceType: "entity_membership", resourceId: membership.id, sensitivity: "restricted", result: "success",
      reasonCode: "company_admin_access_change",
      metadata: {
        targetUserId: input.targetUserId,
        previous: { role: membership.operationalRole, roleId: membership.roleId, allProperties: membership.allProperties === 1 },
        next: { role: plan.role, roleId: plan.roleId, allProperties: plan.allProperties, propertyIds: plan.propertyIds, extraCapabilities: plan.extras },
        reason,
      },
    });
    return { success: true };
  }),
});

type AssignmentPlan = {
  role: OperationalRole;
  roleId: number;
  allProperties: boolean;
  propertyIds: number[];
  extras: string[];
};

/**
 * Turn a request into a normalised plan, rejecting anything invalid before a single row is
 * written. A custom role decides the base role and its grants, so those inputs are ignored
 * when one is chosen — the stored definition stays the single source of truth.
 */
async function resolveAssignment(db: Awaited<ReturnType<typeof requireDb>>, input: {
  entityId: number;
  roleId: number | null;
  role: OperationalRole;
  allProperties: boolean;
  propertyIds: number[];
  extraCapabilities: string[];
}): Promise<AssignmentPlan> {
  let role = input.role;
  let extras = normaliseManagedCapabilities(input.extraCapabilities);

  if (input.roleId) {
    const [selected] = await db.select().from(rolesTable)
      .where(and(
        eq(rolesTable.id, input.roleId),
        or(isNull(rolesTable.entityId), eq(rolesTable.entityId, input.entityId)),
        eq(rolesTable.status, "active"),
      )).limit(1);
    if (!selected) throw new TRPCError({ code: "BAD_REQUEST", message: "Select an active role available to this company." });
    if (selected.baseRole === "platform_admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "The platform administrator role cannot be assigned from this screen." });
    }
    // The role row carries its own capabilities, so per-person extras would be a second,
    // invisible source of truth.
    role = selected.baseRole as OperationalRole;
    extras = [];
  }

  const allProperties = role === "owner" ? true : input.allProperties;
  if (role === "owner") extras = [];
  const propertyIds = allProperties ? [] : Array.from(new Set(input.propertyIds)).sort((a, b) => a - b);
  if (!allProperties && !propertyIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Select at least one property, or grant access to all company properties." });
  }
  if (propertyIds.length) {
    const rows = await db.select({ id: properties.id }).from(properties)
      .where(and(eq(properties.entityId, input.entityId), inArray(properties.id, propertyIds)));
    if (rows.length !== propertyIds.length) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "One or more selected properties do not belong to this company." });
    }
  }
  return { role, roleId: input.roleId ?? await builtInRoleId(role), allProperties, propertyIds, extras };
}

async function writeAssignment(
  db: Awaited<ReturnType<typeof requireDb>>,
  plan: AssignmentPlan,
  context: { userId: number; actorUserId: number; entityId: number },
) {
  await db.transaction(async tx => {
    await tx.insert(entityMemberships).values({
      entityId: context.entityId,
      userId: context.userId,
      operationalRole: plan.role as typeof MANAGEABLE_ROLES[number],
      roleId: plan.roleId,
      allProperties: plan.allProperties ? 1 : 0,
      extraCapabilities: plan.extras,
      status: "active",
      createdBy: context.actorUserId,
    }).onDuplicateKeyUpdate({
      set: {
        operationalRole: plan.role as typeof MANAGEABLE_ROLES[number],
        roleId: plan.roleId,
        allProperties: plan.allProperties ? 1 : 0,
        extraCapabilities: plan.extras,
        status: "active",
        endsAt: null,
      },
    });
    await tx.delete(propertyAssignments)
      .where(and(eq(propertyAssignments.entityId, context.entityId), eq(propertyAssignments.userId, context.userId)));
    if (plan.propertyIds.length) {
      await tx.insert(propertyAssignments).values(plan.propertyIds.map(propertyId => ({
        entityId: context.entityId,
        propertyId,
        userId: context.userId,
        assignmentType: propertyAssignmentTypeForRole(plan.role as never),
        startsAt: Date.now(),
        createdBy: context.actorUserId,
      })));
    }
  });
  // users.roleId is the account's workspace role: the company-defined row when there is one,
  // otherwise the built-in row for the base role.
  await db.update(users)
    .set({ roleId: plan.roleId })
    .where(eq(users.id, context.userId));
}
