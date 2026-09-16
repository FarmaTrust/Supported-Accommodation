import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { localAuthCredentials, users } from "../../drizzle/schema";
import { getDb } from "../db";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60_000;
const RESET_TTL_MS = 60 * 60_000;

export type LocalLoginResult =
  | { status: "success"; user: typeof users.$inferSelect; passwordVersion: number; mustChangePassword: boolean }
  | { status: "locked" }
  | { status: "invalid" };

export function normaliseLocalEmail(email: string) {
  return email.trim().toLowerCase();
}

export function validateLocalPassword(password: string) {
  if (password.length < 14) return "Use at least 14 characters.";
  if (password.length > 256) return "Use no more than 256 characters.";
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(password)) return "Remove control characters from the password.";
  const classes = [/[a-z]/.test(password), /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
  if (classes < 3) return "Use at least three of: lowercase, uppercase, number and symbol.";
  return null;
}

function deriveKey(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}

export async function hashLocalPassword(password: string) {
  const strengthIssue = validateLocalPassword(password);
  if (strengthIssue) throw new Error(strengthIssue);
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyLocalPassword(password: string, storedHash: string) {
  const [algorithm, rawN, rawR, rawP, rawSalt, rawDigest] = storedHash.split("$");
  if (algorithm !== "scrypt" || !rawN || !rawR || !rawP || !rawSalt || !rawDigest) return false;
  const n = Number(rawN); const r = Number(rawR); const p = Number(rawP);
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return false;
  try {
    const actual = await deriveKey(password, Buffer.from(rawSalt, "hex"));
    const expected = Buffer.from(rawDigest, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
}

export function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createResetToken() {
  return randomBytes(32).toString("base64url");
}

export function nextFailedLoginState(currentFailedAttempts: number, now: number) {
  const failedAttempts = currentFailedAttempts + 1;
  const lockedUntil = failedAttempts >= MAX_FAILED_ATTEMPTS ? now + LOCKOUT_MS : null;
  return { failedAttempts: lockedUntil ? 0 : failedAttempts, lockedUntil };
}

export async function attemptLocalLogin(input: { email: string; password: string; now?: number }): Promise<LocalLoginResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = input.now ?? Date.now();
  const emailNormalized = normaliseLocalEmail(input.email);
  const [record] = await db.select({ credential: localAuthCredentials, user: users })
    .from(localAuthCredentials).innerJoin(users, eq(localAuthCredentials.userId, users.id))
    .where(eq(localAuthCredentials.emailNormalized, emailNormalized)).limit(1);
  if (!record || record.user.accountStatus !== "active") return { status: "invalid" };
  if (record.credential.lockedUntil && record.credential.lockedUntil > now) return { status: "locked" };
  const correct = await verifyLocalPassword(input.password, record.credential.passwordHash);
  if (!correct) {
    const { failedAttempts, lockedUntil } = nextFailedLoginState(record.credential.failedAttempts, now);
    await db.update(localAuthCredentials).set({ failedAttempts, lockedUntil, lastFailedAt: now }).where(eq(localAuthCredentials.id, record.credential.id));
    return lockedUntil ? { status: "locked" } : { status: "invalid" };
  }
  await db.update(localAuthCredentials).set({ failedAttempts: 0, lockedUntil: null }).where(eq(localAuthCredentials.id, record.credential.id));
  return { status: "success", user: record.user, passwordVersion: record.credential.passwordVersion, mustChangePassword: Boolean(record.credential.mustChangePassword) };
}

export async function createOrReplaceLocalCredential(input: { userId: number; email: string; password: string; requireChangeOnNextLogin?: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const emailNormalized = normaliseLocalEmail(input.email);
  const passwordHash = await hashLocalPassword(input.password);
  const now = Date.now();
  const [existing] = await db.select().from(localAuthCredentials).where(eq(localAuthCredentials.userId, input.userId)).limit(1);
  if (existing) {
    await db.update(localAuthCredentials).set({ emailNormalized, passwordHash, passwordVersion: existing.passwordVersion + 1, mustChangePassword: input.requireChangeOnNextLogin ? 1 : 0, failedAttempts: 0, lockedUntil: null, lastPasswordChangedAt: now, resetTokenHash: null, resetExpiresAt: null, resetUsedAt: now }).where(eq(localAuthCredentials.id, existing.id));
    return { passwordVersion: existing.passwordVersion + 1, created: false };
  }
  await db.insert(localAuthCredentials).values({ userId: input.userId, emailNormalized, passwordHash, mustChangePassword: input.requireChangeOnNextLogin ? 1 : 0, lastPasswordChangedAt: now });
  return { passwordVersion: 1, created: true };
}

export async function issueLocalPasswordReset(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [credential] = await db.select().from(localAuthCredentials).where(eq(localAuthCredentials.userId, userId)).limit(1);
  if (!credential) throw new Error("Local credential is not configured");
  const token = createResetToken(); const now = Date.now(); const expiresAt = now + RESET_TTL_MS;
  await db.update(localAuthCredentials).set({ resetTokenHash: hashResetToken(token), resetExpiresAt: expiresAt, resetUsedAt: null }).where(eq(localAuthCredentials.id, credential.id));
  return { token, expiresAt };
}

export async function resetLocalPassword(input: { token: string; password: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const passwordHash = await hashLocalPassword(input.password);
  const now = Date.now(); const tokenHash = hashResetToken(input.token);
  const [credential] = await db.select().from(localAuthCredentials).where(and(eq(localAuthCredentials.resetTokenHash, tokenHash), gt(localAuthCredentials.resetExpiresAt, now), isNull(localAuthCredentials.resetUsedAt))).limit(1);
  if (!credential) return null;
  const result = await db.update(localAuthCredentials).set({ passwordHash, passwordVersion: credential.passwordVersion + 1, mustChangePassword: 0, failedAttempts: 0, lockedUntil: null, lastPasswordChangedAt: now, resetUsedAt: now, resetTokenHash: null, resetExpiresAt: null }).where(and(eq(localAuthCredentials.id, credential.id), isNull(localAuthCredentials.resetUsedAt), eq(localAuthCredentials.resetTokenHash, tokenHash)));
  if (!result[0]?.affectedRows) return null;
  return { userId: credential.userId };
}

export async function isLocalSessionCurrent(userId: number, passwordVersion: number | undefined) {
  if (!passwordVersion) return false;
  const db = await getDb();
  if (!db) return false;
  const [credential] = await db.select({ passwordVersion: localAuthCredentials.passwordVersion }).from(localAuthCredentials).where(eq(localAuthCredentials.userId, userId)).limit(1);
  return credential?.passwordVersion === passwordVersion;
}

export async function requiresLocalPasswordChange(userId: number) {
  const db = await getDb();
  if (!db) return false;
  const [credential] = await db.select({ mustChangePassword: localAuthCredentials.mustChangePassword }).from(localAuthCredentials).where(eq(localAuthCredentials.userId, userId)).limit(1);
  return Boolean(credential?.mustChangePassword);
}
