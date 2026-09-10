import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ denied: false, owners: 1, audit: [] as any[] }));
vi.mock("../authz", () => ({ assertEntityCapability: vi.fn(async () => { if (state.denied) throw new Error("Company administration denied"); return { role: "owner", allProperties: true }; }) }));
vi.mock("../services/audit", () => ({ writeAuditEvent: vi.fn(async (event: any) => state.audit.push(event)) }));
import { entityMemberships, propertyAssignments } from "../../drizzle/schema";
const membership = { id: 7, entityId: 1, userId: 20, operationalRole: "owner", allProperties: 1, extraCapabilities: [], status: "active" };
function thenable(value: unknown) { return { then: (resolve: any, reject: any) => Promise.resolve(value).then(resolve, reject) }; }
function buildDb() { return {
  select: () => ({ from: (table: unknown) => { const rows = table === entityMemberships ? Array.from({ length: state.owners }, (_, index) => ({ ...membership, id: 7 + index, userId: 20 + index })) : []; const chain: any = { where: () => chain, limit: async () => table === entityMemberships ? [membership] : [] }; Object.assign(chain, thenable(table === entityMemberships ? rows : [])); return chain; } }),
  transaction: async (callback: any) => callback({ update: () => ({ set: () => ({ where: async () => undefined }) }), delete: () => ({ where: async () => undefined }), insert: () => ({ values: async () => undefined }) }),
}; }
vi.mock("./shared", () => ({ requireDb: async () => buildDb() }));
import { accessControlRouter } from "./accessControl";
function caller() { return accessControlRouter.createCaller({ user: { id: 1, openId: "admin", name: "Company admin", email: "admin@example.test", loginMethod: "test", role: "user", operationalRole: "owner", accountStatus: "active", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: {} as any, res: {} as any } as any); }
const input = () => ({ entityId: 1, targetUserId: 20, role: "registered_manager" as const, allProperties: true, propertyIds: [], extraCapabilities: ["pack.read" as const], reason: "Approved after the recorded company access review." });
describe("access control router", () => {
  beforeEach(() => { state.denied = false; state.owners = 1; state.audit = []; });
  it("denies a caller without company-administrator capability before mutation", async () => { state.denied = true; await expect(caller().updateMemberAccess(input())).rejects.toThrow(/denied/); expect(state.audit).toHaveLength(0); });
  it("rejects invalid role and capability values at the API boundary", async () => { await expect(caller().updateMemberAccess({ ...input(), role: "platform_admin" as any })).rejects.toThrow(); await expect(caller().updateMemberAccess({ ...input(), extraCapabilities: ["finance.issue" as any] })).rejects.toThrow(); });
  it("protects the last active company administrator", async () => { await expect(caller().updateMemberAccess(input())).rejects.toThrow(/last active company administrator/); });
  it("records immutable restricted before/after evidence for a permitted access change", async () => { state.owners = 2; await expect(caller().updateMemberAccess(input())).resolves.toMatchObject({ success: true, next: { role: "registered_manager" } }); expect(state.audit).toHaveLength(1); expect(state.audit[0]).toMatchObject({ action: "access_control.member.update", resourceType: "entity_membership", sensitivity: "restricted", metadata: { targetUserId: 20, previous: { role: "owner" }, next: { role: "registered_manager" } } }); });
});
