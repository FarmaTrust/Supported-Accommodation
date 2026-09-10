import { describe, expect, it } from "vitest";
import { buildAuditEnvelope, hashEvent } from "./audit";

describe("audit chain integrity", () => {
  it("produces deterministic hashes for canonical event inputs", () => { const event = { occurredAt: 100, previousHash: null, action: "record.read", resourceType: "placement", metadata: null }; expect(hashEvent(event)).toBe(hashEvent(event)); expect(hashEvent({ ...event, action: "record.update" })).not.toBe(hashEvent(event)); });
  it("links each envelope to the preceding event hash", () => { const first = buildAuditEnvelope({ actorUserId: 4, entityId: 2, action: "placement.read", resourceType: "placement", resourceId: 7, sensitivity: "safeguarding", result: "allowed" }, null, 100); const second = buildAuditEnvelope({ actorUserId: 4, entityId: 2, action: "placement.update", resourceType: "placement", resourceId: 7, sensitivity: "safeguarding", result: "success" }, first.eventHash, 200); expect(first.previousHash).toBeNull(); expect(second.previousHash).toBe(first.eventHash); expect(second.eventHash).not.toBe(first.eventHash); });
  it("changes the hash when security-relevant context changes", () => { const base = { actorUserId: 4, entityId: 2, action: "permission.entity", resourceType: "entity", resourceId: 2, result: "allowed" as const }; const allowed = buildAuditEnvelope(base, "prior", 300); const denied = buildAuditEnvelope({ ...base, result: "denied" }, "prior", 300); expect(denied.eventHash).not.toBe(allowed.eventHash); });
});
