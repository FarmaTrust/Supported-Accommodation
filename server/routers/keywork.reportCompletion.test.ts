import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "registered_manager" as string, propertyIds: [5] as number[], rows: [] as any[], audits: [] as any[] }));

vi.mock("../authz", () => ({
  listAccessiblePropertyIds: vi.fn(async () => state.propertyIds),
  assertPlacementCapability: vi.fn(async () => ({ placement: { propertyId: 5, entityId: 1 } })),
  assertPropertyCapability: vi.fn(async () => ({ role: state.role })),
  getUserAccess: vi.fn(async () => ({ user: { operationalRole: state.role }, memberships: [{ entityId: 1, operationalRole: state.role }] })),
}));
vi.mock("../services/audit", () => ({ writeAuditEvent: vi.fn(async (event: any) => { state.audits.push(event); }) }));
vi.mock("./shared", () => ({
  requireDb: vi.fn(async () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({ innerJoin: () => ({ where: async () => state.rows }) }),
        where: () => ({ orderBy: async () => state.rows }),
      }),
    }),
  })),
}));

import { keyworkRouter } from "./keywork";

function caller(userId = 7) {
  return keyworkRouter.createCaller({ user: { id: userId, openId: `user-${userId}`, name: "User", email: null, loginMethod: "email", role: "user", operationalRole: state.role, accountStatus: "active", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: {} as any, res: {} as any } as any);
}

const sample = [
  { id: 1, propertyId: 5, propertyName: "TEST Birch House", authorUserId: 7, authorName: "Fictional Key Worker", status: "submitted", reportDate: 100 },
  { id: 2, propertyId: 5, propertyName: "TEST Birch House", authorUserId: 8, authorName: "Another Worker", status: "approved", reportDate: 110 },
];

describe("keywork.reportCompletion", () => {
  beforeEach(() => { state.role = "registered_manager"; state.propertyIds = [5]; state.rows = [...sample]; state.audits = []; });

  it("returns factual per-property and per-Key Worker status for an authorised manager", async () => {
    const result = await caller().reportCompletion({ entityId: 1, from: 0, to: 200 });
    expect(result.properties).toHaveLength(1);
    expect(result.properties[0]).toEqual(expect.objectContaining({ propertyName: "TEST Birch House", counts: expect.objectContaining({ logged: 2, awaitingReview: 1, approvedOrLocked: 1 }) }));
    expect(result.properties[0]?.keyWorkers).toHaveLength(2);
    expect(state.audits[0]).toEqual(expect.objectContaining({ action: "keywork.report_completion.read", metadata: expect.objectContaining({ selfOnly: false }) }));
  });

  it("limits a support worker to their own reports even if the query returns another author", async () => {
    state.role = "support_worker";
    const result = await caller(7).reportCompletion({ entityId: 1, from: 0, to: 200 });
    expect(result.properties[0]?.keyWorkers).toEqual([expect.objectContaining({ userId: 7 })]);
    expect(state.audits[0]?.metadata).toEqual(expect.objectContaining({ selfOnly: true }));
  });

  it("rejects an inverted date range before returning any report state", async () => {
    await expect(caller().reportCompletion({ entityId: 1, from: 200, to: 100 })).rejects.toThrow(/end must be after/);
  });
});
