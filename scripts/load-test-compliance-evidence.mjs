import "dotenv/config";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const scenario = JSON.parse(await readFile(new URL("./fictional-scenario.json", import.meta.url), "utf8"));
const sourceEntityId = Number(process.argv.slice(2).find(value => /^\d+$/.test(value)) ?? 1);
const DAY = 86_400_000;
const TEST_ENTITY = "TEST — Training Provider Limited";
const propertyRecords = [
  ["hmo_licence", "licence", "HMO licence", "Property — HMO licences"],
  ["ofsted_registration", "licence", "Ofsted registration / renewal", "Property — Ofsted"],
  ["gas_safety", "gas_safety", "Gas safety certificate", "Property — Gas safety"],
  ["electrical_safety", "electrical_safety", "Electrical safety certificate", "Property — Electrical safety"],
  ["fire_safety", "fire_risk", "Fire safety certificate", "Property — Fire safety"],
  ["insurance", "insurance", "Property insurance certificate", "Property — Insurance"],
  ["other_certificate", "certificate", "Other legal / regulatory certificate", "Property — Other legal certificates"],
];
const staffRecords = [
  ["dbs", "dbs", "DBS certificate", "Staff — DBS and Right to Work"],
  ["right_to_work", "right_to_work", "Right to Work", "Staff — DBS and Right to Work"],
  ["safeguarding", "training", "Safeguarding training", "Staff — Safeguarding"],
  ["first_aid", "training", "First aid training", "Staff — First aid"],
  ["medication", "training", "Medication training", "Staff — Medication"],
  ["fire_safety", "training", "Fire safety training", "Staff — Fire safety"],
  ["food_hygiene", "training", "Food hygiene training", "Staff — Food hygiene"],
  ["manual_handling", "training", "Manual handling training", "Staff — Manual handling"],
  ["other_training", "training", "Other certificate / training", "Staff — Other training"],
];
const propertyOffsets = [-8, 18, 47, 78, 200, null, 365];
const staffOffsets = [-14, 15, 45, 75, 210, null, 120, 30, 60, 90, 180];
const keyPart = value => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const dueAtFor = (offset, now) => offset === null ? null : now + offset * DAY;
const statusFor = (dueAt, evidence, now) => !evidence ? "action_required" : !dueAt || dueAt > now + 30 * DAY ? "valid" : dueAt < now ? "expired" : "due_soon";

