import { describe, expect, it } from "vitest";
import { hashSecureToken } from "./security";
import { createTemporaryLoginToken, DAY_MS, isTemporaryLoginLinkUsable, MAX_TEMPORARY_LOGIN_LINK_DAYS, temporaryLoginLinkExpiresAt, temporaryLoginLinkUnavailableReason } from "./temporaryLoginLinks";

describe("temporary login link security rules", () => {
  it("creates an opaque 256-bit token and retains only a one-way representation", () => {
    const token = createTemporaryLoginToken();
    const hash = hashSecureToken(token);
    expect(token).toHaveLength(43);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
  });

  it("enforces a maximum lifetime of thirty days on the server clock", () => {
    const now = 1_789_050_000_000;
    expect(temporaryLoginLinkExpiresAt(MAX_TEMPORARY_LOGIN_LINK_DAYS, now)).toBe(now + MAX_TEMPORARY_LOGIN_LINK_DAYS * DAY_MS);
    expect(() => temporaryLoginLinkExpiresAt(0, now)).toThrow(/between 1 and 30/);
    expect(() => temporaryLoginLinkExpiresAt(31, now)).toThrow(/between 1 and 30/);
  });

  it("treats revoked, expired and redeemed links as unusable", () => {
    const now = 1_789_050_000_000;
    expect(isTemporaryLoginLinkUsable({ expiresAt: now + 1, revokedAt: null, redeemedAt: null }, now)).toBe(true);
    expect(isTemporaryLoginLinkUsable({ expiresAt: now, revokedAt: null, redeemedAt: null }, now)).toBe(false);
    expect(isTemporaryLoginLinkUsable({ expiresAt: now + 1, revokedAt: now - 1, redeemedAt: null }, now)).toBe(false);
    expect(isTemporaryLoginLinkUsable({ expiresAt: now + 1, revokedAt: null, redeemedAt: now - 1 }, now)).toBe(false);
  });

  it("distinguishes link lifecycle failures for restricted audit evidence only", () => {
    const now = 1_789_050_000_000;
    expect(temporaryLoginLinkUnavailableReason(null, now)).toBe("invalid");
    expect(temporaryLoginLinkUnavailableReason({ expiresAt: now - 1, revokedAt: null, redeemedAt: null }, now)).toBe("expired");
    expect(temporaryLoginLinkUnavailableReason({ expiresAt: now + 1, revokedAt: now - 1, redeemedAt: null }, now)).toBe("revoked");
    expect(temporaryLoginLinkUnavailableReason({ expiresAt: now + 1, revokedAt: null, redeemedAt: now - 1 }, now)).toBe("redeemed");
  });
});
