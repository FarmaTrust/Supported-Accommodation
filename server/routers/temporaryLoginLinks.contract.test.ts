import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: false,
  audit: [] as any[],
  session: null as any,
  targetActive: true,
  hasMembership: true,
  hasCredential: true,
  lockedUntil: null as number | null,
  redeemLink: undefined as any,
  consumeAffectedRows: 1,
  operations: [] as unknown[],
  insertedRows: [] as any[],
}));
vi.mock("../authz", () => ({ assertEntityCapability: vi.fn(async () => { if (state.denied) throw new Error("Company administration denied"); return { role: "owner", allProperties: true }; }) }));
vi.mock("../services/audit", () => ({ writeAuditEvent: vi.fn(async (event: any) => state.audit.push(event)) }));
vi.mock("../services/localSession", () => ({ issueLocalSession: vi.fn(async (_ctx: any, user: any, passwordVersion: number) => { state.session = { user, passwordVersion }; }) }));

import { entityMemberships, localAuthCredentials, temporaryLoginLinks, users } from "../../drizzle/schema";

function chain(rows: any[]) {
  const result: any = { where: () => result, limit: async () => rows, orderBy: () => result };
  result.then = (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject);
  return result;
}
function target() { return state.targetActive ? [{ id: 22, openId: "local-target", name: "Existing colleague", email: "member@example.test", accountStatus: "active" }] : [{ id: 22, openId: "local-target", name: "Existing colleague", email: "member@example.test", accountStatus: "suspended" }]; }
function membership() { return state.hasMembership ? [{ id: 14 }] : []; }
function credential() { return state.hasCredential ? [{ id: 4, passwordVersion: 2, lockedUntil: state.lockedUntil, mustChangePassword: 1 }] : []; }
function selectRows(table: unknown, redeem = false) {
  if (table === temporaryLoginLinks) return redeem ? (state.redeemLink ? [state.redeemLink] : []) : [];
  if (table === users) return target();
  if (table === entityMemberships) return membership();
  if (table === localAuthCredentials) return credential();
  return [];
}
function updateFor(table: unknown, affected = 1) {
  return { set: () => ({ where: async () => { state.operations.push(table); return { affectedRows: affected }; } }) };
}
function buildDb() {
  return {
    select: () => ({ from: (table: unknown) => chain(selectRows(table)) }),
    transaction: async (callback: any) => callback({
      select: () => ({ from: (table: unknown) => chain(selectRows(table, true)) }),
      update: (table: unknown) => updateFor(table, table === temporaryLoginLinks && state.redeemLink ? state.consumeAffectedRows : 1),
      insert: () => ({ values: (value: any) => { state.insertedRows.push(value); return { $returningId: async () => [{ id: 91 }] }; } }),
    }),
    update: (table: unknown) => updateFor(table),
  };
}
vi.mock("./shared", () => ({ requireDb: async () => buildDb() }));

import { temporaryLoginLinksRouter } from "./temporaryLoginLinks";
function caller() { return temporaryLoginLinksRouter.createCaller({ user: { id: 1 }, req: {}, res: { cookie: vi.fn() } } as any); }
const validInput = () => ({ entityId: 1, targetUserId: 22, expiresInDays: 30, reason: "Verified recovery request for an existing active company colleague." });
function resetState() {
  state.denied = false; state.audit = []; state.session = null; state.targetActive = true; state.hasMembership = true; state.hasCredential = true; state.lockedUntil = null; state.consumeAffectedRows = 1; state.operations = [];
  state.insertedRows = [];
  state.redeemLink = { id: 91, entityId: 1, targetUserId: 22, tokenHash: "a".repeat(64), expiresAt: Date.now() + 60_000, revokedAt: null, redeemedAt: null };
}

