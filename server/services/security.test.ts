import { describe, expect, it } from "vitest";
import { hashSecureToken, isGuestInvitationUsable, isSecureLinkUsable } from "./security";

describe("secure pack links", () => {
  it("stores a deterministic one-way token hash rather than the raw token", () => {
    const token = "example-private-link-token";
    const hash = hashSecureToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
    expect(hashSecureToken(token)).toBe(hash);
  });

  it("rejects expired, revoked and exhausted links", () => {
    const now = 1_700_000_000_000;
    expect(isSecureLinkUsable({ expiresAt: now + 1, viewCount: 0 }, now)).toBe(true);
    expect(isSecureLinkUsable({ expiresAt: now, viewCount: 0 }, now)).toBe(false);
    expect(isSecureLinkUsable({ expiresAt: now + 1, revokedAt: now - 1, viewCount: 0 }, now)).toBe(false);
    expect(isSecureLinkUsable({ expiresAt: now + 1, maxViews: 10, viewCount: 10 }, now)).toBe(false);
    expect(isSecureLinkUsable({ expiresAt: now + 1, maxViews: 10, viewCount: 9 }, now)).toBe(true);
  });

  it("keeps guest invitations fail-closed when expired, revoked or fully redeemed", () => {
    const now = 1_700_000_000_000;
    expect(isGuestInvitationUsable({ expiresAt: now + 1, maxUses: 1, useCount: 0 }, now)).toBe(true);
    expect(isGuestInvitationUsable({ expiresAt: now, maxUses: 1, useCount: 0 }, now)).toBe(false);
    expect(isGuestInvitationUsable({ expiresAt: now + 1, revokedAt: now - 1, maxUses: 1, useCount: 0 }, now)).toBe(false);
    expect(isGuestInvitationUsable({ expiresAt: now + 1, maxUses: 3, useCount: 3 }, now)).toBe(false);
  });
});
