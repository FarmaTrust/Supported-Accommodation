import { describe, expect, it } from "vitest";
import { hasActivePlacementAssignment, propertyScopeAllows, roleHasCapability, roleRequiresPlacementAssignment } from "./authz";

describe("staff workspace role capabilities", () => {
  it("allows Keyworkers to perform scoped frontline, medication, finance and self-service work", () => {
    expect(roleHasCapability("support_worker", "frontline.write")).toBe(true);
    expect(roleHasCapability("support_worker", "medication.write")).toBe(true);
    expect(roleHasCapability("support_worker", "resident_finance.write")).toBe(true);
    expect(roleHasCapability("support_worker", "staff.self_service")).toBe(true);
    expect(roleRequiresPlacementAssignment("support_worker")).toBe(true);
  });

  it("does not grant Keyworkers Manager review or unrestricted staff powers", () => {
    expect(roleHasCapability("support_worker", "incident.review")).toBe(false);
    expect(roleHasCapability("support_worker", "staff.write")).toBe(false);
    expect(roleHasCapability("support_worker", "finance.write")).toBe(false);
  });

  it("denies property and young-person scope when an active assignment is absent", () => {
    expect(propertyScopeAllows({ role: "support_worker", allProperties: false, assignedPropertyIds: [2], propertyId: 3 })).toBe(false);
    expect(propertyScopeAllows({ role: "support_worker", allProperties: false, assignedPropertyIds: [3], propertyId: 3 })).toBe(true);
    expect(hasActivePlacementAssignment([], 10, 20, 1_000)).toBe(false);
    expect(hasActivePlacementAssignment([{ placementId: 10, userId: 20, startsAt: 0, endsAt: 999 }], 10, 20, 1_000)).toBe(false);
    expect(hasActivePlacementAssignment([{ placementId: 10, userId: 20, startsAt: 0, endsAt: null }], 10, 20, 1_000)).toBe(true);
  });
});
