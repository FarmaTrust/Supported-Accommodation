import { describe, expect, it } from "vitest";
import { canRemoveOwner, normaliseManagedCapabilities, propertyAssignmentTypeForRole, requireMeaningfulAccessReason } from "./rbacRules";

describe("company-admin RBAC rules", () => {
  it("keeps property assignment types role-specific", () => {
    expect(propertyAssignmentTypeForRole("registered_manager")).toBe("manager");
    expect(propertyAssignmentTypeForRole("support_worker")).toBe("worker");
    expect(propertyAssignmentTypeForRole("hr_compliance")).toBe("compliance");
    expect(propertyAssignmentTypeForRole("finance")).toBe("finance");
  });
  it("normalises duplicate scoped capabilities without widening them", () => expect(normaliseManagedCapabilities(["pack.read", "pack.read", "document.read"])).toEqual(["document.read", "pack.read"]));
  it("requires a meaningful auditable reason", () => {
    expect(() => requireMeaningfulAccessReason("short")).toThrow(/at least 20/);
    expect(requireMeaningfulAccessReason("  Approved after the quarterly access review. ")).toBe("Approved after the quarterly access review.");
  });
  it("never removes the last active company administrator", () => {
    expect(canRemoveOwner({ currentRole: "owner", nextRole: "registered_manager", activeOwnerCount: 1 })).toBe(false);
    expect(canRemoveOwner({ currentRole: "owner", nextRole: "registered_manager", activeOwnerCount: 2 })).toBe(true);
    expect(canRemoveOwner({ currentRole: "support_worker", nextRole: "registered_manager", activeOwnerCount: 1 })).toBe(true);
  });
});
