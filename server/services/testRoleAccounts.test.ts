import { describe, expect, it } from "vitest";
import { shouldReplaceTestCredential, testRoleAccounts } from "./testRoleAccounts";

describe("fictional TEST role-account definitions", () => {
  it("contains only unique fictional emails and maps the requested roles to explicit tenant membership roles", () => {
    expect(new Set(testRoleAccounts.map(account => account.email)).size).toBe(6);
    expect(testRoleAccounts.every(account => account.email.endsWith(".example.test"))).toBe(true);
    expect(testRoleAccounts.find(account => account.key === "superadmin")?.membershipRole).toBe("owner");
    const keyworker = testRoleAccounts.find(account => account.key === "keyworker");
    expect(keyworker?.membershipRole).toBe("support_worker");
    expect(keyworker?.allProperties).toBe(false);
    expect(testRoleAccounts.filter(account => account.key !== "keyworker").every(account => account.allProperties)).toBe(true);
    expect(testRoleAccounts.find(account => account.key === "finance")?.extraCapabilities).toEqual(["compliance.read", "compliance.write"]);
    expect(testRoleAccounts.find(account => account.key === "guest")?.membershipRole).toBe("read_only");
  });

  it("does not rotate an existing fictional credential during routine scenario provisioning", () => {
    expect(shouldReplaceTestCredential({ hasCredential: false })).toBe(true);
    expect(shouldReplaceTestCredential({ hasCredential: true })).toBe(false);
    expect(shouldReplaceTestCredential({ hasCredential: true, resetCredentials: true })).toBe(true);
  });
});
