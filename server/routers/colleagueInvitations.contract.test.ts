import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ denied: false }));
vi.mock("../authz", () => ({ assertEntityCapability: vi.fn(async () => { if (state.denied) throw new Error("Company administration denied"); return { role: "owner", allProperties: true }; }) }));
vi.mock("../services/audit", () => ({ writeAuditEvent: vi.fn(async () => undefined) }));
vi.mock("./shared", () => ({ requireDb: vi.fn(async () => { throw new Error("Database must not be used for rejected inputs"); }) }));

import { colleagueInvitationsRouter } from "./colleagueInvitations";
function caller() { return colleagueInvitationsRouter.createCaller({ user: { id: 1 }, req: {} as any, res: {} as any } as any); }
const validInput = () => ({ entityId: 1, email: "colleague@example.test", role: "support_worker" as const, allProperties: false, propertyIds: [10], extraCapabilities: [], expiresInDays: 14, reason: "Approved after the documented recruitment and property-scope review." });

describe("colleague invitation router", () => {
  beforeEach(() => { state.denied = false; });
  it("denies callers without company-administrator capability before creating a pre-authorisation", async () => {
    state.denied = true;
    await expect(caller().create(validInput())).rejects.toThrow(/denied/);
  });
  it("rejects owner elevation, invalid email and missing property scope at the API boundary", async () => {
    await expect(caller().create({ ...validInput(), role: "owner" as any })).rejects.toThrow();
    await expect(caller().create({ ...validInput(), email: "not-an-email" })).rejects.toThrow();
    await expect(caller().create({ ...validInput(), propertyIds: [] })).rejects.toThrow();
  });
});
