import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import {TRPCError} from "@trpc/server";
import { z } from "zod";
import { clockEvents, entityMemberships, handoverAcknowledgements, handoverReviewEvents, handovers, notifications, properties, propertyAssignments, shiftChangeAcknowledgements, shiftChangeEvents, shiftRequests, shifts, staffAvailability, staffProfiles, timesheetEntries, timesheets, users, workforceChecks, workingTimePolicies } from "../../drizzle/schema";
import { assertCurrentShiftPropertyCapability, assertEntityCapability, assertPropertyCapability, getUserAccess, listAccessiblePropertyIds } from "../authz";
import { protectedProcedure, router } from "../_core/trpc";
import { writeAuditEvent } from "../services/audit";
import { calculateDistanceMetres } from "../services/rules";
import {assertValidDateRange} from "../services/inputValidation";
import {evaluateWorkingTime} from "../services/rotaPolicyRules";
import {decryptSensitive,encryptSensitive} from "../services/crypto";
import {isStaleCalendarVersion,requireCalendarOverride} from "../services/rotaCalendarRules";
import { requireDb } from "./shared";
import { requireAttendanceOverride } from "../services/workspaceGuards";
import { assertIncomingHandoverCanBeAcknowledged } from "../services/handoverAcknowledgementRules";
import { pendingShiftStartHandoverReminders } from "../services/handoverShiftStartReminders";
import { dueShiftAttendanceReminders, shiftAttendanceReminderDedupeKey } from "../services/shiftAttendanceReminders";
import { buildRotaOverview, ROTA_DAY_MS, ROTA_START_HOUR } from "../services/rotaOverview";
import { operationalDayStartUtc, runRotaCoverageEvaluation } from "../services/rotaCoverageMonitoring";

type Db = Awaited<ReturnType<typeof requireDb>>;
const SHIFT_BRIEF_TEMPLATES = [
  { code: "nursing_general", label: "Nursing shift handover", fields: ["Clinical observations", "Medication and administration", "Care delivered", "Risks and escalation", "Outstanding actions"] },
  { code: "nursing_night", label: "Night shift handover", fields: ["Night observations", "Sleep and welfare", "Medication and checks", "Incidents or risks", "Morning actions"] },
  { code: "operational", label: "Operational shift handover", fields: ["Shift summary", "People and property updates", "Risks", "Actions due", "Manager escalation"] },
] as const;

