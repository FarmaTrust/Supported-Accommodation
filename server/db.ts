import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.TIDB_DATABASE_URL) {
    try {
      _db = drizzle(process.env.TIDB_DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

/** roleId is optional here: a first-time sign-in is given the default workspace role. */
export async function upsertUser(user: Omit<InsertUser, "roleId"> & { roleId?: number }): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: Partial<InsertUser> & { openId: string } = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.roleId !== undefined) {
      values.roleId = user.roleId;
      updateSet.roleId = user.roleId;
    } else if (user.openId === ENV.ownerOpenId) {
      const { builtInRoleId } = await import("./services/roleResolution");
      const ownerRoleId = await builtInRoleId("owner");
      values.roleId = ownerRoleId;
      updateSet.roleId = ownerRoleId;
    }
    if (values.roleId === undefined) {
      const { builtInRoleId } = await import("./services/roleResolution");
      values.roleId = await builtInRoleId("support_worker");
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values as InsertUser).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  const { resolveUserRole } = await import("./services/roleResolution");
  return resolveUserRole(result[0]);
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const normalized = email.trim().toLowerCase();
  const result = await db.select().from(users).where(sql`LOWER(${users.email}) = ${normalized}`).limit(1);
  const { resolveUserRole } = await import("./services/roleResolution");
  return resolveUserRole(result[0]);
}

// TODO: add feature queries here as your schema grows.
