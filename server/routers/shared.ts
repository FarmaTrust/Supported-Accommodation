import { TRPCError } from "@trpc/server";
import { getDb } from "../db";

export async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

export function ensureOwner(role: string) {
  if (role !== "owner" && role !== "platform_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Owner access required" });
  }
}