async function assertHandoverReviewer(userId: number, entityId: number) {
  const access = await assertEntityCapability(userId, entityId, "shift.write");
  if (!["owner", "registered_manager"].includes(access.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Manager approval is required." });
  return access;
}
async function assignmentWarnings(db: Db, entityId: number, userId: number, candidate: { id?: number; startsAt: number; endsAt: number; requiredRole?: string | null }) {
  const warnings: string[] = []; const assigned = await db.select().from(shifts).where(and(eq(shifts.entityId, entityId), eq(shifts.assignedUserId, userId)));
  for (const other of assigned.filter(item => item.id !== candidate.id && item.status !== "cancelled")) { const overlaps = candidate.startsAt < other.endsAt && candidate.endsAt > other.startsAt; const restBefore = candidate.startsAt >= other.endsAt ? candidate.startsAt - other.endsAt : Number.POSITIVE_INFINITY; const restAfter = other.startsAt >= candidate.endsAt ? other.startsAt - candidate.endsAt : Number.POSITIVE_INFINITY; if (overlaps) warnings.push(`Overlaps shift #${other.id}`); else if (Math.min(restBefore, restAfter) < 11 * 3_600_000) warnings.push(`Less than 11 hours rest around shift #${other.id}`); }
  if (candidate.requiredRole?.trim()) { const [profile] = await db.select({ id: staffProfiles.id }).from(staffProfiles).where(and(eq(staffProfiles.entityId, entityId), eq(staffProfiles.userId, userId))).limit(1); const checks = profile ? await db.select().from(workforceChecks).where(eq(workforceChecks.staffProfileId, profile.id)) : []; const term = candidate.requiredRole.toLowerCase(); const qualified = checks.some(check => ["qualification", "training"].includes(check.checkType) && check.status === "valid" && `${check.title} ${check.level ?? ""}`.toLowerCase().includes(term)); if (!qualified) warnings.push(`No valid qualification or training record matched “${candidate.requiredRole}”`); }
  return warnings;
}

async function schedulabilityWarnings(db:Db,input:{entityId:number;propertyId:number;userId:number;candidate:{id?:number;startsAt:number;endsAt:number;requiredRole?:string|null}}){
  const now=Date.now();
  const[membership]=await db.select().from(entityMemberships).where(and(eq(entityMemberships.entityId,input.entityId),eq(entityMemberships.userId,input.userId),eq(entityMemberships.status,"active"),or(isNull(entityMemberships.startsAt),lte(entityMemberships.startsAt,now)),or(isNull(entityMemberships.endsAt),gt(entityMemberships.endsAt,now)))).limit(1);
  if(!membership||membership.operationalRole!=="support_worker")throw new TRPCError({code:"BAD_REQUEST",message:"Choose an active Key Worker belonging to this entity."});
  if(!membership.allProperties){const[propertyGrant]=await db.select().from(propertyAssignments).where(and(eq(propertyAssignments.entityId,input.entityId),eq(propertyAssignments.propertyId,input.propertyId),eq(propertyAssignments.userId,input.userId),eq(propertyAssignments.assignmentType,"worker"),or(isNull(propertyAssignments.startsAt),lte(propertyAssignments.startsAt,now)),or(isNull(propertyAssignments.endsAt),gt(propertyAssignments.endsAt,now)))).limit(1);if(!propertyGrant)throw new TRPCError({code:"BAD_REQUEST",message:"This Key Worker is not assigned to the selected property. Choose an authorised worker or update their property assignment first."});}
  const warnings=await assignmentWarnings(db,input.entityId,input.userId,input.candidate);
  const[policy]=await db.select().from(workingTimePolicies).where(and(eq(workingTimePolicies.entityId,input.entityId),eq(workingTimePolicies.status,"active"))).orderBy(desc(workingTimePolicies.effectiveFrom)).limit(1);
  if(policy){const all=await db.select().from(shifts).where(and(eq(shifts.entityId,input.entityId),eq(shifts.assignedUserId,input.userId)));const[profile]=await db.select().from(staffProfiles).where(and(eq(staffProfiles.entityId,input.entityId),eq(staffProfiles.userId,input.userId))).limit(1);const availability=profile?await db.select().from(staffAvailability).where(and(eq(staffAvailability.staffProfileId,profile.id),inArray(staffAvailability.status,["active","approved"]))):[];const issues=evaluateWorkingTime({id:input.candidate.id??-1,userId:input.userId,startsAt:input.candidate.startsAt,endsAt:input.candidate.endsAt},all.filter(item=>item.assignedUserId!==null&&item.status!=="cancelled").map(item=>({id:item.id,userId:item.assignedUserId!,startsAt:item.startsAt,endsAt:item.endsAt})),availability.map(item=>({userId:input.userId,startsAt:item.startsAt,endsAt:item.endsAt,availabilityType:item.availabilityType,status:item.status})),{minimumRestHours:Number(policy.minimumRestHours),maximumShiftHours:Number(policy.maximumShiftHours),maximumWeeklyHours:Number(policy.maximumWeeklyHours),maximumNightHours:Number(policy.maximumNightHours),breakAfterHours:Number(policy.breakAfterHours)});warnings.push(...issues.map(issue=>`${issue.severity==="block"?"Block":"Warning"}: ${issue.detail}`));}
  return Array.from(new Set(warnings));
}

async function refreshPropertyCoverage(db: Db, propertyId: number) {
  const [property] = await db.select().from(properties).where(eq(properties.id, propertyId)).limit(1); if (!property) return;
  const rows = await db.select().from(shifts).where(eq(shifts.propertyId, propertyId)); const active = rows.filter(item => item.status !== "cancelled");
  for (const item of active) {
    if (!item.assignedUserId) { await db.update(shifts).set({ coverageState: "uncovered" }).where(eq(shifts.id, item.id)); continue; }
    const concurrent = active.filter(other => other.assignedUserId && item.startsAt < other.endsAt && item.endsAt > other.startsAt).length;
    const warnings = await assignmentWarnings(db, item.entityId, item.assignedUserId, item);
    await db.update(shifts).set({ coverageState: concurrent < property.minimumStaffing || warnings.length ? "at_risk" : "covered" }).where(eq(shifts.id, item.id));
  }
}

export const operationsRouter = router({
  handoverTemplates: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "shift.read");
    return SHIFT_BRIEF_TEMPLATES;
  }),
  shifts: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const propertyIds = await listAccessiblePropertyIds(ctx.user.id, input.entityId, "shift.read");
    if (!propertyIds.length) return [];
    const db = await requireDb();
    const { user, memberships } = await getUserAccess(ctx.user.id);
    const role = user.operationalRole === "owner" ? "owner" : memberships.find(item => item.entityId === input.entityId)?.operationalRole;
    const shiftRows = await db.select().from(shifts).where(and(
      eq(shifts.entityId, input.entityId),
      inArray(shifts.propertyId, propertyIds),
      role === "support_worker" ? eq(shifts.assignedUserId, ctx.user.id) : undefined,
    )).orderBy(asc(shifts.startsAt));
    const activeAssignedShifts = shiftRows.filter(shift => shift.assignedUserId === ctx.user.id && shift.status !== "cancelled" && shift.startsAt <= Date.now() && shift.endsAt >= Date.now());

    const [handoverRows, acknowledgementRows, clockRows] = await Promise.all([
      db.select({ id: handovers.id, entityId: handovers.entityId, propertyId: handovers.propertyId, shiftId: handovers.shiftId, createdBy: handovers.createdBy, createdAt: handovers.createdAt })
        .from(handovers)
        .where(and(eq(handovers.entityId, input.entityId), inArray(handovers.propertyId, propertyIds))),
      db.select({ handoverId: handoverAcknowledgements.handoverId, shiftId: handoverAcknowledgements.shiftId, userId: handoverAcknowledgements.userId })
        .from(handoverAcknowledgements)
        .where(eq(handoverAcknowledgements.userId, ctx.user.id)),
      db.select({ shiftId: clockEvents.shiftId, eventType: clockEvents.eventType })
        .from(clockEvents)
        .where(and(eq(clockEvents.entityId, input.entityId), eq(clockEvents.userId, ctx.user.id))),
    ]);
    const reminders = pendingShiftStartHandoverReminders({ now: Date.now(), userId: ctx.user.id, shifts: activeAssignedShifts, handovers: handoverRows, acknowledgements: acknowledgementRows });
    const existingReminderRows = reminders.length ? await db.select({ dedupeKey: notifications.dedupeKey }).from(notifications)
      .where(and(eq(notifications.userId, ctx.user.id), inArray(notifications.dedupeKey, reminders.map(reminder => reminder.dedupeKey)))) : [];
    const existingReminderKeys = new Set(existingReminderRows.map(row => row.dedupeKey));
    for (const reminder of reminders) {
      await db.insert(notifications).values({
        entityId: reminder.entityId,
        userId: reminder.recipientUserId,
        type: "handover_acknowledgement",
        title: "Incoming handover acknowledgement",
        message: "Read and acknowledge the previous-shift handover before continuing this shift.",
        severity: "warning",
        resourceType: "handover",
        resourceId: reminder.handoverId,
        deepLink: "/keyworker-app",
        dueAt: activeAssignedShifts.find(shift => shift.id === reminder.shiftId)?.startsAt,
        acknowledgementRequired: 1,
        escalationDueAt: Date.now() + 15 * 60_000,
        dedupeKey: reminder.dedupeKey,
      }).onDuplicateKeyUpdate({ set: { dedupeKey: sql`${notifications.dedupeKey}` } });
      if (!existingReminderKeys.has(reminder.dedupeKey)) {
        await writeAuditEvent({ actorType: "system", entityId: reminder.entityId, propertyId: reminder.propertyId, action: "handover.shift_start_reminder", resourceType: "handover", resourceId: reminder.handoverId, sensitivity: "general", result: "success", metadata: { shiftId: reminder.shiftId, recipientUserId: reminder.recipientUserId } });
      }
    }
    const attendanceReminders = dueShiftAttendanceReminders({ now: Date.now(), userId: ctx.user.id, shifts: shiftRows, clockEvents: clockRows });
    for (const reminder of attendanceReminders) {
      await db.insert(notifications).values({
        entityId: reminder.entityId,
        userId: reminder.recipientUserId,
        type: "shift_attendance",
        title: reminder.title,
        message: reminder.message,
        severity: "warning",
        resourceType: "shift",
        resourceId: reminder.shiftId,
        deepLink: "/keyworker-app",
        dueAt: reminder.dueAt,
        acknowledgementRequired: 1,
        dedupeKey: reminder.dedupeKey,
      }).onDuplicateKeyUpdate({ set: { resolvedAt: null, readAt: null } });
    }
    return shiftRows;
  }),

  rotaOverview: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(),
    rotaDayStart: z.number().int().nonnegative().optional(),
    propertyId: z.number().int().positive().optional(),
  })).query(async ({ ctx, input }) => {
    const defaultRotaDayStart = Math.floor((Date.now() - ROTA_START_HOUR * 60 * 60 * 1_000) / ROTA_DAY_MS) * ROTA_DAY_MS + ROTA_START_HOUR * 60 * 60 * 1_000;
    const rotaDayStart = input.rotaDayStart ?? defaultRotaDayStart;
    if (Math.abs(rotaDayStart - Date.now()) > 370 * ROTA_DAY_MS) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an operational rota day within one year of today." });
    const propertyIds = await listAccessiblePropertyIds(ctx.user.id, input.entityId, "shift.read");
    if (!propertyIds.length) return buildRotaOverview({ rotaDayStart, shifts: [], properties: [] });
    if (input.propertyId && !propertyIds.includes(input.propertyId)) throw new TRPCError({ code: "FORBIDDEN", message: "This property is outside your authorised rota scope." });
    const db = await requireDb();
    const { user, memberships } = await getUserAccess(ctx.user.id);
    const role = user.operationalRole === "owner" ? "owner" : memberships.find(item => item.entityId === input.entityId)?.operationalRole;
    const overviewPropertyIds = input.propertyId ? [input.propertyId] : propertyIds;
    const [overviewProperties, rows] = await Promise.all([
      db.select({ id: properties.id, name: properties.name, minimumStaffing: properties.minimumStaffing })
        .from(properties)
        .where(and(eq(properties.entityId, input.entityId), inArray(properties.id, overviewPropertyIds), eq(properties.status, "active"))),
      db.select({ shift: shifts, propertyName: properties.name, workerName: users.name })
      .from(shifts)
      .innerJoin(properties, eq(properties.id, shifts.propertyId))
      .leftJoin(users, eq(users.id, shifts.assignedUserId))
      .where(and(
        eq(shifts.entityId, input.entityId),
        inArray(shifts.propertyId, overviewPropertyIds),
        role === "support_worker" ? eq(shifts.assignedUserId, ctx.user.id) : undefined,
        lte(shifts.startsAt, rotaDayStart + ROTA_DAY_MS - 1),
        gt(shifts.endsAt, rotaDayStart),
      ))
      .orderBy(asc(shifts.startsAt)),
    ]);
    return buildRotaOverview({
      rotaDayStart,
      shifts: rows.map(row => ({ ...row.shift, propertyName: row.propertyName, workerName: row.workerName })),
      // Frontline users can only inspect their own assigned shifts. Do not
      // derive property-wide gaps from that intentionally partial data set.
      properties: role === "support_worker" ? [] : overviewProperties,
    });
  }),

  evaluateRotaCoverage: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(),
    from: z.number().int().nonnegative().optional(),
    to: z.number().int().nonnegative().optional(),
    propertyId: z.number().int().positive().optional(),
  })).mutation(async ({ ctx, input }) => {
    const access = await assertEntityCapability(ctx.user.id, input.entityId, "shift.write");
    if (!['owner', 'registered_manager'].includes(access.role) && ctx.user.operationalRole !== "platform_admin") throw new TRPCError({ code: "FORBIDDEN", message: "Only an Owner or Registered Manager can run coverage alerts." });
    const propertyIds = await listAccessiblePropertyIds(ctx.user.id, input.entityId, "shift.read");
    if (input.propertyId && !propertyIds.includes(input.propertyId)) throw new TRPCError({ code: "FORBIDDEN", message: "This property is outside your authorised rota scope." });
    const from = input.from ?? operationalDayStartUtc(Date.now());
    const to = input.to ?? from + 31 * ROTA_DAY_MS;
    const db = await requireDb();
    try {
      return await runRotaCoverageEvaluation(db, { entityId: input.entityId, from, to, propertyIds: input.propertyId ? [input.propertyId] : propertyIds, actorUserId: ctx.user.id, actorType: "user" });
    } catch (error) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Coverage could not be checked." });
    }
  }),

  calendarWorkers:protectedProcedure.input(z.object({entityId:z.number().int().positive(),propertyId:z.number().int().positive()})).query(async({ctx,input})=>{await assertPropertyCapability(ctx.user.id,input.entityId,input.propertyId,"shift.write");const db=await requireDb();const now=Date.now();const memberships=await db.select({userId:entityMemberships.userId,name:users.name,email:users.email,allProperties:entityMemberships.allProperties}).from(entityMemberships).innerJoin(users,eq(users.id,entityMemberships.userId)).where(and(eq(entityMemberships.entityId,input.entityId),eq(entityMemberships.operationalRole,"support_worker"),eq(entityMemberships.status,"active"),eq(users.accountStatus,"active"),or(isNull(entityMemberships.startsAt),lte(entityMemberships.startsAt,now)),or(isNull(entityMemberships.endsAt),gt(entityMemberships.endsAt,now))));const grants=await db.select({userId:propertyAssignments.userId}).from(propertyAssignments).where(and(eq(propertyAssignments.entityId,input.entityId),eq(propertyAssignments.propertyId,input.propertyId),eq(propertyAssignments.assignmentType,"worker"),or(isNull(propertyAssignments.startsAt),lte(propertyAssignments.startsAt,now)),or(isNull(propertyAssignments.endsAt),gt(propertyAssignments.endsAt,now))));const granted=new Set(grants.map(item=>item.userId));return memberships.filter(item=>Boolean(item.allProperties)||granted.has(item.userId));}),

  availableReplacementStaff: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), propertyId: z.number().int().positive(), startsAt: z.number().int(), endsAt: z.number().int(), requiredRole: z.string().max(120).optional() })).query(async ({ ctx, input }) => {
    assertValidDateRange(input.startsAt, input.endsAt, "Replacement cover");
    await assertPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "shift.write");
    const db = await requireDb(); const now = Date.now();
    const workers = await db.select({ userId: entityMemberships.userId, name: users.name, email: users.email, allProperties: entityMemberships.allProperties })
      .from(entityMemberships).innerJoin(users, eq(users.id, entityMemberships.userId))
      .where(and(eq(entityMemberships.entityId, input.entityId), eq(entityMemberships.operationalRole, "support_worker"), eq(entityMemberships.status, "active"), eq(users.accountStatus, "active"), or(isNull(entityMemberships.startsAt), lte(entityMemberships.startsAt, now)), or(isNull(entityMemberships.endsAt), gt(entityMemberships.endsAt, now))));
    const grants = await db.select({ userId: propertyAssignments.userId }).from(propertyAssignments).where(and(eq(propertyAssignments.entityId, input.entityId), eq(propertyAssignments.propertyId, input.propertyId), eq(propertyAssignments.assignmentType, "worker")));
    const permitted = new Set(grants.map(row => row.userId));
    const candidates = [] as Array<{ id: number; name: string; email: string | null; warnings: string[]; available: boolean }>;
    for (const worker of workers) {
      if (!worker.allProperties && !permitted.has(worker.userId)) continue;
      const warnings = await schedulabilityWarnings(db, { entityId: input.entityId, propertyId: input.propertyId, userId: worker.userId, candidate: { startsAt: input.startsAt, endsAt: input.endsAt, requiredRole: input.requiredRole } });
      const blocked = warnings.some(item => item.startsWith("Overlaps shift #") || item.startsWith("Block:"));
      candidates.push({ id: worker.userId, name: worker.name ?? "Unnamed Key Worker", email: worker.email, warnings, available: !blocked });
    }
    return candidates.sort((left, right) => Number(right.available) - Number(left.available) || left.name.localeCompare(right.name));
  }),

  assignCoverageGapReplacement: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), propertyId: z.number().int().positive(), startsAt: z.number().int(), endsAt: z.number().int(), gapKey: z.string().min(8).max(180), slot: z.number().int().min(1).max(30), userId: z.number().int().positive(), requiredRole: z.string().max(120).optional(), overrideReason: z.string().max(4000).optional() })).mutation(async ({ ctx, input }) => {
    assertValidDateRange(input.startsAt, input.endsAt, "Replacement cover");
    await assertPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "shift.write");
    const db = await requireDb();
    const rotaDayStart = operationalDayStartUtc(input.startsAt);
    const [propertyRows, rows] = await Promise.all([
      db.select({ id: properties.id, name: properties.name, minimumStaffing: properties.minimumStaffing }).from(properties).where(and(eq(properties.id, input.propertyId), eq(properties.entityId, input.entityId))).limit(1),
      db.select({ shift: shifts, propertyName: properties.name, workerName: users.name }).from(shifts).innerJoin(properties, eq(properties.id, shifts.propertyId)).leftJoin(users, eq(users.id, shifts.assignedUserId)).where(and(eq(shifts.entityId, input.entityId), eq(shifts.propertyId, input.propertyId), lte(shifts.startsAt, rotaDayStart + ROTA_DAY_MS - 1), gt(shifts.endsAt, rotaDayStart))),
    ]);
    const [property] = propertyRows;
    if (!property) throw new TRPCError({ code: "NOT_FOUND", message: "Property not found." });
    const overview = buildRotaOverview({ rotaDayStart, properties: [property], shifts: rows.map(row => ({ ...row.shift, propertyName: row.propertyName, workerName: row.workerName })) });
    const gap = overview.coverageGaps.find(item => item.key === input.gapKey && item.propertyId === input.propertyId && item.startsAt === input.startsAt && item.endsAt === input.endsAt);
    if (!gap) throw new TRPCError({ code: "CONFLICT", message: "This coverage gap has changed or is already resolved. Refresh the rota before assigning replacement cover." });
    if (input.slot > gap.deficit) throw new TRPCError({ code: "BAD_REQUEST", message: "This replacement slot is outside the current staffing deficit." });
    const [existing] = await db.select({ id: shifts.id }).from(shifts).where(and(eq(shifts.propertyId, input.propertyId), eq(shifts.coverageGapKey, input.gapKey), eq(shifts.coverageGapSlot, input.slot))).limit(1);
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "This replacement slot has already been allocated. Refresh the rota to see the latest coverage." });
    const warnings = await schedulabilityWarnings(db, { entityId: input.entityId, propertyId: input.propertyId, userId: input.userId, candidate: { startsAt: input.startsAt, endsAt: input.endsAt, requiredRole: input.requiredRole } });
    if (warnings.some(item => item.startsWith("Overlaps shift #") || item.startsWith("Block:"))) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This Key Worker is not available for the selected cover interval. Choose an available replacement." });
    const overridden = requireCalendarOverride(warnings, input.overrideReason);
    const [created] = await db.insert(shifts).values({ entityId: input.entityId, propertyId: input.propertyId, assignedUserId: input.userId, title: "Replacement cover", startsAt: input.startsAt, endsAt: input.endsAt, requiredRole: input.requiredRole, status: "assigned", coverageState: warnings.length ? "at_risk" : "covered", coverageGapKey: input.gapKey, coverageGapSlot: input.slot, notes: "Manager allocation created from an identified coverage gap.", createdBy: ctx.user.id }).$returningId();
    await refreshPropertyCoverage(db, input.propertyId);
    const coverageEvaluation = await runRotaCoverageEvaluation(db, { entityId: input.entityId, from: rotaDayStart, to: rotaDayStart + ROTA_DAY_MS, propertyIds: [input.propertyId], actorUserId: ctx.user.id });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: "shift.coverage_gap_assign", resourceType: "shift", resourceId: created.id, sensitivity: "general", result: "success", metadata: { coverageGapKey: input.gapKey, coverageGapSlot: input.slot, replacementUserId: input.userId, warnings, overridden, coverageGapCountAfterAllocation: coverageEvaluation.gapCount, overrideReasonCiphertext: overridden && input.overrideReason ? encryptSensitive(input.overrideReason) : null } });
    return { id: created.id, warnings, overridden, remainingGapCount: coverageEvaluation.gapCount };
  }),

  shiftContacts: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), shiftId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const db = await requireDb();
    const [shift] = await db.select().from(shifts).where(and(eq(shifts.id, input.shiftId), eq(shifts.entityId, input.entityId))).limit(1);
    if (!shift) throw new TRPCError({ code: "NOT_FOUND", message: "Shift not found." });
    const access = await assertCurrentShiftPropertyCapability(ctx.user.id, input.entityId, shift.propertyId, "shift.read");
    if (access.role === "support_worker" && shift.assignedUserId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "You can only view contact details for your own assigned shift." });
    const [propertyRows, overlaps, managerAssignments] = await Promise.all([
      db.select({ id: properties.id, name: properties.name, managerUserId: properties.managerUserId }).from(properties).where(eq(properties.id, shift.propertyId)).limit(1),
      db.select({ id: users.id, name: users.name, email: users.email, phone: users.phone, jobTitle: staffProfiles.jobTitle, profilePhone: staffProfiles.phone }).from(shifts).innerJoin(users, eq(users.id, shifts.assignedUserId)).leftJoin(staffProfiles, and(eq(staffProfiles.userId, users.id), eq(staffProfiles.entityId, input.entityId))).where(and(eq(shifts.entityId, input.entityId), eq(shifts.propertyId, shift.propertyId), inArray(shifts.status, ["assigned", "confirmed", "in_progress"]), lt(shifts.startsAt, shift.endsAt), gt(shifts.endsAt, shift.startsAt))),
      db.select({ id: users.id, name: users.name, email: users.email, phone: users.phone, jobTitle: staffProfiles.jobTitle, profilePhone: staffProfiles.phone }).from(propertyAssignments).innerJoin(users, eq(users.id, propertyAssignments.userId)).leftJoin(staffProfiles, and(eq(staffProfiles.userId, users.id), eq(staffProfiles.entityId, input.entityId))).where(and(eq(propertyAssignments.entityId, input.entityId), eq(propertyAssignments.propertyId, shift.propertyId), eq(propertyAssignments.assignmentType, "manager"))),
    ]);
    const [property] = propertyRows;
    if (!property) throw new TRPCError({ code: "NOT_FOUND", message: "Property not found." });
    const managerIds = new Set(managerAssignments.map(item => item.id)); if (property.managerUserId) managerIds.add(property.managerUserId);
    const managerRows = property.managerUserId && !managerAssignments.some(item => item.id === property.managerUserId) ? await db.select({ id: users.id, name: users.name, email: users.email, phone: users.phone, jobTitle: staffProfiles.jobTitle, profilePhone: staffProfiles.phone }).from(users).leftJoin(staffProfiles, and(eq(staffProfiles.userId, users.id), eq(staffProfiles.entityId, input.entityId))).where(eq(users.id, property.managerUserId)).limit(1) : [];
    const toContact = (row: any, relationship: "On-shift colleague" | "Property manager / supervisor") => ({ id: row.id, name: row.name ?? "Authorised colleague", relationship, jobTitle: row.jobTitle ?? null, email: row.email ?? null, phone: row.phone ?? row.profilePhone ?? null });
    const colleagues = overlaps.filter(row => row.id !== ctx.user.id && !managerIds.has(row.id)).map(row => toContact(row, "On-shift colleague"));
    const supervisors = [...managerAssignments, ...managerRows].reduce((list: any[], row: any) => list.some(item => item.id === row.id) ? list : [...list, toContact(row, "Property manager / supervisor")], []);
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: shift.propertyId, action: "shift.contacts.read", resourceType: "shift", resourceId: shift.id, sensitivity: "restricted", result: "allowed", metadata: { colleagueCount: colleagues.length, supervisorCount: supervisors.length } });
    return { shift: { id: shift.id, title: shift.title, startsAt: shift.startsAt, endsAt: shift.endsAt }, property: { id: property.id, name: property.name }, colleagues, supervisors };
  }),

  createShift: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(), propertyId: z.number().int().positive(), assignedUserId: z.number().int().positive().optional(),
    title: z.string().min(2).max(140).default("Support shift"), startsAt: z.number().int(), endsAt: z.number().int(), requiredRole: z.string().max(120).optional(), notes: z.string().max(2000).optional(), overrideReason:z.string().max(4000).optional(),
  })).mutation(async ({ ctx, input }) => {
    assertValidDateRange(input.startsAt,input.endsAt,"Shift");
    await assertPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "shift.write");
    const db = await requireDb();
    const warnings = input.assignedUserId ? await schedulabilityWarnings(db,{entityId:input.entityId,propertyId:input.propertyId,userId:input.assignedUserId,candidate:input}) : [];
    const overridden=requireCalendarOverride(warnings,input.overrideReason);const{overrideReason,...shiftInput}=input;
    const [result] = await db.insert(shifts).values({ ...shiftInput, createdBy: ctx.user.id, status: input.assignedUserId ? "assigned" : "open", coverageState: input.assignedUserId ? warnings.length ? "at_risk" : "covered" : "uncovered" }).$returningId();
    await refreshPropertyCoverage(db, input.propertyId);
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: "shift.create", resourceType: "shift", resourceId: result.id, result: "success", metadata: { warnings,overridden,overrideReasonCiphertext:overridden&&input.overrideReason?encryptSensitive(input.overrideReason):null } });
    return { id: result.id, warnings };
  }),

  rescheduleShift:protectedProcedure.input(z.object({entityId:z.number().int().positive(),shiftId:z.number().int().positive(),propertyId:z.number().int().positive(),assignedUserId:z.number().int().positive().optional(),startsAt:z.number().int(),endsAt:z.number().int(),expectedUpdatedAt:z.number().int().optional(),overrideReason:z.string().max(4000).optional()})).mutation(async({ctx,input})=>{
    assertValidDateRange(input.startsAt,input.endsAt,"Shift");
    const db=await requireDb();const[current]=await db.select().from(shifts).where(and(eq(shifts.id,input.shiftId),eq(shifts.entityId,input.entityId))).limit(1);
    if(!current)throw new TRPCError({code:"NOT_FOUND",message:"The shift no longer exists. Refresh the calendar."});
    await assertPropertyCapability(ctx.user.id,input.entityId,current.propertyId,"shift.write");await assertPropertyCapability(ctx.user.id,input.entityId,input.propertyId,"shift.write");
    const currentVersion=new Date(current.updatedAt).getTime();if(isStaleCalendarVersion(input.expectedUpdatedAt,currentVersion))throw new TRPCError({code:"CONFLICT",message:"This shift was changed by another user. Refresh the calendar before moving it again."});
    const warnings=input.assignedUserId?await schedulabilityWarnings(db,{entityId:input.entityId,propertyId:input.propertyId,userId:input.assignedUserId,candidate:{id:current.id,startsAt:input.startsAt,endsAt:input.endsAt,requiredRole:current.requiredRole}}):[];
    const overridden=requireCalendarOverride(warnings,input.overrideReason);const eventType=current.assignedUserId!==input.assignedUserId?"reassigned":"edited";
    await db.transaction(async tx=>{await tx.update(shifts).set({propertyId:input.propertyId,assignedUserId:input.assignedUserId??null,startsAt:input.startsAt,endsAt:input.endsAt,status:input.assignedUserId?"assigned":"open",coverageState:input.assignedUserId?(warnings.length?"at_risk":"covered"):"uncovered"}).where(eq(shifts.id,current.id));const[event]=await tx.insert(shiftChangeEvents).values({entityId:input.entityId,propertyId:input.propertyId,shiftId:current.id,eventType,reasonKey:"calendar_drag",reason:"Manager calendar scheduling change",previousSnapshot:{propertyId:current.propertyId,assignedUserId:current.assignedUserId,startsAt:current.startsAt,endsAt:current.endsAt},newSnapshot:{propertyId:input.propertyId,assignedUserId:input.assignedUserId??null,startsAt:input.startsAt,endsAt:input.endsAt},affectedUserId:input.assignedUserId,createdBy:ctx.user.id}).$returningId();for(const userId of Array.from(new Set([input.assignedUserId,current.assignedUserId].filter((value):value is number=>Boolean(value)))))await tx.insert(shiftChangeAcknowledgements).values({entityId:input.entityId,shiftChangeEventId:event.id,userId}).onDuplicateKeyUpdate({set:{status:"unread",readAt:null,acknowledgedAt:null}});});
    await refreshPropertyCoverage(db,current.propertyId);if(input.propertyId!==current.propertyId)await refreshPropertyCoverage(db,input.propertyId);
    await writeAuditEvent({actorUserId:ctx.user.id,entityId:input.entityId,propertyId:input.propertyId,action:"shift.calendar_reschedule",resourceType:"shift",resourceId:current.id,sensitivity:"general",result:"success",metadata:{warnings,overridden,previousPropertyId:current.propertyId,previousAssignedUserId:current.assignedUserId,overrideReasonCiphertext:overridden&&input.overrideReason?encryptSensitive(input.overrideReason):null}});
    return{success:true,warnings,overridden};
  }),

  requestShiftChange: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(), propertyId: z.number().int().positive(), shiftId: z.number().int().positive(), requestType: z.enum(["claim", "swap", "release", "cancel"]), proposedUserId: z.number().int().positive().optional(), reason: z.string().min(3).max(2000),
  })).mutation(async ({ ctx, input }) => {
    await assertPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "shift.read");
    const db = await requireDb();
    const [result] = await db.insert(shiftRequests).values({ ...input, requestedBy: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: `shift_request.${input.requestType}`, resourceType: "shift_request", resourceId: result.id, result: "success" });
    return { id: result.id };
  }),

  pendingShiftRequests: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "shift.write");
    const db = await requireDb();
    return db.select().from(shiftRequests).where(and(eq(shiftRequests.entityId, input.entityId), eq(shiftRequests.status, "pending"))).orderBy(asc(shiftRequests.createdAt));
  }),

  reviewShiftRequest: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), id: z.number().int().positive(), decision: z.enum(["approved", "declined"]), notes: z.string().max(2000).optional() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "shift.write");
    const db = await requireDb();
    const [request] = await db.select().from(shiftRequests).where(and(eq(shiftRequests.id, input.id), eq(shiftRequests.entityId, input.entityId))).limit(1);
    if (!request || request.status !== "pending") throw new Error("Pending request not found");
    const [shift] = await db.select().from(shifts).where(eq(shifts.id, request.shiftId)).limit(1); if (!shift) throw new Error("Shift not found");
    const targetUserId = request.requestType === "claim" ? request.requestedBy : request.requestType === "swap" ? request.proposedUserId : null;
    const warnings = input.decision === "approved" && targetUserId ? await assignmentWarnings(db, input.entityId, targetUserId, shift) : [];
    await db.transaction(async tx => {
      await tx.update(shiftRequests).set({ status: input.decision, reviewedBy: ctx.user.id, reviewedAt: Date.now(), reviewNotes: input.notes }).where(eq(shiftRequests.id, request.id));
      if (input.decision === "approved") {
        if (request.requestType === "claim") await tx.update(shifts).set({ assignedUserId: request.requestedBy, status: "assigned", coverageState: warnings.length ? "at_risk" : "covered" }).where(eq(shifts.id, request.shiftId));
        if (request.requestType === "swap" && request.proposedUserId) await tx.update(shifts).set({ assignedUserId: request.proposedUserId, status: "assigned", coverageState: warnings.length ? "at_risk" : "covered" }).where(eq(shifts.id, request.shiftId));
        if (request.requestType === "release") await tx.update(shifts).set({ assignedUserId: null, status: "open", coverageState: "uncovered" }).where(eq(shifts.id, request.shiftId));
        if (request.requestType === "cancel") await tx.update(shifts).set({ status: "cancelled", coverageState: "uncovered" }).where(eq(shifts.id, request.shiftId));
      }
    });
    await refreshPropertyCoverage(db, shift.propertyId);
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: `shift_request.${input.decision}`, resourceType: "shift_request", resourceId: input.id, result: "success", metadata: { warnings } });
    return { success: true, warnings };
  }),

  clock: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(), propertyId: z.number().int().positive(), shiftId: z.number().int().positive().optional(), eventType: z.enum(["clock_in", "clock_out"]), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(), accuracyMetres: z.number().min(0).optional(), overrideReason: z.string().max(1000).optional(),
  })).mutation(async ({ ctx, input }) => {
    const access = await assertPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "shift.read");
    const db = await requireDb();
    if (access.role === "support_worker" && !input.shiftId) throw new TRPCError({ code: "FORBIDDEN", message: "Choose your assigned shift before recording attendance." });
    if (input.shiftId) {
      const [shift] = await db.select().from(shifts).where(and(eq(shifts.id, input.shiftId), eq(shifts.entityId, input.entityId), eq(shifts.propertyId, input.propertyId))).limit(1);
      if (!shift) throw new TRPCError({ code: "NOT_FOUND", message: "Shift not found" });
      if (!["owner", "registered_manager"].includes(access.role) && shift.assignedUserId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "This shift is not assigned to you" });
      if (access.role === "support_worker" && (Date.now() < shift.startsAt - 30 * 60_000 || Date.now() > shift.endsAt + 30 * 60_000)) {
        throw new TRPCError({ code: "CONFLICT", message: "Attendance can be recorded from 30 minutes before the assigned shift until 30 minutes after it ends." });
      }
    }
    const [property] = await db.select().from(properties).where(eq(properties.id, input.propertyId)).limit(1);
    const hasCoordinates = input.latitude !== undefined && input.longitude !== undefined && property?.latitude && property?.longitude;
    const distance = hasCoordinates ? calculateDistanceMetres(input.latitude!, input.longitude!, Number(property.latitude), Number(property.longitude)) : null;
    const locationState = distance === null ? "unavailable" : distance <= property.geofenceRadiusMetres ? "on_site" : "off_site";
    requireAttendanceOverride({ locationState, overrideReason: input.overrideReason });
    const [result] = await db.insert(clockEvents).values({ ...input, userId: ctx.user.id, occurredAt: Date.now(), latitude: input.latitude?.toFixed(7), longitude: input.longitude?.toFixed(7), accuracyMetres: input.accuracyMetres?.toFixed(2), distanceMetres: distance?.toFixed(2), locationState }).$returningId();
    if (input.shiftId) {
      const resolvedKey = shiftAttendanceReminderDedupeKey(input.shiftId, ctx.user.id, input.eventType);
      await db.update(notifications).set({ resolvedAt: Date.now(), readAt: Date.now(), escalationState: "resolved" }).where(and(eq(notifications.userId, ctx.user.id), eq(notifications.dedupeKey, resolvedKey)));
    }
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: `shift.${input.eventType}`, resourceType: "clock_event", resourceId: result.id, result: "success", metadata: { locationState, overrideReasonCiphertext: locationState === "on_site" ? null : encryptSensitive(input.overrideReason!) } });
    return { id: result.id, locationState, distanceMetres: distance };
  }),

  handovers: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), propertyId: z.number().int().positive(), shiftId: z.number().int().positive().optional() })).query(async ({ ctx, input }) => {
    await assertCurrentShiftPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "shift.read");
    const db = await requireDb();
    const rows = await db.select({ handover: handovers, propertyName: properties.name, authorName: users.name })
      .from(handovers)
      .innerJoin(properties, eq(properties.id, handovers.propertyId))
      .innerJoin(users, eq(users.id, handovers.createdBy))
      .where(and(eq(handovers.entityId, input.entityId), eq(handovers.propertyId, input.propertyId)))
      .orderBy(asc(handovers.createdAt));
    const ids = rows.map(row => row.handover.id);
    const [events, acknowledgements] = await Promise.all([
      ids.length ? db.select({ id: handoverReviewEvents.id, handoverId: handoverReviewEvents.handoverId, decision: handoverReviewEvents.decision, notesCiphertext: handoverReviewEvents.notesCiphertext, createdAt: handoverReviewEvents.createdAt, reviewerName: users.name })
        .from(handoverReviewEvents).innerJoin(users, eq(users.id, handoverReviewEvents.createdBy)).where(inArray(handoverReviewEvents.handoverId, ids)).orderBy(asc(handoverReviewEvents.createdAt)) : [],
      ids.length && input.shiftId ? db.select({ handoverId: handoverAcknowledgements.handoverId, acknowledgedAt: handoverAcknowledgements.acknowledgedAt })
        .from(handoverAcknowledgements).where(and(inArray(handoverAcknowledgements.handoverId, ids), eq(handoverAcknowledgements.shiftId, input.shiftId), eq(handoverAcknowledgements.userId, ctx.user.id))) : [],
    ]);
    const acknowledgementByHandover = new Map(acknowledgements.map(item => [item.handoverId, item.acknowledgedAt]));
    return rows.map(({ handover, propertyName, authorName }) => ({
      ...handover,
      propertyName,
      authorName: authorName || "Authorised colleague",
      structuredBrief: handover.structuredBriefCiphertext ? decryptSensitive(handover.structuredBriefCiphertext) : null,
      dictatedText: handover.dictatedTextCiphertext ? decryptSensitive(handover.dictatedTextCiphertext) : null,
      reviewNotes: handover.reviewNotesCiphertext ? decryptSensitive(handover.reviewNotesCiphertext) : null,
      structuredBriefCiphertext: undefined,
      dictatedTextCiphertext: undefined,
      reviewNotesCiphertext: undefined,
      acknowledgedForCurrentShiftAt: acknowledgementByHandover.get(handover.id) ?? null,
      reviewHistory: events.filter(event => event.handoverId === handover.id).map(event => ({ ...event, notes: event.notesCiphertext ? decryptSensitive(event.notesCiphertext) : null, notesCiphertext: undefined })),
    }));
  }),

  acknowledgeHandover: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), handoverId: z.number().int().positive(), shiftId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [shiftRows, handoverRows] = await Promise.all([
      db.select().from(shifts).where(and(eq(shifts.id, input.shiftId), eq(shifts.entityId, input.entityId))).limit(1),
      db.select().from(handovers).where(and(eq(handovers.id, input.handoverId), eq(handovers.entityId, input.entityId))).limit(1),
    ]);
    const [shift] = shiftRows;
    const [handover] = handoverRows;
    if (!shift) throw new TRPCError({ code: "NOT_FOUND", message: "The current shift could not be found." });
    if (!handover) throw new TRPCError({ code: "NOT_FOUND", message: "The handover could not be found." });
    await assertCurrentShiftPropertyCapability(ctx.user.id, input.entityId, shift.propertyId, "shift.read");
    try { assertIncomingHandoverCanBeAcknowledged({ currentShift: shift, handover, userId: ctx.user.id }); }
    catch (error) { throw new TRPCError({ code: "FORBIDDEN", message: error instanceof Error ? error.message : "This handover cannot be acknowledged." }); }
    const [existing] = await db.select({ id: handoverAcknowledgements.id, acknowledgedAt: handoverAcknowledgements.acknowledgedAt }).from(handoverAcknowledgements)
      .where(and(eq(handoverAcknowledgements.handoverId, handover.id), eq(handoverAcknowledgements.shiftId, shift.id), eq(handoverAcknowledgements.userId, ctx.user.id))).limit(1);
    if (existing) return { success: true, alreadyAcknowledged: true, acknowledgedAt: existing.acknowledgedAt };
    const acknowledgedAt = Date.now();
    await db.insert(handoverAcknowledgements).values({ entityId: input.entityId, handoverId: handover.id, shiftId: shift.id, userId: ctx.user.id, acknowledgedAt })
      .onDuplicateKeyUpdate({ set: { id: sql`${handoverAcknowledgements.id}` } });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: shift.propertyId, action: "handover.acknowledge", resourceType: "handover", resourceId: handover.id, sensitivity: handover.sensitivity === "operational" ? "general" : "safeguarding", result: "success", metadata: { shiftId: shift.id, acknowledgementType: "incoming_worker" } });
    return { success: true, alreadyAcknowledged: false, acknowledgedAt };
  }),

  createHandover: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(), propertyId: z.number().int().positive(), shiftId: z.number().int().positive().optional(), summary: z.string().min(10).max(5000), risks: z.string().max(4000).optional(), outstandingActions: z.string().max(4000).optional(), sensitivity: z.enum(["operational", "safeguarding", "restricted"]).default("operational"), templateCode: z.enum(["nursing_general", "nursing_night", "operational"]).optional(), structuredBrief: z.record(z.string().max(80), z.string().max(2000)).optional(), dictatedText: z.string().min(10).max(8000).optional(),
  })).mutation(async ({ ctx, input }) => {
    await assertCurrentShiftPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "shift.read");
    const db = await requireDb();
    if (input.shiftId) {
      const [shift] = await db.select().from(shifts).where(and(eq(shifts.id, input.shiftId), eq(shifts.entityId, input.entityId), eq(shifts.propertyId, input.propertyId))).limit(1);
      if (!shift) throw new TRPCError({ code: "FORBIDDEN", message: "Shift scope does not match the selected property." });
    }
    const { structuredBrief, dictatedText, ...values } = input;
    const [result] = await db.insert(handovers).values({ ...values, structuredBriefCiphertext: structuredBrief ? encryptSensitive(JSON.stringify(structuredBrief)) : undefined, dictatedTextCiphertext: dictatedText ? encryptSensitive(dictatedText) : undefined, dictatedReviewState: dictatedText ? "pending_review" : "not_required", createdBy: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: "handover.create", resourceType: "handover", resourceId: result.id, sensitivity: input.sensitivity === "operational" ? "general" : "safeguarding", result: "success", metadata: { templateCode: input.templateCode ?? null, dictatedReviewState: dictatedText ? "pending_review" : "not_required" } });
    return { id: result.id };
  }),

  reviewHandover: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), handoverId: z.number().int().positive(), decision: z.enum(["reviewed", "approved", "returned"]), notes: z.string().trim().max(4000).optional() })).mutation(async ({ ctx, input }) => {
    await assertHandoverReviewer(ctx.user.id, input.entityId);
    if (input.decision === "returned" && (!input.notes || input.notes.length < 10)) throw new TRPCError({ code: "BAD_REQUEST", message: "Add a clear return reason of at least 10 characters." });
    const db = await requireDb();
    const [row] = await db.select().from(handovers).where(and(eq(handovers.id, input.handoverId), eq(handovers.entityId, input.entityId))).limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Handover not found." });
    if (row.createdBy === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "A different authorised manager must review this handover." });
    const now = Date.now();
    await db.transaction(async tx => {
      await tx.update(handovers).set({ dictatedReviewState: input.decision, reviewedBy: ctx.user.id, reviewedAt: now, approvedBy: input.decision === "approved" ? ctx.user.id : row.approvedBy, approvedAt: input.decision === "approved" ? now : row.approvedAt, reviewNotesCiphertext: input.notes ? encryptSensitive(input.notes) : null }).where(eq(handovers.id, row.id));
      await tx.insert(handoverReviewEvents).values({ entityId: input.entityId, handoverId: row.id, decision: input.decision, notesCiphertext: input.notes ? encryptSensitive(input.notes) : undefined, createdBy: ctx.user.id });
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: row.propertyId, action: `handover.${input.decision}`, resourceType: "handover", resourceId: row.id, sensitivity: row.sensitivity === "operational" ? "general" : "safeguarding", result: "success", metadata: { dictatedTextReviewed: Boolean(row.dictatedTextCiphertext) } });
    return { success: true, reviewedAt: now };
  }),

  timesheets: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "shift.read");
    const db = await requireDb(); const access = await getUserAccess(ctx.user.id); const role = access.user.operationalRole === "owner" ? "owner" : access.memberships.find(item => item.entityId === input.entityId)?.operationalRole;
    return db.select().from(timesheets).where(role === "owner" || role === "registered_manager" ? eq(timesheets.entityId, input.entityId) : and(eq(timesheets.entityId, input.entityId), eq(timesheets.userId, ctx.user.id))).orderBy(asc(timesheets.periodStart));
  }),

  timesheetEntries: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), timesheetId: z.number().int().positive() })).query(async ({ ctx, input }) => { await assertEntityCapability(ctx.user.id, input.entityId, "shift.read"); const db = await requireDb(); const [sheet] = await db.select().from(timesheets).where(and(eq(timesheets.id, input.timesheetId), eq(timesheets.entityId, input.entityId))).limit(1); if (!sheet) throw new Error("Timesheet not found"); if (sheet.userId !== ctx.user.id) await assertEntityCapability(ctx.user.id, input.entityId, "shift.write"); return db.select().from(timesheetEntries).where(eq(timesheetEntries.timesheetId, sheet.id)); }),

  adjustTimesheetEntry: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), timesheetId: z.number().int().positive(), entryId: z.number().int().positive(), minutes: z.number().int().min(0).max(1440), reason: z.string().min(5).max(2000) })).mutation(async ({ ctx, input }) => { await assertEntityCapability(ctx.user.id, input.entityId, "shift.write"); const db = await requireDb(); const [sheet] = await db.select().from(timesheets).where(and(eq(timesheets.id, input.timesheetId), eq(timesheets.entityId, input.entityId))).limit(1); if (!sheet || !["draft", "submitted", "returned"].includes(sheet.status)) throw new Error("This timesheet can no longer be adjusted"); const [entry] = await db.select().from(timesheetEntries).where(and(eq(timesheetEntries.id, input.entryId), eq(timesheetEntries.timesheetId, sheet.id))).limit(1); if (!entry) throw new Error("Timesheet entry not found"); const allEntries = await db.select().from(timesheetEntries).where(eq(timesheetEntries.timesheetId, sheet.id)); const totalMinutes = allEntries.reduce((sum, item) => sum + (item.id === entry.id ? input.minutes : item.minutes), 0); await db.transaction(async tx => { await tx.update(timesheetEntries).set({ originalMinutes: entry.originalMinutes ?? entry.minutes, minutes: input.minutes, exceptionType: "manual_adjustment", adjustmentReason: input.reason, adjustedBy: ctx.user.id, adjustedAt: Date.now() }).where(eq(timesheetEntries.id, entry.id)); await tx.update(timesheets).set({ totalMinutes, status: "returned" }).where(eq(timesheets.id, sheet.id)); }); await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "timesheet.adjust", resourceType: "timesheet", resourceId: sheet.id, sensitivity: "hr", result: "success", metadata: { entryId: entry.id, originalMinutes: entry.minutes, adjustedMinutes: input.minutes } }); return { success: true, totalMinutes }; }),

  submitTimesheet: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { await assertEntityCapability(ctx.user.id, input.entityId, "shift.read"); const db = await requireDb(); const [sheet] = await db.select().from(timesheets).where(and(eq(timesheets.id, input.id), eq(timesheets.entityId, input.entityId), eq(timesheets.userId, ctx.user.id))).limit(1); if (!sheet || !["draft", "returned"].includes(sheet.status)) throw new Error("Only your draft or returned timesheet can be submitted"); await db.update(timesheets).set({ status: "submitted", submittedAt: Date.now() }).where(eq(timesheets.id, sheet.id)); await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "timesheet.submit", resourceType: "timesheet", resourceId: sheet.id, sensitivity: "hr", result: "success" }); return { success: true }; }),

  reviewTimesheet: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), id: z.number().int().positive(), decision: z.enum(["approved", "returned"]) })).mutation(async ({ ctx, input }) => { await assertEntityCapability(ctx.user.id, input.entityId, "shift.write"); const db = await requireDb(); const [sheet] = await db.select().from(timesheets).where(and(eq(timesheets.id, input.id), eq(timesheets.entityId, input.entityId))).limit(1); if (!sheet || sheet.status !== "submitted") throw new Error("Only submitted timesheets can be reviewed"); if (sheet.userId === ctx.user.id && input.decision === "approved") throw new Error("You cannot approve your own timesheet"); await db.update(timesheets).set({ status: input.decision, approvedAt: input.decision === "approved" ? Date.now() : null, approvedBy: input.decision === "approved" ? ctx.user.id : null }).where(eq(timesheets.id, sheet.id)); await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: `timesheet.${input.decision}`, resourceType: "timesheet", resourceId: sheet.id, sensitivity: "hr", result: "success" }); return { success: true }; }),

  generateTimesheet: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), periodStart: z.number().int(), periodEnd: z.number().int() })).mutation(async ({ ctx, input }) => {
    assertValidDateRange(input.periodStart,input.periodEnd,"Timesheet period","periodEnd");
    await assertEntityCapability(ctx.user.id, input.entityId, "shift.read");
    const db = await requireDb();
    const events = await db.select().from(clockEvents).where(and(eq(clockEvents.entityId, input.entityId), eq(clockEvents.userId, ctx.user.id), gte(clockEvents.occurredAt, input.periodStart), lte(clockEvents.occurredAt, input.periodEnd))).orderBy(asc(clockEvents.occurredAt));
    const entries: Array<{ shiftId?: number; clockInEventId?: number; clockOutEventId?: number; minutes: number; exceptionType: "none" | "missing_clock" | "off_site" }> = [];
    for (const clockIn of events.filter(event => event.eventType === "clock_in")) {
      const clockOut = events.find(event => event.eventType === "clock_out" && event.occurredAt > clockIn.occurredAt && event.shiftId === clockIn.shiftId);
      entries.push({ shiftId: clockIn.shiftId ?? undefined, clockInEventId: clockIn.id, clockOutEventId: clockOut?.id, minutes: clockOut ? Math.max(0, Math.round((clockOut.occurredAt - clockIn.occurredAt) / 60_000)) : 0, exceptionType: !clockOut ? "missing_clock" : clockIn.locationState === "off_site" || clockOut.locationState === "off_site" ? "off_site" : "none" });
    }
    const totalMinutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);
    const id = await db.transaction(async tx => {
      await tx.insert(timesheets).values({ entityId: input.entityId, userId: ctx.user.id, periodStart: input.periodStart, periodEnd: input.periodEnd, totalMinutes }).onDuplicateKeyUpdate({ set: { totalMinutes, status: "draft" } });
      const [sheet] = await tx.select({ id: timesheets.id }).from(timesheets).where(and(eq(timesheets.entityId, input.entityId), eq(timesheets.userId, ctx.user.id), eq(timesheets.periodStart, input.periodStart), eq(timesheets.periodEnd, input.periodEnd))).limit(1);
      if (!sheet) throw new Error("Timesheet could not be created");
      await tx.delete(timesheetEntries).where(eq(timesheetEntries.timesheetId, sheet.id));
      if (entries.length) await tx.insert(timesheetEntries).values(entries.map(entry => ({ ...entry, timesheetId: sheet.id })));
      return sheet.id;
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "timesheet.generate", resourceType: "timesheet", resourceId: id, result: "success", metadata: { totalMinutes, exceptions: entries.filter(entry => entry.exceptionType !== "none").length } });
    return { id, totalMinutes, entries: entries.length };
  }),

  payrollExport: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "shift.write");
    const db = await requireDb();
    const rows = await db.select().from(timesheets).where(and(eq(timesheets.entityId, input.entityId), inArray(timesheets.status, ["approved", "exported"])));
    const header = "timesheet_id,user_id,period_start,period_end,total_minutes,total_hours,status";
    const body = rows.map(row => [row.id, row.userId, new Date(row.periodStart).toISOString(), new Date(row.periodEnd).toISOString(), row.totalMinutes, (row.totalMinutes / 60).toFixed(2), row.status].join(","));
    if (rows.length) await db.update(timesheets).set({ status: "exported", exportReference: `PAY-${Date.now()}` }).where(inArray(timesheets.id, rows.map(row => row.id)));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "payroll.export", resourceType: "timesheet", sensitivity: "hr", result: "success", metadata: { records: rows.length } });
    return { fileName: `payroll-${input.entityId}-${new Date().toISOString().slice(0, 10)}.csv`, csv: [header, ...body].join("\n") };
  }),
});
