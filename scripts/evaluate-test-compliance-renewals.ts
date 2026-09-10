import "dotenv/config";
import mysql from "mysql2/promise";
import { runComplianceRenewalEvaluation } from "../server/services/complianceRenewals";

const requestedEntityId = Number(process.argv.slice(2).find(value => /^\d+$/.test(value)));
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const [rows] = await db.execute("SELECT id FROM entities WHERE legalName='TEST — Training Provider Limited' LIMIT 1");
  const entityId = requestedEntityId || (rows as Array<{ id: number }>)[0]?.id;
  if (!entityId) throw new Error("TEST entity was not found");
  console.log(JSON.stringify(await runComplianceRenewalEvaluation(entityId), null, 2));
} finally { await db.end(); }
process.exit(0);
