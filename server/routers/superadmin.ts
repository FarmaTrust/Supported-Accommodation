import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { entities, entityMemberships, users } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { writeAuditEvent } from "../services/audit";

function requireSuperadmin(user: { role: string; operationalRole: string }) {
  if (user.role !== "admin" || user.operationalRole !== "platform_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Superadmin access is required." });
  }
}

export const superadminRouter = router({
  overview: protectedProcedure.query(async ({ ctx }) => {
    requireSuperadmin(ctx.user);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Monitoring data is unavailable." });

    const [companyRows, membershipRows, userRows] = await Promise.all([
      db.select({ id: entities.id, name: entities.name, legalName: entities.legalName, status: entities.status, createdAt: entities.createdAt }).from(entities).orderBy(entities.name),
      db.select({ entityId: entityMemberships.entityId, userId: entityMemberships.userId, status: entityMemberships.status }).from(entityMemberships),
      db.select({ id: users.id, name: users.name, email: users.email, role: users.role, operationalRole: users.operationalRole, accountStatus: users.accountStatus, lastSignedIn: users.lastSignedIn }).from(users).orderBy(desc(users.lastSignedIn)),
    ]);
    const activeMemberCount = new Map<number, number>();
    for (const membership of membershipRows) if (membership.status === "active") activeMemberCount.set(membership.entityId, (activeMemberCount.get(membership.entityId) ?? 0) + 1);
    const companies = companyRows.map(company => ({ ...company, activeMembers: activeMemberCount.get(company.id) ?? 0 }));
    const activeUsers = userRows.filter(user => user.accountStatus === "active").length;
    const suspendedUsers = userRows.filter(user => user.accountStatus === "suspended").length;
    await writeAuditEvent({ actorUserId: ctx.user.id, action: "superadmin.monitoring_view", resourceType: "platform_monitoring", sensitivity: "restricted", result: "allowed", reasonCode: "platform_admin_metadata_only", metadata: { companyCount: companies.length, userCount: userRows.length } });
    return { totals: { companies: companies.length, activeCompanies: companies.filter(company => company.status === "active").length, users: userRows.length, activeUsers, suspendedUsers, memberships: membershipRows.filter(membership => membership.status === "active").length }, companies, users: userRows.slice(0, 100) };
  }),
});

export { requireSuperadmin };
