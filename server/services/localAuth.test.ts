import { describe, expect, it } from "vitest";
import { createResetToken, hashLocalPassword, hashResetToken, nextFailedLoginState, normaliseLocalEmail, validateLocalPassword, verifyLocalPassword } from "./localAuth";

describe("local authentication credential controls", () => {
  it("normalises email values consistently for MySQL credential lookup", () => {
    expect(normaliseLocalEmail("  Zaki@FarmATrust.com ")).toBe("zaki@farmatrust.com");
  });

  it("stores a non-plaintext salted password hash that verifies only the correct password", async () => {
    const password = "Secure-Example-Password-2026!";
    const first = await hashLocalPassword(password);
    const second = await hashLocalPassword(password);
    expect(first).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(first).not.toContain(password);
    expect(first).not.toBe(second);
    await expect(verifyLocalPassword(password, first)).resolves.toBe(true);
    await expect(verifyLocalPassword("Wrong-Example-Password-2026!", first)).resolves.toBe(false);
    await expect(verifyLocalPassword(password, "invalid")).resolves.toBe(false);
  });

  it("rejects weak and malformed password input before it can reach storage", () => {
    expect(validateLocalPassword("short")).toContain("14");
    expect(validateLocalPassword("alllowercasepassword")).toContain("three");
    expect(validateLocalPassword("Secure-Example-Password-2026!")).toBeNull();
  });

  it("locks a credential after five failed attempts and resets the visible attempt counter", () => {
    const now = 1_789_050_000_000;
    expect(nextFailedLoginState(3, now)).toEqual({ failedAttempts: 4, lockedUntil: null });
    expect(nextFailedLoginState(4, now)).toEqual({ failedAttempts: 0, lockedUntil: now + 15 * 60_000 });
  });

  it("creates long opaque reset tokens and persists only a non-plaintext one-way hash", () => {
    const token = createResetToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    const hash = hashResetToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashResetToken(token)).toBe(hash);
  });
});
