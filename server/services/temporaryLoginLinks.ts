import { randomBytes } from "node:crypto";

export const MAX_TEMPORARY_LOGIN_LINK_DAYS = 30;
export const MIN_TEMPORARY_LOGIN_LINK_DAYS = 1;
export const DAY_MS = 24 * 60 * 60 * 1_000;

export type TemporaryLoginLinkLifecycle = {
  expiresAt: number;
  revokedAt: number | null;
  redeemedAt: number | null;
};

/** Creates an opaque 256-bit token. Only its SHA-256 hash may be persisted. */
export function createTemporaryLoginToken() {
  return randomBytes(32).toString("base64url");
}

/** Validates and calculates a bounded expiry using the authoritative server clock. */
export function temporaryLoginLinkExpiresAt(expiresInDays: number, now = Date.now()) {
  if (!Number.isInteger(expiresInDays) || expiresInDays < MIN_TEMPORARY_LOGIN_LINK_DAYS || expiresInDays > MAX_TEMPORARY_LOGIN_LINK_DAYS) {
    throw new Error(`Temporary sign-in links must expire between ${MIN_TEMPORARY_LOGIN_LINK_DAYS} and ${MAX_TEMPORARY_LOGIN_LINK_DAYS} days.`);
  }
  return now + expiresInDays * DAY_MS;
}

/** Returns true only while the unredeemed link is still eligible to start a local session. */
export function isTemporaryLoginLinkUsable(link: TemporaryLoginLinkLifecycle, now = Date.now()) {
  return !link.revokedAt && !link.redeemedAt && link.expiresAt > now;
}

/** Internal audit classification only; the public response remains generic. */
export function temporaryLoginLinkUnavailableReason(link: TemporaryLoginLinkLifecycle | null | undefined, now = Date.now()) {
  if (!link) return "invalid";
  if (link.revokedAt) return "revoked";
  if (link.redeemedAt) return "redeemed";
  if (link.expiresAt <= now) return "expired";
  return "unusable";
}
