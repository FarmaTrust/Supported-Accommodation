import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { entities, entityMemberships, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { createOrReplaceLocalCredential, normaliseLocalEmail } from "./localAuth";
import { writeAuditEvent } from "./audit";

export function normaliseOwnerProvisioningInput(input: { email: string; entityIds: number[] }) {
  const email = normaliseLocalEmail(input.email);
  const entityIds = Array.from(new Set(input.entityIds)).sort((left, right) => left - right);
  if (!email || !email.includes("@")) throw new Error("A valid owner email address is required.");
  if (!entityIds.length || entityIds.some(id => !Number.isInteger(id) || id <= 0)) {
    throw new Error("At least one valid active workspace is required.");
  }
  return { email, entityIds };
}

/**
 * Provisions an explicitly approved local owner through the standard local-auth
 * hash function and explicit per-entity owner memberships. It intentionally
 * does not create a global cross-tenant bypass or persist a plaintext password.
 */
export async function provisionLocalOwner(input: {
  email: string;
  name: string;
  password: string;
  entityIds: number[];
}) {
  const database = await getDb();
  if (!database) throw new Error("Database unavailable");
  const { email, entityIds } = normaliseOwnerProvisioningInput(input);
  const [existing] = await database.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw new Error("A local account already exists for this email address.");

  const approvedEntities = await database.select({ id: entities.id }).from(entities)
    .where(inArray(entities.id, entityIds));
  if (approvedEntities.length !== entityIds.length) throw new Error("One or more approved workspaces could not be found.");

  const [created] = await database.insert(users).values({
    openId: `local_${randomBytes(18).toString("base64url")}`,
    name: input.name.trim(),
    email,
    loginMethod: "email",
    role: "admin",
    operationalRole: "owner",
    accountStatus: "active",
  }).$returningId();

  const [user] = await database.select().from(users).where(eq(users.id, created.id)).limit(1);
  if (!user) throw new Error("Local owner record could not be loaded.");
  const credential = await createOrReplaceLocalCredential({ userId: user.id, email, password: input.password, requireChangeOnNextLogin: true });

  await database.transaction(async tx => {
    for (const entityId of entityIds) {
      await tx.insert(entityMemberships).values({
        entityId,
        userId: user.id,
        operationalRole: "owner",
        allProperties: 1,
        extraCapabilities: [],
        status: "active",
        createdBy: user.id,
      }).onDuplicateKeyUpdate({ set: { operationalRole: "owner", allProperties: 1, extraCapabilities: [], status: "active", endsAt: null } });
    }
  });

  for (const entityId of entityIds) {
    await writeAuditEvent({
      actorUserId: user.id,
      actorType: "system",
      entityId,
      action: "auth.local.owner_provisioned",
      resourceType: "local_auth_credential",
      resourceId: user.id,
      sensitivity: "restricted",
      result: "success",
      reasonCode: "explicit_owner_provisioning",
      metadata: { membershipRole: "owner", allProperties: true, passwordVersion: credential.passwordVersion },
    });
  }
  return { userId: user.id, email, entityIds, passwordVersion: credential.passwordVersion };
}
