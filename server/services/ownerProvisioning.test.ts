import { describe, expect, it } from "vitest";
import { normaliseOwnerProvisioningInput } from "./ownerProvisioning";

describe("owner provisioning input", () => {
  it("normalises the email and produces a unique stable set of approved workspaces", () => {
    expect(normaliseOwnerProvisioningInput({ email: " Raja.Sharif@Farmatrust.com ", entityIds: [30001, 1, 1] }))
      .toEqual({ email: "raja.sharif@farmatrust.com", entityIds: [1, 30001] });
  });

  it("rejects an empty or invalid workspace set", () => {
    expect(() => normaliseOwnerProvisioningInput({ email: "owner@example.test", entityIds: [] })).toThrow("workspace");
    expect(() => normaliseOwnerProvisioningInput({ email: "owner@example.test", entityIds: [0] })).toThrow("workspace");
  });
});
