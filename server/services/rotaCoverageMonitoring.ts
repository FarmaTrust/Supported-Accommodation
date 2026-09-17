import { and, eq, gt, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { entityMemberships, notifications, properties, propertyAssignments, shifts, users } from "../../drizzle/schema";
import { writeAuditEvent } from "./audit";
import { buildRotaOverview, ROTA_DAY_MS, ROTA_START_HOUR, type RotaOverviewShift } from "./rotaOverview";
import { buildRotaCoverageAlerts } from "./rotaCoverageAlerts";

type Db = NonNullable<Awaited<ReturnType<typeof import("../db").getDb>>>;

export function operationalDayStartUtc(value: number) {
  return Math.floor((value - ROTA_START_HOUR * 60 * 60 * 1_000) / ROTA_DAY_MS) * ROTA_DAY_MS + ROTA_START_HOUR * 60 * 60 * 1_000;
}

/**
 * Evaluates the actual interval coverage of each active authorised property and
 * keeps manager alerts open until the exact gap no longer exists. Notification
 * metadata contains only property and rota timing—not care or resident data.
 */
export async function runRotaCoverageEvaluation(db: Db, input: {
  entityId: number;
  from: number;
  to: number;
  propertyIds?: number[];
  actorUserId?: number;
  actorType?: "user" | "scheduled_job" | "system";
}) {
  const from = operationalDayStartUtc(input.from);
  const to = operationalDayStartUtc(input.to);
  if (to <= from) throw new Error("Coverage evaluation end must be after the start of the selected operational day.");
  if (to - from > 31 * ROTA_DAY_MS) throw new Error("Coverage checks can review up to 31 operational days at once.");

  const propertyRows = await db.select({ id: properties.id, name: properties.name, minimumStaffing: properties.minimumStaffing })
    .from(properties)
    .where(and(
      eq(properties.entityId, input.entityId),
      eq(properties.status, "active"),
      input.propertyIds?.length ? inArray(properties.id, input.propertyIds) : undefined,
    ));
  if (!propertyRows.length) return { evaluatedDays: 0, gapCount: 0, notificationsUpserted: 0, notificationsResolved: 0 };

  const propertyIds = propertyRows.map(property => property.id);
  const rows = await db.select({ shift: shifts, propertyName: properties.name, workerName: users.name })
    .from(shifts)
    .innerJoin(properties, eq(properties.id, shifts.propertyId))
    .leftJoin(users, eq(users.id, shifts.assignedUserId))
    .where(and(
      eq(shifts.entityId, input.entityId),
      inArray(shifts.propertyId, propertyIds),
      lt(shifts.startsAt, to),
      gt(shifts.endsAt, from),
    ));
  const coverageShifts: RotaOverviewShift[] = rows.map(row => ({ ...row.shift, propertyName: row.propertyName, workerName: row.workerName }));
  const gaps = [] as ReturnType<typeof buildRotaOverview>["coverageGaps"];
  for (let rotaDayStart = from; rotaDayStart < to; rotaDayStart += ROTA_DAY_MS) {
    gaps.push(...buildRotaOverview({ rotaDayStart, shifts: coverageShifts, properties: propertyRows }).coverageGaps);
  }

  const managers = await db.select({ userId: entityMemberships.userId, operationalRole: entityMemberships.operationalRole, allProperties: entityMemberships.allProperties })
    .from(entityMemberships)
    .innerJoin(users, eq(users.id, entityMemberships.userId))
    .where(and(
      eq(entityMemberships.entityId, input.entityId),
      eq(entityMemberships.status, "active"),
      inArray(entityMemberships.operationalRole, ["owner", "registered_manager"]),
      eq(users.accountStatus, "active"),
      or(isNull(entityMemberships.startsAt), lte(entityMemberships.startsAt, Date.now())),
      or(isNull(entityMemberships.endsAt), gt(entityMemberships.endsAt, Date.now())),
    ));
  const managerIds = managers.map(manager => manager.userId);
  const grants = managerIds.length ? await db.select({ userId: propertyAssignments.userId, propertyId: propertyAssignments.propertyId })
    .from(propertyAssignments)
    .where(and(
      eq(propertyAssignments.entityId, input.entityId),
      inArray(propertyAssignments.userId, managerIds),
      inArray(propertyAssignments.propertyId, propertyIds),
      eq(propertyAssignments.assignmentType, "manager"),
      or(isNull(propertyAssignments.startsAt), lte(propertyAssignments.startsAt, Date.now())),
      or(isNull(propertyAssignments.endsAt), gt(propertyAssignments.endsAt, Date.now())),
    )) : [];
  const grantedProperties = new Map<number, Set<number>>();
  for (const grant of grants) {
    let assignedProperties = grantedProperties.get(grant.userId);
    if (!assignedProperties) {
      assignedProperties = new Set<number>();
      grantedProperties.set(grant.userId, assignedProperties);
    }
    assignedProperties.add(grant.propertyId);
  }

  const alerts = managers.flatMap(manager => buildRotaCoverageAlerts({
    entityId: input.entityId,
    gaps: gaps.filter(gap => Boolean(manager.allProperties) || grantedProperties.get(manager.userId)?.has(gap.propertyId)),
    recipients: [{ userId: manager.userId, operationalRole: manager.operationalRole as "owner" | "registered_manager" }],
  }));
  const activeKeys = new Set(alerts.map(alert => alert.dedupeKey));
  let notificationsUpserted = 0;
  for (const alert of alerts) {
    await db.insert(notifications).values({
      entityId: input.entityId,
      userId: alert.userId,
      type: "rota_coverage_gap",
      title: alert.title,
      message: alert.message,
      severity: alert.severity,
      resourceType: "rota_coverage_gap",
      resourceId: alert.propertyId,
      deepLink: alert.deepLink,
      dueAt: alert.dueAt,
      acknowledgementRequired: 1,
      escalationDueAt: alert.dueAt + 60 * 60 * 1_000,
      escalationState: Date.now() > alert.dueAt ? "escalated" : "none",
      escalationCount: Date.now() > alert.dueAt ? 1 : 0,
      dedupeKey: alert.dedupeKey,
    }).onDuplicateKeyUpdate({
      set: {
        title: alert.title,
        message: alert.message,
        severity: alert.severity,
        deepLink: alert.deepLink,
        dueAt: alert.dueAt,
        escalationDueAt: alert.dueAt + 60 * 60 * 1_000,
        escalationState: Date.now() > alert.dueAt ? "escalated" : "none",
        escalationCount: Date.now() > alert.dueAt ? 1 : 0,
        resolvedAt: null,
      },
    });
    notificationsUpserted += 1;
  }

  const existing = await db.select({ id: notifications.id, dedupeKey: notifications.dedupeKey })
    .from(notifications)
    .where(and(
      eq(notifications.entityId, input.entityId),
      eq(notifications.type, "rota_coverage_gap"),
      gte(notifications.dueAt, from),
      lt(notifications.dueAt, to),
      isNull(notifications.resolvedAt),
    ));
  const resolved = existing.filter(notification => notification.dedupeKey && !activeKeys.has(notification.dedupeKey));
  for (const notification of resolved) {
    await db.update(notifications).set({ resolvedAt: Date.now(), escalationState: "resolved" }).where(eq(notifications.id, notification.id));
  }

  if (input.actorUserId !== undefined || input.actorType) {
    await writeAuditEvent({
      actorUserId: input.actorUserId,
      actorType: input.actorType ?? "system",
      entityId: input.entityId,
      action: "rota.coverage_evaluate",
      resourceType: "rota_coverage",
      result: "success",
      metadata: { from, to, propertyCount: propertyRows.length, gapCount: gaps.length, notificationsUpserted, notificationsResolved: resolved.length },
    });
  }
  return { evaluatedDays: Math.round((to - from) / ROTA_DAY_MS), gapCount: gaps.length, notificationsUpserted, notificationsResolved: resolved.length };
}
