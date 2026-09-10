import { createHash } from "node:crypto";
import { desc } from "drizzle-orm";
import { auditLogs, auditReceiptMirrors } from "../../drizzle/schema";
import { getDb } from "../db";
import { storagePut } from "../storage";

type AuditInput = {
  actorUserId?: number;
  actorType?: "user" | "scheduled_job" | "system" | "secure_link";
  entityId?: number;
  propertyId?: number;
  action: string;
  resourceType: string;
  resourceId?: string | number;
  sensitivity?: "general" | "hr" | "finance" | "safeguarding" | "bank" | "restricted";
  result: "allowed" | "denied" | "success" | "failure";
  reasonCode?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
};

export function hashEvent(payload: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildAuditEnvelope(input: AuditInput, previousHash: string | null, occurredAt: number) {
  const eventHash = hashEvent({ occurredAt, previousHash, ...input, metadata: input.metadata ?? null });
  return { occurredAt, previousHash, eventHash, actorUserId: input.actorUserId ?? null, actorType: input.actorType ?? "user", entityId: input.entityId ?? null, propertyId: input.propertyId ?? null, action: input.action, resourceType: input.resourceType, resourceId: input.resourceId === undefined ? null : String(input.resourceId), sensitivity: input.sensitivity ?? "general", result: input.result, reasonCode: input.reasonCode ?? null, correlationId: input.correlationId ?? null };
}

export async function writeAuditEvent(input: AuditInput) {
  const db = await getDb();
  if (!db) return;
  const [latest] = await db.select({ eventHash: auditLogs.eventHash }).from(auditLogs).orderBy(desc(auditLogs.id)).limit(1);
  const occurredAt = Date.now();
  const previousHash = latest?.eventHash ?? null;
  const envelope = buildAuditEnvelope(input, previousHash, occurredAt); const eventHash = envelope.eventHash;
  const [record] = await db.insert(auditLogs).values({
    occurredAt,
    actorUserId: input.actorUserId,
    actorType: input.actorType ?? "user",
    entityId: input.entityId,
    propertyId: input.propertyId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId === undefined ? null : String(input.resourceId),
    sensitivity: input.sensitivity ?? "general",
    result: input.result,
    reasonCode: input.reasonCode,
    correlationId: input.correlationId,
    metadata: input.metadata,
    previousHash,
    eventHash,
  }).$returningId();
  const receipt = {
    schemaVersion: 1,
    auditEventId: record.id,
    ...envelope,
  };
  try {
    const day = new Date(occurredAt).toISOString().slice(0, 10);
    const stored=await storagePut(`audit-receipts/${input.entityId ?? "platform"}/${day}/${record.id}-${eventHash}.json`, JSON.stringify(receipt), "application/json");
    await db.insert(auditReceiptMirrors).values({auditEventId:record.id,entityId:input.entityId,storageKey:stored.key,eventHash,status:"stored"}).onDuplicateKeyUpdate({set:{storageKey:stored.key,eventHash,status:"stored"}});
  } catch (error) {
    console.error("[Audit] Object receipt mirror failed", { auditEventId: record.id, error });
  }
}
