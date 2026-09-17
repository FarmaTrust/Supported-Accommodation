import { and, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  roles,
  entityMemberships,
  entities,
  properties,
  propertyAssignments,
  users,
  workerAssignments,
  placements,
  shifts,
} from "../drizzle/schema";
import { getDb } from "./db";
import { writeAuditEvent } from "./services/audit";

export type Capability =
  | "entity.read"
  | "entity.write"
  | "property.read"
  | "property.write"
  | "staff.read"
  | "staff.write"
  | "staff.sensitive"
  | "young_person.read"
  | "young_person.write"
  | "shift.read"
  | "shift.write"
  | "compliance.read"
  | "compliance.write"
  | "document.read"
  | "document.write"
  | "incident.read"
  | "incident.write"
  | "incident.review"
  | "frontline.write"
  | "medication.write"
  | "resident_finance.write"
  | "staff.self_service"
  | "supervision.read"
  | "finance.read"
  | "finance.write"
  | "finance.issue"
  | "pack.read"
  | "pack.write"
  | "audit.read"
  | "data_rights.read"
  | "data_rights.write"
  | "analytics.read"
  | "analytics.write"
  | "config.write";

export type OperationalRole =
  | "platform_admin"
  | "owner"
  | "registered_manager"
  | "support_worker"
  | "hr_compliance"
  | "finance"
  | "read_only";

export const allCapabilities: Capability[] = [
  "entity.read", "entity.write", "property.read", "property.write", "staff.read", "staff.write",
  "staff.sensitive", "young_person.read", "young_person.write", "shift.read", "shift.write",
  "compliance.read", "compliance.write", "document.read", "document.write", "incident.read",
  "incident.write", "incident.review", "frontline.write", "medication.write", "resident_finance.write",
  "staff.self_service", "supervision.read", "finance.read", "finance.write", "finance.issue", "pack.read",
  "pack.write", "audit.read", "data_rights.read", "data_rights.write", "analytics.read", "analytics.write", "config.write",
];

export const roleCapabilities: Record<OperationalRole, ReadonlySet<Capability>> = {
  platform_admin: new Set<Capability>(["config.write"]),
  owner: new Set<Capability>(allCapabilities),
  registered_manager: new Set<Capability>([
    "entity.read", "property.read", "property.write", "staff.read", "staff.write", "staff.sensitive",
    "young_person.read", "young_person.write", "shift.read", "shift.write", "compliance.read",
    "compliance.write", "document.read", "document.write", "incident.read", "incident.write",
    "incident.review", "frontline.write", "medication.write", "resident_finance.write", "staff.self_service",
    "supervision.read", "finance.read", "pack.read", "pack.write", "audit.read", "data_rights.read", "data_rights.write", "analytics.read", "analytics.write",
  ]),
  support_worker: new Set<Capability>([
    "property.read", "young_person.read", "young_person.write", "shift.read", "incident.read",
    "incident.write", "frontline.write", "medication.write", "resident_finance.write", "staff.self_service",
    "supervision.read", "compliance.read", "document.read",
  ]),
  hr_compliance: new Set<Capability>([
    "entity.read", "property.read", "staff.read", "staff.write", "staff.sensitive", "shift.read",
    "compliance.read", "compliance.write", "document.read", "document.write", "pack.read", "data_rights.read", "data_rights.write", "analytics.read",
  ]),
  finance: new Set<Capability>([
    "entity.read", "property.read", "finance.read", "finance.write", "finance.issue", "pack.read",
    "pack.write", "document.read",
  ]),
  read_only: new Set<Capability>(["entity.read", "property.read", "staff.read", "shift.read", "compliance.read", "document.read", "finance.read"]),
};

export function roleHasCapability(role: OperationalRole, capability: Capability) {
  return roleCapabilities[role]?.has(capability) ?? false;
}

/**
 * A denial always wins, so an admin-defined role can narrow a base role without any risk of
 * widening it by accident. Grants are still bounded by the managed capability list at write time.
 */
