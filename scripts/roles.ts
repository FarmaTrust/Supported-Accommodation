import "dotenv/config";
import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  entities,
  entityMemberships,
  roles as rolesTable,
  properties,
  propertyAssignments,
  users,
} from "../drizzle/schema";
import { roleCapabilities, type OperationalRole } from "../server/authz";
import { getDb, getUserByEmail } from "../server/db";
import { writeAuditEvent } from "../server/services/audit";
import { builtInRoleId } from "../server/services/roleResolution";
import { createOrReplaceLocalCredential, normaliseLocalEmail, validateLocalPassword } from "../server/services/localAuth";
import {
  CAPABILITY_LABELS,
  MANAGEABLE_CAPABILITIES,
  MANAGEABLE_ROLES,
  ROLE_LABELS,
  canRemoveOwner,
  normaliseManagedCapabilities,
  propertyAssignmentTypeForRole,
  requireMeaningfulAccessReason,
} from "../server/services/rbacRules";
import { visibleWorkspacePaths } from "../client/src/lib/roleNavigation";

// ponytail: roles are a fixed enum in drizzle/schema.ts + server/authz.ts, so this CLI assigns
// them rather than creating them. Adding a seventh role is a code change, not a runtime command.

const PAGE_TITLES: Record<string, string> = {
  "/": "Home dashboard",
  "/properties": "Properties",
  "/workforce": "Workforce",
  "/staff": "Staff workspace",
  "/manager-app": "RSM App",
  "/nominated-individual": "Nominated Individual App",
  "/keyworker-app": "Key Worker App",
  "/access-control": "Access control",
  "/placements": "Placements",
  "/rota": "Rota",
  "/rota-controls": "Rota controls",
  "/compliance-dashboard": "Compliance dashboard",
  "/compliance": "Compliance",
  "/governance": "Governance hub",
  "/work-plans": "Work plans",
  "/finance": "Finance",
  "/documents": "Documents",
  "/assurance": "Assurance",
  "/quality-reviews": "Quality reviews",
  "/regulation-28": "Regulation 28",
  "/care": "Care operations",
  "/safeguarding": "Safeguarding",
};

const ALL_ROLES = ["platform_admin", ...MANAGEABLE_ROLES] as const;

