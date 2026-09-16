import { describe, expect, it } from "vitest";
import { requireSuperadmin } from "./superadmin";

describe("Superadmin monitoring boundary", () => {
  it("allows only the explicit platform-admin and admin combination", () => {
    expect(() => requireSuperadmin({ role: "admin", operationalRole: "platform_admin" })).not.toThrow();
    expect(() => requireSuperadmin({ role: "admin", operationalRole: "owner" })).toThrow("Superadmin access is required");
    expect(() => requireSuperadmin({ role: "user", operationalRole: "platform_admin" })).toThrow("Superadmin access is required");
  });
});
