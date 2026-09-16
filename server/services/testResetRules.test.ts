import { describe, expect, it } from "vitest";
import { isVisibleTestResetEligible } from "./testResetRules";

describe("visible TEST reset-link policy", () => {
  it("allows only a fictional email with an active TEST membership and no operational membership", () => {
    expect(isVisibleTestResetEligible({ email: "guest@training-provider.example.test", hasActiveTestMembership: true, hasActiveOperationalMembership: false })).toBe(true);
    expect(isVisibleTestResetEligible({ email: "guest@training-provider.example.test", hasActiveTestMembership: true, hasActiveOperationalMembership: true })).toBe(false);
    expect(isVisibleTestResetEligible({ email: "raja.sharif@farmatrust.com", hasActiveTestMembership: true, hasActiveOperationalMembership: false })).toBe(false);
  });
});
