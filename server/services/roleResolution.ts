import { and, eq, isNull } from "drizzle-orm";
import { roles, type Role, type User } from "../../drizzle/schema";
import type { OperationalRole } from "../authz";
import { getDb } from "../db";

/**
 * `users.roleId` is the only role column left on the users table. Everything downstream still
 * reads `user.operationalRole` and `user.role`, so those are resolved here once, from the roles
 * row, and attached to the user object. That keeps a single source of truth in the database
 * without every permission gate having to learn about the join.
 */

export type ResolvedUser = User & {
  /** The workspace role the navigation and permission gates key off. */
  operationalRole: OperationalRole;
  /** Platform-level admin gate, formerly the users.role enum. */
  role: "user" | "admin";
  roleName: string;
  roleSlug: string;
  isBuiltInRole: boolean;
};

/** Built-in roles never change at runtime, so they are read once per process. */
let builtInCache: Map<number, Role> | null = null;
let builtInBySlugCache: Map<string, Role> | null = null;

export function resetRoleCache() {
  builtInCache = null;
  builtInBySlugCache = null;
}

async function loadBuiltInRoles() {
  if (builtInCache) return builtInCache;
  const db = await getDb();
  if (!db) return new Map<number, Role>();
  const rows = await db.select().from(roles).where(and(eq(roles.isBuiltIn, 1), isNull(roles.entityId)));
  builtInCache = new Map(rows.map(row => [row.id, row]));
  builtInBySlugCache = new Map(rows.map(row => [row.slug, row]));
  return builtInCache;
}

export async function builtInRoleBySlug(slug: string) {
  await loadBuiltInRoles();
  return builtInBySlugCache?.get(slug) ?? null;
}

export async function roleById(roleId: number): Promise<Role | null> {
  const builtIn = await loadBuiltInRoles();
  const cached = builtIn.get(roleId);
  if (cached) return cached;
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  return row ?? null;
}

/** A custom role answers to its base role; a built-in role answers to itself. */
export function workspaceRoleOf(role: Role): OperationalRole {
  return (role.isBuiltIn ? role.slug : role.baseRole) as OperationalRole;
}

/** Attach the derived role fields the rest of the codebase reads. */
export async function resolveUserRole(user: User | undefined | null): Promise<ResolvedUser | undefined> {
  if (!user) return undefined;
  const role = await roleById(user.roleId);
  if (!role) {
    // A user whose role row vanished must not silently fall back to a permissive default.
    return { ...user, operationalRole: "read_only", role: "user", roleName: "Unknown role", roleSlug: "read_only", isBuiltInRole: false };
  }
  return {
    ...user,
    operationalRole: workspaceRoleOf(role),
    role: role.isAdminAccount ? "admin" : "user",
    roleName: role.name,
    roleSlug: role.slug,
    isBuiltInRole: role.isBuiltIn === 1,
  };
}

/** The roleId to store for a built-in workspace role. */
export async function builtInRoleId(slug: OperationalRole) {
  const role = await builtInRoleBySlug(slug);
  if (!role) throw new Error(`The built-in "${slug}" role is missing. Run the database migrations.`);
  return role.id;
}
