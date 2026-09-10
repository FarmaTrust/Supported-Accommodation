import { createHash } from "node:crypto";

export function hashSecureToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isSecureLinkUsable(input: { expiresAt: number; revokedAt?: number | null; maxViews?: number | null; viewCount: number }, now = Date.now()) {
  if (input.revokedAt) return false;
  if (input.expiresAt <= now) return false;
  if (input.maxViews !== null && input.maxViews !== undefined && input.viewCount >= input.maxViews) return false;
  return true;
}

export function isGuestInvitationUsable(input: { expiresAt: number; revokedAt?: number | null; maxUses: number; useCount: number }, now = Date.now()) {
  if (input.revokedAt) return false;
  if (input.expiresAt <= now) return false;
  if (input.useCount >= input.maxUses) return false;
  return true;
}