async function makePdf({ title, reference, subject, dueAt }) {
  const pdf = await PDFDocument.create(); const page = pdf.addPage([595, 842]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold); const regular = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 36, y: 740, width: 523, height: 58, color: rgb(0.84, 0.06, 0.10) });
  page.drawText("TEST DATA — NOT VALID FOR USE", { x: 74, y: 762, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText(title, { x: 48, y: 665, size: 18, font: bold, color: rgb(0.06, 0.13, 0.23), maxWidth: 500 });
  [["Subject", subject], ["Reference", reference], ["Issue date", "01/01/2026"], ["Expiry / review", dueAt ? new Date(dueAt).toLocaleDateString("en-GB") : "No date — TEST scenario"]].forEach(([label, value], index) => page.drawText(`${label}: ${value}`, { x: 48, y: 610 - index * 28, size: 12, font: regular, color: rgb(0.1, 0.1, 0.1) }));
  page.drawText("Issuer: TEST — Northshire Training & Safety Services", { x: 48, y: 470, size: 11, font: regular, color: rgb(0.1, 0.1, 0.1) });
  page.drawText("Fictional interface evidence only. Do not rely on, submit or share this document externally.", { x: 48, y: 438, size: 10, font: regular, color: rgb(0.48, 0.04, 0.08), maxWidth: 500 });
  return pdf.save();
}

async function putTestPdf(title, bytes) {
  const base = process.env.BUILT_IN_FORGE_API_URL; const token = process.env.BUILT_IN_FORGE_API_KEY;
  if (!base || !token) throw new Error("Built-in object storage is unavailable");
  const key = `test-training-evidence/${scenario.key}/${keyPart(title)}.pdf`;
  const presign = new URL("v1/storage/presign/put", `${base.replace(/\/+$/, "")}/`); presign.searchParams.set("path", key);
  const response = await fetch(presign, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Storage presign failed (${response.status})`);
  const { url } = await response.json(); const uploaded = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: bytes });
  if (!uploaded.ok) throw new Error(`Storage upload failed (${uploaded.status})`);
  return { key, url: `/manus-storage/${key}` };
}

execFileSync(process.execPath, [new URL("./load-fictional-test-data.mjs", import.meta.url).pathname, String(sourceEntityId)], { stdio: "inherit", env: process.env });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db = await mysql.createConnection(process.env.DATABASE_URL);
const first = async (sql, params = []) => (await db.execute(sql, params))[0][0];
const now = Date.now();

try {
  await db.beginTransaction();
  const entity = await first("SELECT id FROM entities WHERE legalName=? LIMIT 1", [TEST_ENTITY]);
  if (!entity) throw new Error("TEST entity missing");
  const owner = await first("SELECT userId FROM entityMemberships WHERE entityId=? AND operationalRole='owner' AND status='active' LIMIT 1", [entity.id]);
  if (!owner) throw new Error("TEST owner missing");
  const properties = (await db.execute("SELECT id,name FROM properties WHERE entityId=? AND name LIKE 'TEST — %' ORDER BY id", [entity.id]))[0];
  const profiles = (await db.execute("SELECT id,employeeNumber,fullName FROM staffProfiles WHERE entityId=? AND employeeNumber LIKE 'TEST-KW-%' ORDER BY employeeNumber", [entity.id]))[0];
  if (properties.length !== scenario.properties.length || profiles.length !== scenario.workers.length) throw new Error("TEST scenario is incomplete");
  const folders = new Map();
  async function documentFor({ title, folder, classification, propertyId, dueAt, reference, subject }) {
    const folderKey = `${classification}:${folder}`; let folderId = folders.get(folderKey);
    if (!folderId) { let existing = await first("SELECT id FROM documentFolders WHERE entityId=? AND parentFolderId IS NULL AND name=? LIMIT 1", [entity.id, folder]); if (!existing) { const [result] = await db.execute("INSERT INTO documentFolders (entityId,parentFolderId,name,classification,createdBy) VALUES (?,NULL,?,?,?)", [entity.id, folder, classification, owner.userId]); existing = { id: result.insertId }; } folderId = existing.id; folders.set(folderKey, folderId); }
    let document = await first("SELECT id FROM documents WHERE entityId=? AND title=? LIMIT 1", [entity.id, title]);
    if (!document) { const [result] = await db.execute("INSERT INTO documents (entityId,propertyId,folderId,title,documentType,classification,status,currentVersion,reviewDueAt,createdBy) VALUES (?,?,?,?, 'certificate',?,'approved',1,?,?)", [entity.id, propertyId, folderId, title, classification, dueAt, owner.userId]); document = { id: result.insertId }; }
    else await db.execute("UPDATE documents SET propertyId=?,folderId=?,classification=?,status='approved',reviewDueAt=? WHERE id=?", [propertyId, folderId, classification, dueAt, document.id]);
    const bytes = await makePdf({ title, reference, subject, dueAt }); const stored = await putTestPdf(title, bytes); const hash = createHash("sha256").update(bytes).digest("hex");
    await db.execute("INSERT INTO documentVersions (documentId,version,fileKey,fileUrl,fileName,mimeType,sizeBytes,contentHash,scanStatus,changeSummary,approvedAt,approvedBy,createdBy) VALUES (?,1,?,?,?,?,?,?, 'clean',?,?,?,?) ON DUPLICATE KEY UPDATE fileKey=VALUES(fileKey),fileUrl=VALUES(fileUrl),fileName=VALUES(fileName),mimeType=VALUES(mimeType),sizeBytes=VALUES(sizeBytes),contentHash=VALUES(contentHash),scanStatus='clean',changeSummary=VALUES(changeSummary),approvedAt=VALUES(approvedAt),approvedBy=VALUES(approvedBy)", [document.id, stored.key, stored.url, `${keyPart(title)}.pdf`, "application/pdf", bytes.length, hash, "TEST DATA — NOT VALID FOR USE", now, owner.userId, owner.userId]);
    return document.id;
  }
  for (let p = 0; p < properties.length; p++) for (let c = 0; c < propertyRecords.length; c++) {
    const [kind, recordType, label, folder] = propertyRecords[c]; const dueAt = dueAtFor(propertyOffsets[(p + c) % propertyOffsets.length], now); const evidence = !(kind === "other_certificate" && p === 1); const title = `TEST — Mock ${label} — ${properties[p].name}`; const reference = `TEST-PROP-${String(p + 1).padStart(2, "0")}-${String(c + 1).padStart(2, "0")}`; const documentId = evidence ? await documentFor({ title, folder, classification: "general", propertyId: properties[p].id, dueAt, reference, subject: properties[p].name }) : null;
    const existing = await first("SELECT id FROM propertyEvidence WHERE entityId=? AND propertyId=? AND title=? LIMIT 1", [entity.id, properties[p].id, title]); const values = [recordType, "TEST — Northshire Compliance Services", reference, Date.UTC(2026, 0, 1), dueAt, owner.userId, statusFor(dueAt, evidence, now), JSON.stringify({ propertyComplianceKind: kind, testData: true, invalidForUse: true, scenario: scenario.key }), documentId, owner.userId];
    if (existing) await db.execute("UPDATE propertyEvidence SET recordType=?,providerName=?,reference=?,issuedAt=?,dueAt=?,ownerUserId=?,status=?,details=?,documentId=?,createdBy=? WHERE id=?", [...values, existing.id]); else await db.execute("INSERT INTO propertyEvidence (entityId,propertyId,recordType,title,providerName,reference,issuedAt,dueAt,ownerUserId,status,details,documentId,createdBy) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [entity.id, properties[p].id, recordType, title, ...values.slice(1)]);
  }
  for (let s = 0; s < profiles.length; s++) {
    const [category, checkType, label, folder] = staffRecords[s % staffRecords.length]; const dueAt = dueAtFor(staffOffsets[s], now); const evidence = s !== 5; const title = `TEST — Mock ${label} — ${profiles[s].fullName}`; const reference = `TEST-STAFF-${profiles[s].employeeNumber}-${category.toUpperCase()}`; const documentId = evidence ? await documentFor({ title, folder, classification: "hr", propertyId: null, dueAt, reference, subject: profiles[s].fullName }) : null; const status = !evidence ? "missing" : !dueAt || dueAt > now + 90 * DAY ? "valid" : dueAt < now ? "expired" : "expiring";
    const existing = await first("SELECT id FROM workforceChecks WHERE entityId=? AND staffProfileId=? AND title=? LIMIT 1", [entity.id, profiles[s].id, title]); const values = [checkType, reference, category, Date.UTC(2026, 0, 1), dueAt, documentId ? now : null, documentId ? owner.userId : null, status, documentId, "TEST DATA — NOT VALID FOR USE. Fictional training evidence only.", owner.userId];
    if (existing) await db.execute("UPDATE workforceChecks SET checkType=?,reference=?,level=?,issuedAt=?,expiresAt=?,verifiedAt=?,verifiedBy=?,status=?,evidenceDocumentId=?,notes=?,createdBy=? WHERE id=?", [...values, existing.id]); else await db.execute("INSERT INTO workforceChecks (entityId,staffProfileId,checkType,title,reference,level,issuedAt,expiresAt,verifiedAt,verifiedBy,status,evidenceDocumentId,notes,createdBy) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [entity.id, profiles[s].id, checkType, title, ...values.slice(1)]);
  }
  await db.commit();
  console.log(JSON.stringify({ scenario: scenario.key, entityId: entity.id, propertyCertificates: properties.length * propertyRecords.length, staffCertificates: profiles.length }, null, 2));
} catch (error) { await db.rollback(); throw error; } finally { await db.end(); }
