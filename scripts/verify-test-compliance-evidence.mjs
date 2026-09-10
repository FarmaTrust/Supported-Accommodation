import { execFileSync } from "node:child_process";
import mysql from "mysql2/promise";

const sourceEntityId = Number(process.argv.slice(2).find(value => /^\d+$/.test(value)) ?? 1);
const loader = new URL("./load-test-compliance-evidence.mjs", import.meta.url);
for (let run = 0; run < 2; run++) { execFileSync(process.execPath, [loader.pathname, String(sourceEntityId)], { stdio: "inherit", env: process.env }); execFileSync("pnpm", ["exec", "tsx", "scripts/evaluate-test-compliance-renewals.ts"], { stdio: "inherit", env: process.env }); }
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db = await mysql.createConnection(process.env.DATABASE_URL);
const first = async (sql, params = []) => (await db.execute(sql, params))[0][0];
try {
  const entity = await first("SELECT id FROM entities WHERE legalName='TEST — Training Provider Limited' LIMIT 1");
  if (!entity) throw new Error("TEST entity was not created");
  const propertyRecords = await first("SELECT COUNT(*) AS count FROM propertyEvidence WHERE entityId=? AND title LIKE 'TEST — Mock %'", [entity.id]);
  const staffRecords = await first("SELECT COUNT(*) AS count FROM workforceChecks WHERE entityId=? AND title LIKE 'TEST — Mock %'", [entity.id]);
  const approvedEvidence = await first("SELECT COUNT(*) AS count FROM documents d JOIN documentVersions dv ON dv.documentId=d.id AND dv.version=1 WHERE d.entityId=? AND d.title LIKE 'TEST — Mock %' AND d.status='approved' AND dv.scanStatus='clean'", [entity.id]);
  const notifications = await first("SELECT COUNT(*) AS count FROM notifications WHERE entityId=? AND type='compliance_renewal'", [entity.id]);
  const sourceLeakage = await first("SELECT (SELECT COUNT(*) FROM propertyEvidence WHERE entityId=? AND title LIKE 'TEST — Mock %')+(SELECT COUNT(*) FROM workforceChecks WHERE entityId=? AND title LIKE 'TEST — Mock %')+(SELECT COUNT(*) FROM documents WHERE entityId=? AND title LIKE 'TEST — Mock %') AS count", [sourceEntityId, sourceEntityId, sourceEntityId]);
  const actual = { propertyRecords: Number(propertyRecords.count), staffRecords: Number(staffRecords.count), approvedEvidence: Number(approvedEvidence.count), notifications: Number(notifications.count), sourceLeakage: Number(sourceLeakage.count) };
  const valid = actual.propertyRecords === 42 && actual.staffRecords === 11 && actual.approvedEvidence === 51 && actual.notifications > 0 && actual.sourceLeakage === 0;
  if (!valid) throw new Error(`TEST compliance evidence verification failed: ${JSON.stringify(actual)}`);
  console.log(JSON.stringify({ verified: true, runs: 2, testEntityId: entity.id, ...actual }, null, 2));
} finally { await db.end(); }