export function entityCapabilityAllowed(role: OperationalRole, capability: Capability, extraCapabilities: string[] = [], deniedCapabilities: string[] = []) {
  if (deniedCapabilities.includes(capability)) return false;
  return roleHasCapability(role, capability) || extraCapabilities.includes(capability);
}
export function propertyScopeAllows(input: { role: OperationalRole; allProperties: boolean; assignedPropertyIds: number[]; propertyId: number }) { return input.role === "owner" || input.allProperties || input.assignedPropertyIds.includes(input.propertyId); }
export function roleRequiresPlacementAssignment(role: OperationalRole) { return role === "support_worker"; }
export function hasActivePlacementAssignment(assignments: Array<{ placementId: number; userId: number; startsAt: number | null; endsAt: number | null }>, placementId: number, userId: number, now = Date.now()) { return assignments.some(item => item.placementId === placementId && item.userId === userId && (item.startsAt === null || item.startsAt <= now) && (item.endsAt === null || item.endsAt > now)); }

async function writePermissionAudit(input: Parameters<typeof writeAuditEvent>[0]) {
  try { await writeAuditEvent(input); }
  catch (error) { console.error("[Authorization] Permission audit write failed", { action: input.action, resourceType: input.resourceType, result: input.result, reasonCode: input.reasonCode, error }); }
}

function mergeStringLists(...lists: Array<unknown>) {
  const merged = new Set<string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) if (typeof item === "string") merged.add(item);
  }
  return Array.from(merged);
}

export async function getUserAccess(userId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row || row.accountStatus !== "active") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Account is not active" });
  }
  // users.roleId is the stored column; callers read the resolved workspace role.
  const { resolveUserRole } = await import("./services/roleResolution");
  const user = (await resolveUserRole(row))!;
  const now = Date.now();
  // An admin-defined role is read live, so editing one applies to every holder immediately
  // rather than needing each membership to be rewritten.
  const rows = await db
    .select({ membership: entityMemberships, customRole: roles })
    .from(entityMemberships)
    .leftJoin(roles, and(eq(roles.id, entityMemberships.roleId), eq(roles.status, "active")))
    .where(
      and(
        eq(entityMemberships.userId, userId),
        eq(entityMemberships.status, "active"),
        or(isNull(entityMemberships.startsAt), lte(entityMemberships.startsAt, now)),
        or(isNull(entityMemberships.endsAt), gt(entityMemberships.endsAt, now)),
      ),
    );
  const memberships = rows.map(row => ({
    ...row.membership,
    customRole: row.customRole,
    /** Managed grants from the membership and from its admin-defined role, merged. */
    grantedCapabilities: mergeStringLists(row.membership.extraCapabilities, row.customRole?.grantedCapabilities),
    deniedCapabilities: mergeStringLists(row.customRole?.deniedCapabilities),
  }));
  return { user, memberships };
}

