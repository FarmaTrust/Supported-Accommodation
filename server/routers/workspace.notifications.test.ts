import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ selected: [] as any[][], updates: [] as Record<string, unknown>[] }));

vi.mock("./shared", () => ({
  requireDb: vi.fn(async () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => state.selected.shift() ?? [], orderBy: () => ({ limit: async () => state.selected.shift() ?? [] }) }) }) }),
    update: () => ({ set: (values: Record<string, unknown>) => ({ where: async () => { state.updates.push(values); } }) }),
  })),
}));
vi.mock("../services/audit", () => ({ writeAuditEvent: vi.fn(async () => undefined) }));

import { workspaceRouter } from "./workspace";

function caller(userId = 7) {
  return workspaceRouter.createCaller({ user: { id: userId, openId: `user-${userId}`, name: "User", email: null, loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: {} as any, res: {} as any } as any);
}

describe("workspace notification ownership", () => {
  beforeEach(() => { state.selected = []; state.updates = []; });

  it("sets read and acknowledgement state only after an owner-scoped notification lookup succeeds", async () => {
    state.selected = [[{ id: 14, userId: 7, entityId: 1 }]];
    await expect(caller(7).markNotificationRead({ id: 14 })).resolves.toEqual({ success: true });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toEqual(expect.objectContaining({ escalationState: "acknowledged" }));
    expect(state.updates[0]?.readAt).toEqual(expect.any(Number));
  });

  it("denies a non-owner read or resolve action without updating another user’s notification", async () => {
    state.selected = [[]];
    await expect(caller(8).markNotificationRead({ id: 14 })).rejects.toThrow(/Notification not found/);
    expect(state.updates).toHaveLength(0);
    state.selected = [[]];
    await expect(caller(8).resolveNotification({ id: 14 })).rejects.toThrow(/Notification not found/);
    expect(state.updates).toHaveLength(0);
  });
});