describe("temporary login links router", () => {
  beforeEach(resetState);

  it("denies non-administrators before link issuance", async () => {
    state.denied = true;
    await expect(caller().issue(validInput())).rejects.toThrow(/denied/);
    expect(state.audit).toHaveLength(0);
  });

  it("rejects an expiry above the thirty-day maximum at the API boundary", async () => {
    await expect(caller().issue({ ...validInput(), expiresInDays: 31 })).rejects.toThrow();
  });

  it("rejects inactive, cross-company or credential-less recipients without changing access records", async () => {
    state.hasMembership = false;
    await expect(caller().issue(validInput())).rejects.toThrow(/does not have active access/);
    state.hasMembership = true; state.hasCredential = false;
    await expect(caller().issue(validInput())).rejects.toThrow(/does not have local sign-in credentials/);
    state.hasCredential = true; state.targetActive = false;
    await expect(caller().issue(validInput())).rejects.toThrow(/not active/);
    state.targetActive = true; state.lockedUntil = Date.now() + 60_000;
    await expect(caller().issue(validInput())).rejects.toThrow(/temporarily locked/);
    expect(state.operations).not.toContain(entityMemberships);
  });

  it("returns the opaque token only once, supersedes only prior links and never writes it to restricted audit evidence", async () => {
    const result = await caller().issue(validInput());
    expect(result.token).toHaveLength(43);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(state.operations).toContain(temporaryLoginLinks);
    expect(state.operations).not.toContain(entityMemberships);
    expect(state.insertedRows[0]).toMatchObject({ entityId: 1, targetUserId: 22, expiresAt: result.expiresAt });
    expect(state.insertedRows[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(state.insertedRows[0]?.tokenHash).not.toContain(result.token);
    expect(state.insertedRows[0]).not.toHaveProperty("token");
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({ action: "temporary_login_link.issued", sensitivity: "restricted", metadata: { targetUserId: 22, expiresInDays: 30 } });
    expect(JSON.stringify(state.audit[0])).not.toContain(result.token);
  });

  it("redeems once through the normal password-version-bound session and retains forced password change", async () => {
    const result = await caller().redeem({ token: "a".repeat(43) });
    expect(result).toEqual({ success: true, mustChangePassword: true });
    expect(state.session).toMatchObject({ user: { id: 22, openId: "local-target" }, passwordVersion: 2 });
    expect(state.operations).toContain(temporaryLoginLinks);
    expect(state.operations).not.toContain(entityMemberships);
    expect(state.audit.at(-1)).toMatchObject({ action: "temporary_login_link.redeem", actorType: "secure_link", result: "success", metadata: { mustChangePassword: true } });
  });

  it("fails closed on an invalid or competing redemption with a generic error and no token disclosure", async () => {
    state.redeemLink = null;
    const token = "b".repeat(43);
    await expect(caller().redeem({ token })).rejects.toMatchObject({ code: "NOT_FOUND", message: "This temporary sign-in link is unavailable. Ask your company administrator for a new link." });
    expect(state.session).toBeNull();
    expect(JSON.stringify(state.audit)).not.toContain(token);

    resetState(); state.consumeAffectedRows = 0;
    await expect(caller().redeem({ token })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.session).toBeNull();
    expect(state.audit.at(-1)).toMatchObject({ result: "denied", reasonCode: "concurrent_or_unusable" });
  });

  it("does not disclose revoked, expired or already-used link states to the public", async () => {
    const token = "c".repeat(43);
    for (const [reason, linkPatch] of [
      ["unavailable_revoked", { revokedAt: Date.now() - 1 }],
      ["unavailable_expired", { expiresAt: Date.now() - 1 }],
      ["unavailable_redeemed", { redeemedAt: Date.now() - 1 }],
    ] as const) {
      resetState();
      state.redeemLink = { ...state.redeemLink, ...linkPatch };
      await expect(caller().redeem({ token })).rejects.toMatchObject({ code: "NOT_FOUND", message: "This temporary sign-in link is unavailable. Ask your company administrator for a new link." });
      expect(state.session).toBeNull();
      expect(state.audit.at(-1)).toMatchObject({ result: "denied", reasonCode: reason });
      expect(JSON.stringify(state.audit)).not.toContain(token);
    }
  });
});