export async function assertEntityCapability(userId: number, entityId: number, capability: Capability) {
  const { user, memberships } = await getUserAccess(userId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [entity] = await db.select({ id: entities.id }).from(entities).where(eq(entities.id, entityId)).limit(1);
  if (!entity) {
    await writePermissionAudit({ actorUserId: userId, action: "permission.entity", resourceType: "entity", resourceId: entityId, result: "denied", reasonCode: `entity_missing:${capability}`, metadata: { requestedEntityId: entityId } });
    throw new TRPCError({ code: "FORBIDDEN", message: "Entity access denied" });
  }
  const membership = memberships.find(item => item.entityId === entityId);
  if (!membership) {
    await writePermissionAudit({ actorUserId: userId, entityId, action: "permission.entity", resourceType: "entity", resourceId: entityId, result: "denied", reasonCode: `membership_missing:${capability}` });
    throw new TRPCError({ code: "FORBIDDEN", message: "Entity access denied" });
  }
  const role = membership.operationalRole as OperationalRole;
  const extras = membership.grantedCapabilities;
  const denied = membership.deniedCapabilities;
  const roleLabel = membership.customRole ? `${membership.customRole.slug}(${role})` : role;
  if (!entityCapabilityAllowed(role, capability, extras, denied)) {
    await writePermissionAudit({ actorUserId: userId, entityId, action: "permission.entity", resourceType: "entity", resourceId: entityId, result: "denied", reasonCode: `role:${roleLabel}:${capability}` });
    throw new TRPCError({ code: "FORBIDDEN", message: "Action is outside your role" });
  }
  await writePermissionAudit({ actorUserId: userId, entityId, action: "permission.entity", resourceType: "entity", resourceId: entityId, result: "allowed", reasonCode: `role:${roleLabel}:${capability}` });
  return { role, allProperties: membership.allProperties === 1, customRole: membership.customRole };
}

export async function assertPropertyCapability(userId: number, entityId: number, propertyId: number, capability: Capability) {
  const access = await assertEntityCapability(userId, entityId, capability);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  const [property] = await db.select({ id: properties.id }).from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.entityId, entityId))).limit(1);
  if (!property) {
    await writeAuditEvent({ actorUserId: userId, entityId, propertyId, action: "permission.property", resourceType: "property", resourceId: propertyId, result: "denied", reasonCode: `property_missing:${capability}` });
    throw new TRPCError({ code: "NOT_FOUND", message: "Property not found" });
  }
  if (propertyScopeAllows({ role: access.role, allProperties: access.allProperties, assignedPropertyIds: [], propertyId })) {
    await writeAuditEvent({ actorUserId: userId, entityId, propertyId, action: "permission.property", resourceType: "property", resourceId: propertyId, result: "allowed", reasonCode: `${access.role}:all_properties:${capability}` });
    return access;
  }
  const [grant] = await db.select({ id: propertyAssignments.id, propertyId: propertyAssignments.propertyId }).from(propertyAssignments)
    .where(and(eq(propertyAssignments.propertyId, propertyId), eq(propertyAssignments.userId, userId))).limit(1);
  if (!propertyScopeAllows({ role: access.role, allProperties: access.allProperties, assignedPropertyIds: grant ? [grant.propertyId] : [], propertyId })) {
    await writeAuditEvent({ actorUserId: userId, entityId, propertyId, action: "permission.property", resourceType: "property", resourceId: propertyId, result: "denied", reasonCode: `assignment_missing:${capability}` });
    throw new TRPCError({ code: "FORBIDDEN", message: "Property access denied" });
  }
  await writeAuditEvent({ actorUserId: userId, entityId, propertyId, action: "permission.property", resourceType: "property", resourceId: propertyId, result: "allowed", reasonCode: `active_assignment:${capability}` });
  return access;
}

export async function listAccessiblePropertyIds(userId: number, entityId: number, capability: Capability) {
  const access = await assertEntityCapability(userId, entityId, capability);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  if (access.role === "owner" || access.allProperties) {
    const rows = await db.select({ id: properties.id }).from(properties).where(eq(properties.entityId, entityId));
    return rows.map(item => item.id);
  }
  const rows = await db.select({ id: propertyAssignments.propertyId }).from(propertyAssignments)
    .where(and(eq(propertyAssignments.entityId, entityId), eq(propertyAssignments.userId, userId)));
  return rows.map(item => item.id);
}

/**
 * Returns the properties a support worker is working at right now.  This is
 * intentionally narrower than their standing property grants: a grant lets a
 * manager schedule the worker; it does not by itself expose live operational
 * records outside the worker's current shift.
 */
export async function listCurrentShiftPropertyIds(userId: number, entityId: number, capability: Capability, now = Date.now()) {
  const access = await assertEntityCapability(userId, entityId, capability);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  if (access.role !== "support_worker") return listAccessiblePropertyIds(userId, entityId, capability);

  const currentShifts = await db.select({ propertyId: shifts.propertyId }).from(shifts).where(and(
    eq(shifts.entityId, entityId),
    eq(shifts.assignedUserId, userId),
    lte(shifts.startsAt, now),
    gt(shifts.endsAt, now),
    inArray(shifts.status, ["assigned", "confirmed", "in_progress"]),
  ));
  return Array.from(new Set(currentShifts.map(shift => shift.propertyId)));
}

