import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ selections: [] as any[][], audit: [] as any[] }));

vi.mock("./db", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => state.selections.shift() ?? [] }) }) }),
  })),
}));
vi.mock("./services/audit", () => ({ writeAuditEvent: vi.fn(async (input: any) => { state.audit.push(input); }) }));

import { assertEntityCapability } from "./authz";

describe("invalid entity authorization", () => {
  it("fails closed with a stable forbidden error and records a non-foreign-key-bound denial audit", async () => {
    state.selections = [[{ id: 7, accountStatus: "active", operationalRole: "owner" }], [], []]; state.audit = [];
    await expect(assertEntityCapability(7, 99_999, "shift.read")).rejects.toMatchObject({ code: "FORBIDDEN", message: "Entity access denied" });
    expect(state.audit).toEqual([expect.objectContaining({ actorUserId: 7, resourceType: "entity", resourceId: 99_999, result: "denied", reasonCode: "entity_missing:shift.read", metadata: { requestedEntityId: 99_999 } })]);
    expect(state.audit[0]).not.toHaveProperty("entityId");
  });
});
