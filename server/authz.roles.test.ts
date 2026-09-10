import { describe, expect, it } from "vitest";
import { entityCapabilityAllowed, hasActivePlacementAssignment, propertyScopeAllows, roleHasCapability, roleRequiresPlacementAssignment, type OperationalRole } from "./authz";

describe("operational role capabilities", () => {
  it("keeps support workers out of HR and finance", () => {
    expect(roleHasCapability("support_worker", "young_person.read")).toBe(true);
    expect(roleHasCapability("support_worker", "incident.write")).toBe(true);
    expect(roleHasCapability("support_worker", "staff.sensitive")).toBe(false);
    expect(roleHasCapability("support_worker", "finance.read")).toBe(false);
    expect(roleHasCapability("support_worker", "audit.read")).toBe(false);
  });

  it("allows finance operations without safeguarding access", () => {
    expect(roleHasCapability("finance", "finance.issue")).toBe(true);
    expect(roleHasCapability("finance", "pack.write")).toBe(true);
    expect(roleHasCapability("finance", "incident.read")).toBe(false);
    expect(roleHasCapability("finance", "young_person.read")).toBe(false);
  });

  it("does not give the platform administrator business-data access by default", () => {
    expect(roleHasCapability("platform_admin", "config.write")).toBe(true);
    expect(roleHasCapability("platform_admin", "young_person.read")).toBe(false);
    expect(roleHasCapability("platform_admin", "finance.read")).toBe(false);
  });

  it("reserves issue and configuration powers from read-only users", () => {
    expect(roleHasCapability("read_only", "property.read")).toBe(true);
    expect(roleHasCapability("read_only", "property.write")).toBe(false);
    expect(roleHasCapability("read_only", "finance.issue")).toBe(false);
    expect(roleHasCapability("read_only", "config.write")).toBe(false);
  });

  it("applies the expected high-risk boundaries to every operational role", () => {
    const expectations: Record<OperationalRole, { financeIssue: boolean; staffSensitive: boolean; safeguarding: boolean }> = {
      platform_admin: { financeIssue: false, staffSensitive: false, safeguarding: false }, owner: { financeIssue: true, staffSensitive: true, safeguarding: true }, registered_manager: { financeIssue: false, staffSensitive: true, safeguarding: true }, support_worker: { financeIssue: false, staffSensitive: false, safeguarding: true }, hr_compliance: { financeIssue: false, staffSensitive: true, safeguarding: false }, finance: { financeIssue: true, staffSensitive: false, safeguarding: false }, read_only: { financeIssue: false, staffSensitive: false, safeguarding: false },
    };
    for (const [role, expected] of Object.entries(expectations) as Array<[OperationalRole, typeof expectations[OperationalRole]]>) { expect(roleHasCapability(role, "finance.issue")).toBe(expected.financeIssue); expect(roleHasCapability(role, "staff.sensitive")).toBe(expected.staffSensitive); expect(roleHasCapability(role, "young_person.write")).toBe(expected.safeguarding); }
  });

  it("allows explicitly granted entity capabilities without widening the role profile", () => { expect(entityCapabilityAllowed("read_only", "pack.write", ["pack.write"])).toBe(true); expect(roleHasCapability("read_only", "pack.write")).toBe(false); });

  it("requires a matching property assignment unless the membership covers all properties", () => { expect(propertyScopeAllows({ role: "support_worker", allProperties: false, assignedPropertyIds: [12], propertyId: 12 })).toBe(true); expect(propertyScopeAllows({ role: "support_worker", allProperties: false, assignedPropertyIds: [12], propertyId: 13 })).toBe(false); expect(propertyScopeAllows({ role: "registered_manager", allProperties: true, assignedPropertyIds: [], propertyId: 13 })).toBe(true); });

  it("requires a current explicit young-person assignment only for support workers", () => { const now = 1_800_000; const assignments = [{ placementId: 7, userId: 4, startsAt: now - 1_000, endsAt: now + 1_000 }, { placementId: 8, userId: 4, startsAt: now - 2_000, endsAt: now - 1_000 }]; expect(roleRequiresPlacementAssignment("support_worker")).toBe(true); expect(roleRequiresPlacementAssignment("registered_manager")).toBe(false); expect(hasActivePlacementAssignment(assignments, 7, 4, now)).toBe(true); expect(hasActivePlacementAssignment(assignments, 8, 4, now)).toBe(false); expect(hasActivePlacementAssignment(assignments, 7, 5, now)).toBe(false); });
});
