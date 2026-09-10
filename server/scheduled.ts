import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { automationRules } from "../drizzle/schema";
import { getDb } from "./db";
import { sdk } from "./_core/sdk";
import { markAutomationRun, runAutomationEvaluation } from "./services/automation";

export async function runOperationsAutomation(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const [rule] = await db.select().from(automationRules).where(eq(automationRules.scheduleCronTaskUid, user.taskUid)).limit(1);
    if (!rule || !rule.enabled) return res.json({ ok: true, skipped: rule ? "disabled" : "orphan" });
    const result = await runAutomationEvaluation(rule.entityId);
    await markAutomationRun(user.taskUid);
    return res.json({ ok: true, ...result });
  } catch (error) {
    const detail = error instanceof Error ? { error: error.message, stack: error.stack } : { error: String(error) };
    return res.status(500).json({ ...detail, context: { url: req.originalUrl }, timestamp: new Date().toISOString() });
  }
}
