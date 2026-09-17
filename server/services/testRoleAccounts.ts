import { and, eq } from "drizzle-orm";
import { entities, entityMemberships, localAuthCredentials, placements, properties, propertyAssignments, staffProfiles, users, workerAssignments } from "../../drizzle/schema";
import { getDb, getUserByEmail } from "../db";
import { writeAuditEvent } from "./audit";
import { createOrReplaceLocalCredential, normaliseLocalEmail } from "./localAuth";

const TEST_ENTITY_NAME = "TEST — Training Provider";
const TEST_KEYWORKER_PROPERTY_ADDRESS = "30 Radford Road";

export const testRoleAccounts = [
  { key: "superadmin", name: "TEST Superadmin", email: "test.superadmin@training-provider.example.test", userRole: "admin" as const, operationalRole: "platform_admin" as const, membershipRole: "owner" as const, allProperties: true, extraCapabilities: [] as string[] },
  { key: "owner", name: "TEST Owner", email: "test.owner@training-provider.example.test", userRole: "admin" as const, operationalRole: "owner" as const, membershipRole: "owner" as const, allProperties: true, extraCapabilities: [] as string[] },
  { key: "manager", name: "TEST Manager", email: "test.manager@training-provider.example.test", userRole: "user" as const, operationalRole: "registered_manager" as const, membershipRole: "registered_manager" as const, allProperties: true, extraCapabilities: [] as string[] },
  { key: "keyworker", name: "TEST Key Worker", email: "test.keyworker@training-provider.example.test", userRole: "user" as const, operationalRole: "support_worker" as const, membershipRole: "support_worker" as const, allProperties: false, extraCapabilities: [] as string[] },
  { key: "finance", name: "TEST Finance User", email: "test.finance@training-provider.example.test", userRole: "user" as const, operationalRole: "finance" as const, membershipRole: "finance" as const, allProperties: true, extraCapabilities: ["compliance.read", "compliance.write"] },
  { key: "guest", name: "Guest", email: "guest@training-provider.example.test", userRole: "user" as const, operationalRole: "read_only" as const, membershipRole: "read_only" as const, allProperties: true, extraCapabilities: [] as string[] },
] as const;

/** Existing fictional credentials are intentionally stable across scenario maintenance.
 * Rotation is explicit, audited, and only used for a controlled TEST-account recovery. */
export function shouldReplaceTestCredential(input: { hasCredential: boolean; resetCredentials?: boolean }) {
  return !input.hasCredential || input.resetCredentials === true;
}

export async function provisionTestRoleAccounts(password: string | undefined, options: { resetCredentials?: boolean; requirePasswordChange?: boolean } = {}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [entity] = await db.select().from(entities).where(and(eq(entities.name, TEST_ENTITY_NAME), eq(entities.status, "active"))).limit(1);
  if (!entity) throw new Error("The TEST — Training Provider workspace is not active.");
  const [keyworkerProperty] = await db.select().from(properties).where(and(eq(properties.entityId, entity.id), eq(properties.addressLine1, TEST_KEYWORKER_PROPERTY_ADDRESS), eq(properties.status, "active"))).limit(1);
  if (!keyworkerProperty) throw new Error("The TEST Key Worker property was not found.");
  const keyworkerPlacementRows = await db.select({ id: placements.id }).from(placements).where(and(eq(placements.entityId, entity.id), eq(placements.propertyId, keyworkerProperty.id), eq(placements.status, "active")));
  if (keyworkerPlacementRows.length !== 3) throw new Error("The TEST Key Worker requires three active Radford placements.");
  const results: Array<{ email: string; userId: number; created: boolean }> = [];

  for (const spec of testRoleAccounts) {
    const email = normaliseLocalEmail(spec.email);
    let user = await getUserByEmail(email);
    let created = false;
    if (!user) {
      const [result] = await db.insert(users).values({ openId: `local_test_${spec.key}`, name: spec.name, email, loginMethod: "email", role: spec.userRole, operationalRole: spec.operationalRole, accountStatus: "active" }).$returningId();
      user = (await db.select().from(users).where(eq(users.id, result.id)).limit(1))[0]!;
      created = true;
    } else {
      await db.update(users).set({ name: spec.name, email, loginMethod: "email", role: spec.userRole, operationalRole: spec.operationalRole, accountStatus: "active" }).where(eq(users.id, user.id));
    }
    await db.insert(entityMemberships).values({ entityId: entity.id, userId: user.id, operationalRole: spec.membershipRole, allProperties: spec.allProperties ? 1 : 0, extraCapabilities: [...spec.extraCapabilities], status: "active" })
      .onDuplicateKeyUpdate({ set: { operationalRole: spec.membershipRole, allProperties: spec.allProperties ? 1 : 0, extraCapabilities: [...spec.extraCapabilities], status: "active", endsAt: null } });
    if (spec.key === "keyworker") {
      const now = Date.now();
      await db.delete(propertyAssignments).where(and(eq(propertyAssignments.entityId, entity.id), eq(propertyAssignments.userId, user.id)));
      await db.insert(propertyAssignments).values({ entityId: entity.id, propertyId: keyworkerProperty.id, userId: user.id, assignmentType: "worker", startsAt: now })
        .onDuplicateKeyUpdate({ set: { startsAt: now, endsAt: null } });
      await db.update(workerAssignments).set({ endsAt: now }).where(and(eq(workerAssignments.entityId, entity.id), eq(workerAssignments.userId, user.id)));
      for (const placement of keyworkerPlacementRows) await db.insert(workerAssignments).values({ entityId: entity.id, placementId: placement.id, userId: user.id, assignmentRole: "key_worker", startsAt: now }).onDuplicateKeyUpdate({ set: { startsAt: now, endsAt: null } });
      await db.insert(staffProfiles).values({ entityId: entity.id, userId: user.id, employeeNumber: "TEST-KW-AUTH-001", fullName: spec.name, email, phone: "07700 900004", jobTitle: "TEST Key Worker", employmentType: "permanent", startDate: now, status: "active", createdBy: user.id })
        .onDuplicateKeyUpdate({ set: { fullName: spec.name, email, phone: "07700 900004", jobTitle: "TEST Key Worker", employmentType: "permanent", status: "active" } });
    }
    const [credential] = await db.select({ id: localAuthCredentials.id }).from(localAuthCredentials).where(eq(localAuthCredentials.userId, user.id)).limit(1);
    const credentialReplaced = shouldReplaceTestCredential({ hasCredential: Boolean(credential), resetCredentials: options.resetCredentials });
    if (credentialReplaced) {
      if (!password) throw new Error("A TEST credential password is required for initial provisioning or an explicit reset.");
      await createOrReplaceLocalCredential({ userId: user.id, email, password, requireChangeOnNextLogin: options.requirePasswordChange ?? false });
    }
    await writeAuditEvent({ actorType: "system", entityId: entity.id, action: "test_account.provision", resourceType: "user", resourceId: user.id, sensitivity: "restricted", result: "success", reasonCode: credentialReplaced ? "fictional_test_credential_created_or_reset" : "fictional_test_credential_preserved", metadata: { accountKey: spec.key, membershipRole: spec.membershipRole, allProperties: spec.allProperties, credentialReplaced, forcedPasswordChange: credentialReplaced ? Boolean(options.requirePasswordChange) : undefined, keyworkerPropertyScope: spec.key === "keyworker" ? TEST_KEYWORKER_PROPERTY_ADDRESS : undefined } });
    results.push({ email, userId: user.id, created });
  }
  return { entityId: entity.id, accounts: results };
}
