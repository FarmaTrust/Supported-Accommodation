import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { colleagueInvitationPropertyGrants, colleagueInvitations, entityMemberships, properties, propertyAssignments, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { propertyAssignmentTypeForRole } from "./rbacRules";
import { writeAuditEvent } from "./audit";

export function normaliseProvisioningEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function acceptPendingColleagueInvitations(input: { userId: number; email: string | null | undefined }) {
  const emailNormalized = input.email ? normaliseProvisioningEmail(input.email) : "";
  if (!emailNormalized) return [];
  const db = await getDb();
  if (!db) return [];
  const now = Date.now();
  const accepted = await db.transaction(async tx => {
    await tx.update(colleagueInvitations).set({ status: "expired" }).where(and(
      eq(colleagueInvitations.emailNormalized, emailNormalized),
      eq(colleagueInvitations.status, "pending"),
      lt(colleagueInvitations.expiresAt, now),
    ));
    const pending = await tx.select().from(colleagueInvitations).where(and(
      eq(colleagueInvitations.emailNormalized, emailNormalized),
      eq(colleagueInvitations.status, "pending"),
      gt(colleagueInvitations.expiresAt, now),
    ));
    const applied: Array<{ id: number; entityId: number; role: string; propertyIds: number[] }> = [];
    for (const invitation of pending) {
      const [existingMembership] = await tx.select({ id: entityMemberships.id }).from(entityMemberships).where(and(
        eq(entityMemberships.entityId, invitation.entityId),
        eq(entityMemberships.userId, input.userId),
      )).limit(1);
      if (existingMembership) continue;
      const grants = await tx.select({ propertyId: colleagueInvitationPropertyGrants.propertyId }).from(colleagueInvitationPropertyGrants)
        .where(eq(colleagueInvitationPropertyGrants.invitationId, invitation.id));
      const propertyIds = grants.map(item => item.propertyId);
      if (!invitation.allProperties && !propertyIds.length) continue;
      if (propertyIds.length) {
        const validProperties = await tx.select({ id: properties.id }).from(properties).where(and(eq(properties.entityId, invitation.entityId), inArray(properties.id, propertyIds)));
        if (validProperties.length !== propertyIds.length) continue;
      }
      await tx.insert(entityMemberships).values({
        entityId: invitation.entityId,
        userId: input.userId,
        operationalRole: invitation.operationalRole,
        allProperties: invitation.allProperties,
        extraCapabilities: Array.isArray(invitation.extraCapabilities) ? invitation.extraCapabilities : [],
        status: "active",
        createdBy: invitation.createdBy,
      });
      if (!invitation.allProperties) {
        await tx.insert(propertyAssignments).values(propertyIds.map(propertyId => ({
          entityId: invitation.entityId,
          propertyId,
          userId: input.userId,
          assignmentType: propertyAssignmentTypeForRole(invitation.operationalRole),
          createdBy: invitation.createdBy,
        })));
      }
      await tx.update(colleagueInvitations).set({ status: "accepted", acceptedAt: now, acceptedByUserId: input.userId }).where(eq(colleagueInvitations.id, invitation.id));
      applied.push({ id: invitation.id, entityId: invitation.entityId, role: invitation.operationalRole, propertyIds });
    }
    return applied;
  });
  for (const invitation of accepted) {
    await writeAuditEvent({ actorUserId: input.userId, entityId: invitation.entityId, action: "colleague_invitation.accept", resourceType: "colleague_invitation", resourceId: invitation.id, sensitivity: "restricted", result: "success", reasonCode: "provider_verified_email_match", metadata: { role: invitation.role, propertyIds: invitation.propertyIds } });
  }
  return accepted;
}
