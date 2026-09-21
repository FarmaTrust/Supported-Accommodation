/**
 * Captures real output from the Node runtime so the PHP self-check compares
 * against the actual wire and hash formats rather than against assumptions.
 * The audit envelope is built by importing the production function, so a change
 * to the hashed shape fails the PHP tests instead of silently forking the chain.
 *
 * Usage: npx tsx php/tests/make-fixture.ts > php/tests/fixture.json
 */
import { SignJWT } from "jose";
import superjson from "superjson";
import { buildAuditEnvelope } from "../../server/services/audit";
import { allCapabilities, roleCapabilities } from "../../server/authz";
import { encryptSensitive } from "../../server/services/crypto";
import { assertWorkspaceTransition } from "../../server/services/staffWorkspacePolicy";

// Never the real JWT_SECRET: this fixture is committed, so it carries a dummy
// secret and the encryption sample is produced with the same one.
const TEST_SECRET = "test-secret-value-1234567890";
const secret = new TextEncoder().encode(TEST_SECRET);

const claims = { openId: "u1", appId: "local", name: "Zed", authType: "local", passwordVersion: 3 };

// Far-future expiry on purpose. A fixture generated with a short life starts
// failing an hour after it is written, which looks like a real regression.
const token = await new SignJWT(claims)
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setExpirationTime("20y")
  .sign(secret);

// Expiry is still covered, against a token jose itself considers stale.
const expiredToken = await new SignJWT(claims)
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
  .sign(secret);

const sample = {
  id: 7,
  name: "Ali",
  when: new Date("2026-02-03T04:05:06.789Z"),
  nested: { at: new Date("2020-01-01T00:00:00.000Z"), ok: true },
  list: [1, "two", null],
};

// Mirrors the localAuth.login call site, including its key order, plus a
// metadata payload with the characters PHP and JavaScript escape differently.
const auditInput = {
  actorUserId: 42,
  action: "auth.local.login",
  resourceType: "session",
  resourceId: 42,
  sensitivity: "restricted" as const,
  result: "success" as const,
  reasonCode: "email_password_verified",
};

const auditNoMeta = buildAuditEnvelope(auditInput, null, 1789000000000);
const auditWithMeta = buildAuditEnvelope(
  { ...auditInput, metadata: { path: "/reports/a b", note: "café — naïve", count: 3 } },
  auditNoMeta.eventHash,
  1789000000001,
);

const DOMAIN_STATES: Record<string, string[]> = {
  report: ["draft", "submitted", "reviewed", "returned", "approved", "locked"],
  incident: ["pending", "in_review", "returned", "approved", "closed"],
  property_check: ["draft", "submitted", "reviewed", "returned", "closed"],
  maintenance: ["reported", "triaged", "assigned", "scheduled", "in_progress", "completed", "verified", "cancelled", "reopened"],
  staff_request: ["draft", "submitted", "returned", "approved", "declined", "withdrawn"],
  supervision: ["scheduled", "draft", "submitted", "acknowledged", "completed", "cancelled"],
  investigation: ["open", "evidence_gathering", "awaiting_response", "review", "action_plan", "closed", "cancelled"],
  medication_discrepancy: ["open", "under_review", "action_required", "resolved", "closed"],
  finance_transaction: ["draft", "submitted", "approved", "returned", "reversed"],
  finance_reconciliation: ["draft", "submitted", "balanced", "discrepancy", "returned", "approved"],
  finance_discrepancy: ["open", "under_review", "action_required", "resolved", "closed"],
};

// Probe every state pair through the real guard, so the fixture records what the
// Node implementation actually permits rather than what its table appears to say.
const workspaceTransitions: Record<string, Record<string, string[]>> = {};
for (const [domain, states] of Object.entries(DOMAIN_STATES)) {
  workspaceTransitions[domain] = {};
  for (const from of states) {
    workspaceTransitions[domain][from] = states.filter(to => {
      try { assertWorkspaceTransition(domain as never, from, to); return true; } catch { return false; }
    });
  }
}

console.log(
  JSON.stringify(
    {
      token,
      expiredToken,
      superjson: superjson.serialize(sample),
      auditInput,
      auditNoMeta,
      auditWithMeta,
      // The role matrix is security-critical: the PHP copy is compared against
      // these exact sets rather than against a reading of the source.
      // Encrypted by the Node implementation with JWT_SECRET below, so the
      // PHP side proves it can read what Node wrote.
      cryptoSecret: TEST_SECRET,
      cryptoPlaintext: "12-34-56",
      cryptoCiphertext: encryptSensitive("12-34-56"),
      // The workflow state machines decide what a manager may do to a record
      // next, so the PHP copy is compared move by move rather than by eye.
      workspaceTransitions,
      allCapabilities,
      roleCapabilities: Object.fromEntries(
        Object.entries(roleCapabilities).map(([role, caps]) => [role, [...caps].sort()]),
      ),
    },
    null,
    2,
  ),
);
