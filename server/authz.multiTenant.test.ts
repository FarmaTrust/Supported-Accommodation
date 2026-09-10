import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: null as any, memberships: [] as any[], entityExists: true }));
vi.mock("./db", () => ({ getDb: vi.fn(async () => state.db) }));
vi.mock("./services/audit", () => ({ writeAuditEvent: vi.fn(async () => undefined) }));
import { assertEntityCapability, assertPropertyCapability, hasActivePlacementAssignment, propertyScopeAllows } from "./authz";
import { entities, entityMemberships, users } from "../drizzle/schema";

function query(rows: any[]) { return { limit: async () => rows, then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject) }; }
function db() { return { select: () => ({ from: (table: unknown) => ({ where: () => query(table === users ? [state.user] : table === entityMemberships ? state.memberships : table === entities ? (state.entityExists ? [{ id: 200 }] : []) : []) }) }) } as any; }
state.db = db();
function owner(id = 10) { return { id, openId: "owner-test", name: "Owner", email: "owner@example.test", loginMethod: "test_data", role: "user", operationalRole: "owner", accountStatus: "active", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }; }

describe("multi-tenant authorization boundaries", () => {
  beforeEach(() => { state.user = owner(); state.memberships = []; state.entityExists = true; state.db = db(); });
  it("denies an owner account without an active membership in another company", async () => {
    await expect(assertEntityCapability(10, 200, "compliance.read")).rejects.toThrow("Entity access denied");
    await expect(assertPropertyCapability(10, 200, 900, "property.read")).rejects.toThrow("Entity access denied");
  });
  it("permits an owner only through their active membership in the requested company", async () => {
    state.memberships = [{ entityId: 200, operationalRole: "owner", allProperties: 1, extraCapabilities: [] }];
    await expect(assertEntityCapability(10, 200, "compliance.read")).resolves.toMatchObject({ role: "owner", allProperties: true });
  });
  it("keeps property and placement scope helpers restrictive by default", () => {
    expect(propertyScopeAllows({ role: "registered_manager", allProperties: false, assignedPropertyIds: [1], propertyId: 2 })).toBe(false);
    expect(hasActivePlacementAssignment([{ placementId: 7, userId: 10, startsAt: null, endsAt: null }], 7, 11)).toBe(false);
  });
});
