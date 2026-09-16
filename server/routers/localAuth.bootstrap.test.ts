import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  token: process.env.LOCAL_AUTH_BOOTSTRAP_TOKEN ?? "",
  issued: 0,
  audit: 0,
  existingCredentials: 0,
}));

vi.mock("../_core/env", () => ({ ENV: { localAuthBootstrapToken: state.token } }));
vi.mock("../db", () => ({
  getUserByEmail: vi.fn(async () => ({ id: 1, openId: "owner-local-test", name: "Owner", email: "owner@example.test", role: "admin", operationalRole: "owner" })),
  getDb: vi.fn(async () => ({ select: vi.fn(() => ({ from: vi.fn(() => ({ limit: vi.fn(async () => state.existingCredentials ? [{ id: 1 }] : []) })) })) })),
}));
vi.mock("../services/localAuth", () => ({
  attemptLocalLogin: vi.fn(),
  createOrReplaceLocalCredential: vi.fn(async () => ({ created: true, passwordVersion: 1 })),
  issueLocalPasswordReset: vi.fn(), normaliseLocalEmail: (value: string) => value.toLowerCase(), resetLocalPassword: vi.fn(), validateLocalPassword: vi.fn(),
}));
vi.mock("../_core/sdk", () => ({ sdk: { createLocalSessionToken: vi.fn(async () => "local-test-session") } }));
vi.mock("../_core/cookies", () => ({ getSessionCookieOptions: vi.fn(() => ({ httpOnly: true, path: "/", sameSite: "none", secure: true })) }));
vi.mock("../services/audit", () => ({ writeAuditEvent: vi.fn(async () => { state.audit += 1; }) }));
vi.mock("../services/colleagueProvisioning", () => ({ acceptPendingColleagueInvitations: vi.fn() }));
vi.mock("../authz", () => ({ assertEntityCapability: vi.fn() }));

import { localAuthRouter } from "./localAuth";

function caller() {
  return localAuthRouter.createCaller({ user: null, req: {} as any, res: { cookie: () => { state.issued += 1; } } as any } as any);
}

describe("localAuth.bootstrapOwner", () => {
  beforeEach(() => { state.issued = 0; state.audit = 0; state.existingCredentials = 0; });
  it("accepts the securely configured bootstrap token and creates a secure session", async () => {
    expect(state.token.length).toBeGreaterThanOrEqual(32);
    await expect(caller().bootstrapOwner({ email: "owner@example.test", password: "Strong-Example-Password-2026!", bootstrapToken: state.token })).resolves.toEqual({ success: true });
    expect(state.issued).toBe(1);
    expect(state.audit).toBe(1);
  });
  it("rejects an incorrect bootstrap token without issuing a session", async () => {
    await expect(caller().bootstrapOwner({ email: "owner@example.test", password: "Strong-Example-Password-2026!", bootstrapToken: "x".repeat(32) })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(state.issued).toBe(0);
  });
  it("fails closed once any local credential exists", async () => {
    state.existingCredentials = 1;
    await expect(caller().bootstrapOwner({ email: "owner@example.test", password: "Strong-Example-Password-2026!", bootstrapToken: state.token })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(state.issued).toBe(0);
  });

  it("reports first-owner setup as unavailable once a local credential exists", async () => {
    state.existingCredentials = 1;
    await expect(caller().bootstrapStatus()).resolves.toEqual({ setupAvailable: false });
  });
});
