import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const scenario = JSON.parse(await readFile(new URL("./fictional-scenario.json", import.meta.url), "utf8"));
const sourceEntityId = Number(process.argv.slice(2).find(value => /^\d+$/.test(value)) ?? 1);
const loader = new URL("./load-fictional-test-data.mjs", import.meta.url);
for (let run = 0; run < 2; run++) execFileSync(process.execPath, [loader.pathname, String(sourceEntityId)], { stdio: "inherit", env: process.env });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db = await mysql.createConnection(process.env.DATABASE_URL);
const first = async (sql, params = []) => (await db.execute(sql, params))[0][0];
try {
  const entity = await first("SELECT id FROM entities WHERE legalName='TEST — Training Provider Limited' LIMIT 1");
  if (!entity) throw new Error("TEST entity was not created");
  const properties = await first("SELECT COUNT(*) AS count FROM properties WHERE entityId=?", [entity.id]);
  const workers = await first("SELECT COUNT(DISTINCT u.id) AS count FROM users u JOIN entityMemberships em ON em.userId=u.id WHERE em.entityId=? AND u.openId LIKE 'test-sa-training-2026-kw-%' AND em.status='active'", [entity.id]);
  const youngPeople = await first("SELECT COUNT(*) AS count FROM youngPeople WHERE entityId=? AND reference LIKE 'TEST-YP-%'", [entity.id]);
  const shifts = await first("SELECT COUNT(*) AS count FROM shifts WHERE entityId=? AND notes='TEST-SA-TRAINING-2026'", [entity.id]);
  const [distribution] = await db.execute("SELECT p.id,COUNT(DISTINCT yp.id) AS count FROM properties p LEFT JOIN placements pl ON pl.propertyId=p.id AND pl.status='active' LEFT JOIN youngPeople yp ON yp.id=pl.youngPersonId AND yp.reference LIKE 'TEST-YP-%' WHERE p.entityId=? GROUP BY p.id", [entity.id]);
  const sourceLeakage = await first("SELECT (SELECT COUNT(*) FROM youngPeople WHERE entityId=? AND reference LIKE 'TEST-YP-%')+(SELECT COUNT(*) FROM shifts WHERE entityId=? AND notes='TEST-SA-TRAINING-2026')+(SELECT COUNT(*) FROM properties WHERE entityId=? AND name LIKE 'TEST — %') AS count", [sourceEntityId, sourceEntityId, sourceEntityId]);
  const actual = { properties: Number(properties.count), keyWorkers: Number(workers.count), youngPeople: Number(youngPeople.count), shifts: Number(shifts.count), distribution: distribution.map(row => Number(row.count)), sourceLeakage: Number(sourceLeakage.count) };
  const valid = actual.properties === scenario.properties.length && actual.keyWorkers === scenario.workers.length && actual.youngPeople === scenario.youngPeople.length && actual.shifts === scenario.properties.length * 14 && actual.distribution.length === scenario.properties.length && actual.distribution.every(count => count === 3) && actual.sourceLeakage === 0;
  if (!valid) throw new Error(`Fictional scenario idempotency failed: ${JSON.stringify(actual)}`);
  console.log(JSON.stringify({ verified: true, runs: 2, testEntityId: entity.id, ...actual }, null, 2));
} finally { await db.end(); }