function fail(message: string): never {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

function asRole(value: string | undefined, allowed: readonly string[] = ALL_ROLES): OperationalRole {
  if (!value || !allowed.includes(value)) fail(`--role must be one of: ${allowed.join(", ")}`);
  return value as OperationalRole;
}

function asList(value: string | undefined) {
  return (value ?? "").split(",").map(item => item.trim()).filter(Boolean);
}

async function requireDb() {
  const db = await getDb();
  if (!db) fail("Database unavailable. Check TIDB_DATABASE_URL in .env");
  return db;
}

type AccessPlan = {
  entityId: number;
  role: OperationalRole;
  membershipRole: OperationalRole;
  allProperties: boolean;
  propertyIds: number[];
  extras: string[];
  reason: string;
};

/**
 * Validate and normalise an access change without writing anything. Run this before creating a
 * user row, so a rejected request never leaves an account behind with no membership or password.
 */
async function resolveAccess(input: {
  entityId: number;
  role: OperationalRole;
  allProperties: boolean;
  propertyIds: number[];
  extraCapabilities: string[];
  reason: string;
}): Promise<AccessPlan> {
  const db = await requireDb();
  const membershipRole = asRole(input.role, MANAGEABLE_ROLES);
  const allProperties = membershipRole === "owner" ? true : input.allProperties;
  const extras = membershipRole === "owner" ? [] : normaliseManagedCapabilities(input.extraCapabilities);
  const propertyIds = allProperties ? [] : Array.from(new Set(input.propertyIds)).sort((a, b) => a - b);

  for (const capability of extras) {
    if (!MANAGEABLE_CAPABILITIES.includes(capability as never)) {
      fail(`Unknown capability "${capability}". Allowed: ${MANAGEABLE_CAPABILITIES.join(", ")}`);
    }
  }
  if (!allProperties && !propertyIds.length) {
    fail("Pass --all-properties, or --properties with at least one property id.");
  }
  if (propertyIds.some(id => !Number.isInteger(id) || id <= 0)) fail("--properties takes comma-separated numeric ids.");
  if (propertyIds.length) {
    const rows = await db.select({ id: properties.id }).from(properties)
      .where(and(eq(properties.entityId, input.entityId), inArray(properties.id, propertyIds)));
    if (rows.length !== propertyIds.length) fail("One or more property ids do not belong to that company.");
  }
  return { entityId: input.entityId, role: input.role, membershipRole, allProperties, propertyIds, extras, reason: input.reason };
}

/** Shared write path for both create-user and set-role, mirroring accessControl.updateMemberAccess. */
async function applyAccess(plan: AccessPlan, input: { userId: number; actorUserId: number }) {
  const db = await requireDb();
  const { entityId, membershipRole, allProperties, propertyIds, extras } = plan;

  const [existing] = await db.select().from(entityMemberships)
    .where(and(eq(entityMemberships.entityId, entityId), eq(entityMemberships.userId, input.userId))).limit(1);
  if (existing) {
    const activeOwners = await db.select({ id: entityMemberships.id }).from(entityMemberships)
      .where(and(
        eq(entityMemberships.entityId, entityId),
        eq(entityMemberships.operationalRole, "owner"),
        eq(entityMemberships.status, "active"),
      ));
    if (!canRemoveOwner({
      currentRole: existing.operationalRole as OperationalRole,
      nextRole: membershipRole,
      activeOwnerCount: activeOwners.length,
    })) {
      fail("This is the last active company administrator. Assign another owner first.");
    }
  }

  await db.transaction(async tx => {
    await tx.insert(entityMemberships).values({
      entityId,
      userId: input.userId,
      operationalRole: membershipRole,
      allProperties: allProperties ? 1 : 0,
      extraCapabilities: extras,
      status: "active",
      createdBy: input.actorUserId,
    }).onDuplicateKeyUpdate({
      set: {
        operationalRole: membershipRole,
        allProperties: allProperties ? 1 : 0,
        extraCapabilities: extras,
        status: "active",
        endsAt: null,
      },
    });
    await tx.delete(propertyAssignments)
      .where(and(eq(propertyAssignments.entityId, entityId), eq(propertyAssignments.userId, input.userId)));
    if (propertyIds.length) {
      await tx.insert(propertyAssignments).values(propertyIds.map(propertyId => ({
        entityId,
        propertyId,
        userId: input.userId,
        assignmentType: propertyAssignmentTypeForRole(membershipRole as never),
        startsAt: Date.now(),
        createdBy: input.actorUserId,
      })));
    }
  });

  // users.roleId is the account's workspace role; the membership role drives capabilities.
  await db.update(users)
    .set({ roleId: await builtInRoleId(plan.role) })
    .where(eq(users.id, input.userId));

  await writeAuditEvent({
    actorUserId: input.actorUserId,
    entityId,
    action: "access_control.member.update",
    resourceType: "entity_membership",
    resourceId: input.userId,
    sensitivity: "restricted",
    result: "success",
    reasonCode: "cli_access_change",
    metadata: {
      targetUserId: input.userId,
      role: plan.role,
      membershipRole,
      allProperties,
      propertyIds,
      extraCapabilities: extras,
      reason: plan.reason,
      previousRole: existing?.operationalRole ?? null,
      via: "scripts/roles.ts",
    },
  });

  return plan;
}

// ---------------------------------------------------------------- commands

async function cmdRoles() {
  console.log("\nOperational roles (fixed enum — drizzle/schema.ts + server/authz.ts)\n");
  for (const role of ALL_ROLES) {
    const capabilities = [...(roleCapabilities[role as OperationalRole] ?? [])].sort();
    const pages = visibleWorkspacePaths(role);
    console.log(`  ${role}`);
    console.log(`    label        ${ROLE_LABELS[role as never] ?? "Platform administrator"}`);
    console.log(`    assignable   ${MANAGEABLE_ROLES.includes(role as never) ? "yes (entity membership)" : "no (workspace-wide only)"}`);
    console.log(`    capabilities ${capabilities.length} — ${capabilities.join(", ")}`);
    console.log(`    pages        ${pages.length} — ${pages.join(" ")}`);
    console.log("");
  }
  console.log("  Grantable extra capabilities on top of a role:");
  for (const capability of MANAGEABLE_CAPABILITIES) console.log(`    ${capability.padEnd(22)} ${CAPABILITY_LABELS[capability]}`);
  console.log("");
}

async function cmdPages(role: OperationalRole) {
  const pages = visibleWorkspacePaths(role);
  if (!pages.length) fail(`No navigation defined for role "${role}".`);
  console.log(`\nPages visible to ${role} (${pages.length})\n`);
  for (const path of pages) console.log(`  ${path.padEnd(24)} ${PAGE_TITLES[path] ?? ""}`);
  const hidden = ALL_ROLES.flatMap(other => visibleWorkspacePaths(other)).filter((path, index, list) => list.indexOf(path) === index && !pages.includes(path));
  console.log(`\nHidden from this role (${hidden.length})\n`);
  for (const path of hidden.sort()) console.log(`  ${path.padEnd(24)} ${PAGE_TITLES[path] ?? ""}`);
  console.log("\n  Source of truth: client/src/lib/roleNavigation.ts (menu) + server/authz.ts (data access).\n");
}

async function cmdEntities() {
  const db = await requireDb();
  const rows = await db.select({ id: entities.id, name: entities.name, status: entities.status }).from(entities);
  console.log("\nCompanies (entities)\n");
  for (const row of rows) console.log(`  ${String(row.id).padStart(4)}  ${row.status.padEnd(10)} ${row.name}`);
  console.log("");
}

async function cmdProperties(entityId: number) {
  const db = await requireDb();
  const rows = await db.select({ id: properties.id, name: properties.name, address: properties.addressLine1, status: properties.status })
    .from(properties).where(eq(properties.entityId, entityId));
  console.log(`\nProperties in company ${entityId}\n`);
  for (const row of rows) console.log(`  ${String(row.id).padStart(4)}  ${row.status.padEnd(10)} ${row.name ?? ""} — ${row.address ?? ""}`);
  console.log("");
}

async function cmdUsers(entityId?: number) {
  const db = await requireDb();
  if (entityId) {
    const rows = await db.select({
      id: users.id, email: users.email, name: users.name, role: rolesTable.slug,
      membershipRole: entityMemberships.operationalRole, status: entityMemberships.status,
      allProperties: entityMemberships.allProperties,
    }).from(entityMemberships).innerJoin(users, eq(users.id, entityMemberships.userId))
      .innerJoin(rolesTable, eq(rolesTable.id, users.roleId))
      .where(eq(entityMemberships.entityId, entityId));
    console.log(`\nMembers of company ${entityId}\n`);
    for (const row of rows) {
      console.log(`  ${String(row.id).padStart(4)}  ${(row.email ?? "").padEnd(52)} ${row.membershipRole.padEnd(20)} ${row.status.padEnd(10)} ${row.allProperties ? "all properties" : "scoped"}`);
    }
  } else {
    const rows = await db.select({ id: users.id, email: users.email, role: rolesTable.slug, status: users.accountStatus }).from(users).innerJoin(rolesTable, eq(rolesTable.id, users.roleId));
    console.log("\nAll users\n");
    for (const row of rows) console.log(`  ${String(row.id).padStart(4)}  ${(row.email ?? "").padEnd(52)} ${row.role.padEnd(20)} ${row.status}`);
  }
  console.log("");
}

async function cmdCreateUser(values: Record<string, string | boolean | undefined>) {
  const db = await requireDb();
  const email = normaliseLocalEmail(String(values.email ?? ""));
  if (!email.includes("@")) fail("--email is required.");
  const name = String(values.name ?? "").trim();
  if (name.length < 2) fail("--name is required.");
  const role = asRole(values.role as string, MANAGEABLE_ROLES);
  const entityId = Number(values.entity);
  if (!Number.isInteger(entityId) || entityId <= 0) fail("--entity <companyId> is required. Run `entities` to list them.");
  const password = String(values.password ?? "");
  if (!password) fail("--password is required (min 14 chars, 3 of: lower/upper/digit/symbol).");
  const reason = requireMeaningfulAccessReason(String(values.reason ?? "Account provisioned from the operator CLI."));

  const [entity] = await db.select().from(entities).where(eq(entities.id, entityId)).limit(1);
  if (!entity) fail(`Company ${entityId} not found.`);

  // Validate everything, including the password, before any row is written.
  const plan = await resolveAccess({
    entityId,
    role,
    allProperties: Boolean(values["all-properties"]),
    propertyIds: asList(values.properties as string).map(Number),
    extraCapabilities: asList(values.capabilities as string),
    reason,
  });
  const passwordIssue = validateLocalPassword(password);
  if (passwordIssue) fail(`--password rejected: ${passwordIssue}`);

  let user = await getUserByEmail(email);
  let created = false;
  if (!user) {
    const [inserted] = await db.insert(users).values({
      openId: `local_${randomBytes(16).toString("hex")}`,
      name,
      email,
      loginMethod: "email",
      roleId: await builtInRoleId(role),
      accountStatus: "active",
    }).$returningId();
    user = (await db.select().from(users).where(eq(users.id, inserted.id)).limit(1))[0]!;
    created = true;
  } else {
    await db.update(users).set({ name, loginMethod: "email", accountStatus: "active" }).where(eq(users.id, user.id));
  }

  const actorUserId = values.actor ? (await getUserByEmail(normaliseLocalEmail(String(values.actor))))?.id ?? user.id : user.id;
  const access = await applyAccess(plan, { userId: user.id, actorUserId });

  await createOrReplaceLocalCredential({
    userId: user.id,
    email,
    password,
    requireChangeOnNextLogin: values["no-password-change"] !== true,
  });

  console.log(`\n  ✓ ${created ? "Created" : "Updated"} ${email} (user id ${user.id})`);
  console.log(`    company        ${entity.name} (${entityId})`);
  console.log(`    role           ${role} — ${ROLE_LABELS[role as never]}`);
  console.log(`    properties     ${access.allProperties ? "all company properties" : access.propertyIds.join(", ")}`);
  console.log(`    extra caps     ${access.extras.length ? access.extras.join(", ") : "none"}`);
  console.log(`    first login    ${values["no-password-change"] === true ? "password kept" : "must change password"}`);
  console.log(`    pages          ${visibleWorkspacePaths(role).join(" ")}\n`);
}

async function cmdSetRole(values: Record<string, string | boolean | undefined>) {
  const db = await requireDb();
  const email = normaliseLocalEmail(String(values.email ?? ""));
  const user = await getUserByEmail(email);
  if (!user) fail(`No user with email ${email}.`);
  const role = asRole(values.role as string, MANAGEABLE_ROLES);
  const entityId = Number(values.entity);
  if (!Number.isInteger(entityId) || entityId <= 0) fail("--entity <companyId> is required.");
  const reason = requireMeaningfulAccessReason(String(values.reason ?? ""));

  const [membership] = await db.select().from(entityMemberships)
    .where(and(eq(entityMemberships.entityId, entityId), eq(entityMemberships.userId, user.id))).limit(1);

  const plan = await resolveAccess({
    entityId,
    role,
    allProperties: Boolean(values["all-properties"]),
    propertyIds: asList(values.properties as string).map(Number),
    extraCapabilities: asList(values.capabilities as string),
    reason,
  });
  const access = await applyAccess(plan, {
    userId: user.id,
    actorUserId: values.actor ? (await getUserByEmail(normaliseLocalEmail(String(values.actor))))?.id ?? user.id : user.id,
  });

  console.log(`\n  ✓ ${email}: ${membership?.operationalRole ?? "no membership"} → ${role} in company ${entityId}`);
  console.log(`    properties     ${access.allProperties ? "all company properties" : access.propertyIds.join(", ")}`);
  console.log(`    extra caps     ${access.extras.length ? access.extras.join(", ") : "none"}`);
  console.log(`    pages          ${visibleWorkspacePaths(role).join(" ")}\n`);
}

async function cmdSuspend(values: Record<string, string | boolean | undefined>) {
  const db = await requireDb();
  const email = normaliseLocalEmail(String(values.email ?? ""));
  const user = await getUserByEmail(email);
  if (!user) fail(`No user with email ${email}.`);
  const reason = requireMeaningfulAccessReason(String(values.reason ?? ""));
  const entityId = values.entity ? Number(values.entity) : undefined;

  // Suspend rather than delete: audit events are hash-chained and reference the actor.
  await db.update(entityMemberships).set({ status: "ended", endsAt: Date.now() })
    .where(entityId
      ? and(eq(entityMemberships.userId, user.id), eq(entityMemberships.entityId, entityId))
      : eq(entityMemberships.userId, user.id));
  await db.delete(propertyAssignments)
    .where(entityId
      ? and(eq(propertyAssignments.userId, user.id), eq(propertyAssignments.entityId, entityId))
      : eq(propertyAssignments.userId, user.id));
  if (!entityId) await db.update(users).set({ accountStatus: "suspended" }).where(eq(users.id, user.id));

  await writeAuditEvent({
    actorUserId: user.id,
    entityId,
    action: "access_control.member.suspend",
    resourceType: "user",
    resourceId: user.id,
    sensitivity: "restricted",
    result: "success",
    reasonCode: "cli_access_change",
    metadata: { targetUserId: user.id, entityId: entityId ?? "all", reason, via: "scripts/roles.ts" },
  });

  console.log(`\n  ✓ ${email}: membership ended${entityId ? ` in company ${entityId}` : " everywhere, account suspended"}\n`);
}

function usage() {
  console.log(`
Role and user management

  npm run roles -- roles                     List every role with its capabilities and pages
  npm run roles -- pages <role>              Show which pages one role sees, and which it does not
  npm run roles -- entities                  List companies, to get an --entity id
  npm run roles -- properties --entity <id>  List a company's properties, to get --properties ids
  npm run roles -- users [--entity <id>]     List users, or one company's members

  npm run roles -- create-user --email <e> --name "<n>" --role <role> --entity <id> \\
                    --password "<pw>" [--all-properties | --properties 1,2] \\
                    [--capabilities compliance.read,document.write] [--no-password-change] \\
                    [--reason "<20+ chars>"] [--actor <adminEmail>]

  npm run roles -- set-role --email <e> --role <role> --entity <id> \\
                    [--all-properties | --properties 1,2] [--capabilities ...] \\
                    --reason "<20+ chars>" [--actor <adminEmail>]

Assignable roles: ${MANAGEABLE_ROLES.join(", ")}
`);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    email: { type: "string" },
    name: { type: "string" },
    role: { type: "string" },
    entity: { type: "string" },
    password: { type: "string" },
    properties: { type: "string" },
    capabilities: { type: "string" },
    reason: { type: "string" },
    actor: { type: "string" },
    "all-properties": { type: "boolean" },
    "no-password-change": { type: "boolean" },
  },
});

const command = positionals[0];
const run = async () => {
  switch (command) {
    case "roles": return cmdRoles();
    case "pages": return cmdPages(asRole(positionals[1]));
    case "entities": return cmdEntities();
    case "properties": return cmdProperties(Number(values.entity));
    case "users": return cmdUsers(values.entity ? Number(values.entity) : undefined);
    case "create-user": return cmdCreateUser(values);
    case "set-role": return cmdSetRole(values);
    case "suspend": return cmdSuspend(values);
    default: return usage();
  }
};

run().then(() => process.exit(0)).catch(error => fail(error instanceof Error ? error.message : String(error)));
