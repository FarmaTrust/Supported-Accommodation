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

const secret = new TextEncoder().encode("test-secret-value-1234567890");

const token = await new SignJWT({ openId: "u1", appId: "local", name: "Zed", authType: "local", passwordVersion: 3 })
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
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

console.log(
  JSON.stringify(
    {
      token,
      superjson: superjson.serialize(sample),
      auditInput,
      auditNoMeta,
      auditWithMeta,
    },
    null,
    2,
  ),
);