/** Server-authoritative live-shift boundary for frontline property records. */
export async function assertCurrentShiftPropertyCapability(userId: number, entityId: number, propertyId: number, capability: Capability, now = Date.now()) {
  const access = await assertPropertyCapability(userId, entityId, propertyId, capability);
  if (access.role !== "support_worker") return access;

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  const [currentShift] = await db.select({ id: shifts.id }).from(shifts).where(and(
    eq(shifts.entityId, entityId),
    eq(shifts.propertyId, propertyId),
    eq(shifts.assignedUserId, userId),
    lte(shifts.startsAt, now),
    gt(shifts.endsAt, now),
    inArray(shifts.status, ["assigned", "confirmed", "in_progress"]),
  )).limit(1);
  if (currentShift) return access;

  await writePermissionAudit({ actorUserId: userId, entityId, propertyId, action: "permission.property.current_shift", resourceType: "property", resourceId: propertyId, result: "denied", reasonCode: `current_shift_missing:${capability}` });
  throw new TRPCError({ code: "FORBIDDEN", message: "This record is available only while you are on an assigned shift at this property." });
}

/** Applies the live-shift property boundary after the canonical placement check. */
export async function assertCurrentShiftPlacementCapability(userId: number, placementId: number, capability: Capability, now = Date.now()) {
  const result = await assertPlacementCapability(userId, placementId, capability);
  if (result.access.role !== "support_worker") return result;
  if (!result.placement.propertyId) throw new TRPCError({ code: "FORBIDDEN", message: "This placement is not available during your current shift." });
  await assertCurrentShiftPropertyCapability(userId, result.placement.entityId, result.placement.propertyId, capability, now);
  return result;
}

export async function assertPlacementCapability(userId: number, placementId: number, capability: Capability) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  const [placement] = await db.select().from(placements).where(eq(placements.id, placementId)).limit(1);
  if (!placement) throw new TRPCError({ code: "NOT_FOUND", message: "Placement not found" });
  const access = placement.propertyId
    ? await assertPropertyCapability(userId, placement.entityId, placement.propertyId, capability)
    : await assertEntityCapability(userId, placement.entityId, capability);
  if (!roleRequiresPlacementAssignment(access.role)) {
    await writeAuditEvent({ actorUserId: userId, entityId: placement.entityId, propertyId: placement.propertyId ?? undefined, action: "young_person.access", resourceType: "placement", resourceId: placementId, sensitivity: "safeguarding", result: "allowed", reasonCode: `${access.role}:${capability}` });
    return { placement, access };
  }
  const now = Date.now();
  const assignments = await db.select({ placementId: workerAssignments.placementId, userId: workerAssignments.userId, startsAt: workerAssignments.startsAt, endsAt: workerAssignments.endsAt }).from(workerAssignments).where(and(eq(workerAssignments.placementId, placementId), eq(workerAssignments.userId, userId)));
  if (!hasActivePlacementAssignment(assignments, placementId, userId, now)) {
    await writeAuditEvent({ actorUserId: userId, entityId: placement.entityId, propertyId: placement.propertyId ?? undefined, action: "young_person.access", resourceType: "placement", resourceId: placementId, sensitivity: "safeguarding", result: "denied", reasonCode: `assignment_missing:${capability}` });
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not assigned to this young person" });
  }
  await writeAuditEvent({ actorUserId: userId, entityId: placement.entityId, propertyId: placement.propertyId ?? undefined, action: "young_person.access", resourceType: "placement", resourceId: placementId, sensitivity: "safeguarding", result: "allowed", reasonCode: `active_assignment:${capability}` });
  return { placement, access };
}
