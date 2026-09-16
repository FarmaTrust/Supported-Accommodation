import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  propertyDenied: false,
  placementDenied: false,
  unit: { id: 22, label: "TEST Bedroom 1", status: "occupied" },
  event: { placementId: 41, eventType: "move_in" },
  resident: { placementId: 41, reference: "TEST-YP-001", preferredName: "Fictional Resident", placementStartAt: 1_700_000_000_000 },
  audits: [] as any[],
}));

vi.mock("../authz", () => ({
  assertEntityCapability: vi.fn(async () => ({ role: "registered_manager", allProperties: true })),
  assertPropertyCapability: vi.fn(async () => {
    if (state.propertyDenied) throw new Error("Property access denied");
    return { role: "registered_manager", allProperties: true };
  }),
  assertPlacementCapability: vi.fn(async () => {
    if (state.placementDenied) throw new Error("You are not assigned to this young person");
    return { placement: { id: 41, entityId: 1, propertyId: 10, status: "active" }, access: { role: "registered_manager" } };
  }),
  getUserAccess: vi.fn(async () => ({ user: { operationalRole: "registered_manager" }, memberships: [] })),
  listAccessiblePropertyIds: vi.fn(async () => [10]),
}));
vi.mock("../services/audit", () => ({ writeAuditEvent: vi.fn(async (event: any) => { state.audits.push(event); }) }));
vi.mock("./shared", () => ({ requireDb: vi.fn(async () => buildDb()), ensureOwner: vi.fn() }));

import { occupancyEvents, placements, propertyUnits } from "../../drizzle/schema";
import { entitiesRouter } from "./entities";

function buildDb() {
  const select = () => ({
    from: (table: unknown) => {
      if (table === placements) return { innerJoin: () => ({ where: () => ({ limit: async () => state.resident ? [state.resident] : [] }) }) };
      return {
        where: () => {
          if (table === propertyUnits) return { limit: async () => [state.unit] };
          if (table === occupancyEvents) return { orderBy: () => ({ limit: async () => state.event ? [state.event] : [] }) };
          return { limit: async () => [] };
        },
      };
    },
  });
  return { select } as any;
}

function caller() {
  return entitiesRouter.createCaller({ user: { id: 7, openId: "manager", name: "Manager", email: null, loginMethod: "email", role: "user", operationalRole: "registered_manager", accountStatus: "active", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: {} as any, res: {} as any } as any);
}

describe("entities.unitOccupancy", () => {
  beforeEach(() => {
    state.propertyDenied = false;
    state.placementDenied = false;
    state.unit = { id: 22, label: "TEST Bedroom 1", status: "occupied" };
    state.event = { placementId: 41, eventType: "move_in" };
    state.resident = { placementId: 41, reference: "TEST-YP-001", preferredName: "Fictional Resident", placementStartAt: 1_700_000_000_000 };
    state.audits = [];
  });

  it("reveals only the current resident identity after property and placement checks", async () => {
    const result = await caller().unitOccupancy({ entityId: 1, propertyId: 10, unitId: 22 });
    expect(result).toEqual(expect.objectContaining({ state: "assigned", resident: expect.objectContaining({ reference: "TEST-YP-001", preferredName: "Fictional Resident" }) }));
    expect(state.audits.at(-1)).toEqual(expect.objectContaining({ action: "unit_occupancy.resident.read", sensitivity: "safeguarding", reasonCode: "property_and_placement_scope_verified" }));
  });

  it("does not disclose the resident when property access is denied", async () => {
    state.propertyDenied = true;
    await expect(caller().unitOccupancy({ entityId: 1, propertyId: 10, unitId: 22 })).rejects.toThrow(/Property access denied/);
    expect(state.audits).toEqual([]);
  });

  it("does not disclose the resident when the worker lacks that placement assignment", async () => {
    state.placementDenied = true;
    await expect(caller().unitOccupancy({ entityId: 1, propertyId: 10, unitId: 22 })).rejects.toThrow(/not assigned/);
    expect(state.audits).toEqual([]);
  });

  it("reports an incomplete assignment without exposing a resident identity", async () => {
    state.event = null as any;
    const result = await caller().unitOccupancy({ entityId: 1, propertyId: 10, unitId: 22 });
    expect(result).toEqual(expect.objectContaining({ state: "assignment_not_recorded" }));
    expect(result).not.toHaveProperty("resident");
  });
});
