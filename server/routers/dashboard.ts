import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import {
  complianceObligations, entities, incidents, invoices, notifications, placements, properties, shifts, staffProfiles, workPlanActions,
} from "../../drizzle/schema";
import { assertEntityCapability, getUserAccess } from "../authz";
import { protectedProcedure, router } from "../_core/trpc";
import { calculateRagStatus } from "../services/rules";
import { requireDb } from "./shared";

export const dashboardRouter = router({
  summary: protectedProcedure.input(z.object({ entityId: z.number().int().positive().optional() })).query(async ({ ctx, input }) => {
    const db = await requireDb();
    const { user, memberships } = await getUserAccess(ctx.user.id);
    let entityIds = memberships.map(item => item.entityId);
    if (user.operationalRole === "owner" && !entityIds.length) {
      const all = await db.select({ id: entities.id }).from(entities);
      entityIds = all.map(item => item.id);
    }
    if (input.entityId) {
      await assertEntityCapability(ctx.user.id, input.entityId, "entity.read");
      entityIds = [input.entityId];
    }
    if (!entityIds.length) return { empty: true as const, counts: {}, priorities: [], rag: { green: 0, amber: 0, red: 0, grey: 0 } };
    const [propertyRows, staffRows, placementRows, shiftRows, invoiceRows, incidentRows, obligations, actions, userNotifications] = await Promise.all([
      db.select().from(properties).where(inArray(properties.entityId, entityIds)),
      db.select().from(staffProfiles).where(inArray(staffProfiles.entityId, entityIds)),
      db.select().from(placements).where(inArray(placements.entityId, entityIds)),
      db.select().from(shifts).where(and(inArray(shifts.entityId, entityIds), ne(shifts.status, "cancelled"))),
      db.select().from(invoices).where(inArray(invoices.entityId, entityIds)),
      db.select().from(incidents).where(and(inArray(incidents.entityId, entityIds), ne(incidents.status, "closed"))),
      db.select().from(complianceObligations).where(inArray(complianceObligations.entityId, entityIds)).orderBy(asc(complianceObligations.dueAt)),
      db.select().from(workPlanActions).where(and(inArray(workPlanActions.entityId, entityIds), ne(workPlanActions.status, "complete"))).orderBy(asc(workPlanActions.dueAt)),
      db.select().from(notifications).where(and(eq(notifications.userId, ctx.user.id), isNull(notifications.readAt))).limit(8),
    ]);
    const rag = { green: 0, amber: 0, red: 0, grey: 0 };
    obligations.forEach(item => { rag[calculateRagStatus(item.dueAt, item.completedAt, item.leadDays)] += 1; });
    const priorities = [
      ...incidentRows.filter(item => item.severity === "critical" || item.severity === "high").map(item => ({ kind: "incident", id: item.id, title: item.summary, dueAt: item.notificationDueAt, tone: "red" })),
      ...obligations.filter(item => calculateRagStatus(item.dueAt, item.completedAt, item.leadDays) !== "green").slice(0, 5).map(item => ({ kind: "compliance", id: item.id, title: item.title, dueAt: item.dueAt, tone: item.dueAt < Date.now() ? "red" : "amber" })),
      ...actions.filter(item => item.dueAt < Date.now() + 7 * 86_400_000).slice(0, 5).map(item => ({ kind: "work_plan", id: item.id, title: item.title, dueAt: item.dueAt, tone: item.dueAt < Date.now() ? "red" : "blue" })),
    ].slice(0, 10);
    return {
      empty: false as const,
      counts: {
        properties: propertyRows.length, activeStaff: staffRows.filter(item => item.status === "active").length,
        activePlacements: placementRows.filter(item => item.status === "active").length,
        openShifts: shiftRows.filter(item => item.status === "open").length,
        overdueInvoices: invoiceRows.filter(item => item.status === "overdue").length,
        openIncidents: incidentRows.length,
      },
      rag,
      priorities,
      notifications: userNotifications,
    };
  }),
});
