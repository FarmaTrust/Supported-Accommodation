import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ denied: false, audit: [] as any[] }));
vi.mock("../authz", () => ({ assertEntityCapability: vi.fn(async () => { if (state.denied) throw new Error("Company administration denied"); return { role: "owner", allProperties: true }; }) }));
vi.mock("../services/audit", () => ({ writeAuditEvent: vi.fn(async (event: any) => state.audit.push(event)) }));

import { guestInvitations, properties } from "../../drizzle/schema";

function thenable(value: unknown) { return { then: (resolve: any, reject: any) => Promise.resolve(value).then(resolve, reject) }; }
function buildDb() {
  return {
    select: () => ({ from: (table: unknown) => {
      const rows = table === properties ? [{ id: 10 }] : [];
      const chain: any = { where: () => chain, limit: async () => rows, orderBy: () => chain };
      Object.assign(chain, thenable(rows));
      return chain;
    } }),
    insert: () => ({ values: () => ({ $returningId: async () => [{ id: 44 }] }) }),
    update: () => ({ set: () => ({ where: async () => ({ affectedRows: 1 }) }) }),
    transaction: async (callback: any) => callback({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }), update: () => ({ set: () => ({ where: async () => ({ affectedRows: 1 }) }) }) }),
  };
}
vi.mock("./shared", () => ({ requireDb: async () => buildDb() }));

import { guestInvitationsRouter } from "./guestInvitations";
function caller() { return guestInvitationsRouter.createCaller({ user: { id: 1 }, req: {} as any, res: {} as any } as any); }

describe("guest invitation router", () => {
  beforeEach(() => { state.denied = false; state.audit = []; });
  it("denies non-administrators before invitation creation", async () => {
    state.denied = true;
    await expect(caller().create({ entityId: 1, propertyId: 10, expiresInHours: 24, maxUses: 1 })).rejects.toThrow(/denied/);
    expect(state.audit).toHaveLength(0);
  });
  it("rejects malformed expiry and bounded-use values at the API boundary", async () => {
    await expect(caller().create({ entityId: 1, propertyId: 10, expiresInHours: 0, maxUses: 1 })).rejects.toThrow();
    await expect(caller().create({ entityId: 1, propertyId: 10, expiresInHours: 24, maxUses: 11 })).rejects.toThrow();
  });
  it("stores only a one-way token representation and writes restricted create evidence", async () => {
    const result = await caller().create({ entityId: 1, propertyId: 10, expiresInHours: 24, maxUses: 1 });
    expect(result.token).toHaveLength(43);
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({ action: "guest_invitation.create", resourceType: "guest_invitation", sensitivity: "restricted" });
    expect(JSON.stringify(state.audit[0])).not.toContain(result.token);
  });
});
