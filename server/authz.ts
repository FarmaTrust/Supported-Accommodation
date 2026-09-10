import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  entityMemberships,
  entities,
  properties,
  propertyAssignments,
  users,
  workerAssignments,
  placements,
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

const allCapabilities: Capability[] = [
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

export function entityCapabilityAllowed(role: OperationalRole, capability: Capability, extraCapabilities: string[] = []) { return roleHasCapability(role, capability) || extraCapabilities.includes(capability); }
export function propertyScopeAllows(input: { role: OperationalRole; allProperties: boolean; assignedPropertyIds: number[]; propertyId: number }) { return input.role === "owner" || input.allProperties || input.assignedPropertyIds.includes(input.propertyId); }
export function roleRequiresPlacementAssignment(role: OperationalRole) { return role === "support_worker"; }
export function hasActivePlacementAssignment(assignments: Array<{ placementId: number; userId: number; startsAt: number | null; endsAt: number | null }>, placementId: number, userId: number, now = Date.now()) { return assignments.some(item => item.placementId === placementId && item.userId === userId && (item.startsAt === null || item.startsAt <= now) && (item.endsAt === null || item.endsAt > now)); }

async function writePermissionAudit(input: Parameters<typeof writeAuditEvent>[0]) {
  try { await writeAuditEvent(input); }
  catch (error) { console.error("[Authorization] Permission audit write failed", { action: input.action, resourceType: input.resourceType, result: input.result, reasonCode: input.reasonCode, error }); }
}

export async function getUserAccess(userId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.accountStatus !== "active") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Account is not active" });
  }
  const now = Date.now();
  const memberships = await db
    .select()
    .from(entityMemberships)
    .where(
      and(
        eq(entityMemberships.userId, userId),
        eq(entityMemberships.status, "active"),
        or(isNull(entityMemberships.startsAt), lte(entityMemberships.startsAt, now)),
        or(isNull(entityMemberships.endsAt), gt(entityMemberships.endsAt, now)),
      ),
    );
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
  const extras = Array.isArray(membership.extraCapabilities) ? membership.extraCapabilities : [];
  if (!entityCapabilityAllowed(role, capability, extras)) {
    await writePermissionAudit({ actorUserId: userId, entityId, action: "permission.entity", resourceType: "entity", resourceId: entityId, result: "denied", reasonCode: `role:${role}:${capability}` });
    throw new TRPCError({ code: "FORBIDDEN", message: "Action is outside your role" });
  }
  await writePermissionAudit({ actorUserId: userId, entityId, action: "permission.entity", resourceType: "entity", resourceId: entityId, result: "allowed", reasonCode: `role:${role}:${capability}` });
  return { role, allProperties: membership.allProperties === 1 };
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
