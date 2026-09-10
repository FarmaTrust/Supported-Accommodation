import { describe, expect, it } from "vitest";
import { normaliseProvisioningEmail } from "./colleagueProvisioning";

describe("colleague provisioning rules", () => {
  it("normalises a provider email before matching it to a pre-authorisation", () => {
    expect(normaliseProvisioningEmail("  Colleague@Example.TEST ")).toBe("colleague@example.test");
  });
});
