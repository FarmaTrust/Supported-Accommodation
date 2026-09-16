import { describe, expect, it } from "vitest";
import { offlineSyncItemSchema } from "./offlineSync";

const base = { idempotencyKey: "11111111-1111-4111-8111-111111111111", clientVersion: 1, clientCreatedAt: 1_000, expiresAt: 2_000, basePlacementUpdatedAt: 900 } as const;
const scope = { entityId: 1, propertyId: 2, placementId: 3 } as const;
const report = { ...base, operation: "key_worker_report", payload: { ...scope, reportType: "daily", reportDate: 1_000, discussions: "A factual discussion record", plan: "Follow up tomorrow", status: "submitted" } } as const;

describe("offline sync contract", () => {
  it("accepts every explicitly supported frontline operation", () => {
    const payloads = [
      report,
      { ...base, operation: "incident", payload: { ...scope, category: "other", severity: "medium", occurredAt: 1_000, summary: "Incident summary", details: "A sufficiently detailed factual incident record." } },
      { ...base, operation: "clock_event", payload: { ...scope, shiftId: 4, eventType: "clock_in", occurredAt: 1_000, locationState: "on_site" } },
      { ...base, operation: "handover", payload: { ...scope, summary: "Shift handover summary", sensitivity: "operational" } },
      { ...base, operation: "visitor_entry", payload: { ...scope, visitorType: "relative", name: "Visitor Name", purpose: "Planned family visit", idCheckStatus: "verified", arrivedAt: 1_000 } },
      { ...base, operation: "curfew_check", payload: { ...scope, curfewPlanId: 5, expectedAt: 1_000, status: "met", escalationRequired: false } },
      { ...base, operation: "missing_episode", payload: { ...scope, missingAt: 900, discoveredAt: 1_000, riskLevel: "high", circumstances: "Young person was not at the expected location.", actions: "Manager and relevant professionals were contacted." } },
      { ...base, operation: "medication_administration", payload: { ...scope, medicationId: 6, outcome: "taken", escalationRequired: false } },
      { ...base, operation: "property_check", payload: { ...scope, checkType: "room_check", authorityBasis: "scheduled", checklist: [{ key: "window", label: "Window secure", result: "pass" }], youngPersonPresent: false, result: "pass" } },
      { ...base, operation: "maintenance_job", payload: { ...scope, title: "Bedroom light", category: "electrical", priority: "routine", description: "Bedroom ceiling light is not working." } },
      { ...base, operation: "resident_finance_transaction", payload: { ...scope, accountId: 7, transactionType: "purchase", amount: 5, purpose: "Travel ticket", expectedAccountVersion: 1, occurredAt: 1_000 } },
      { ...base, operation: "lone_worker_check_in", payload: { ...scope, sessionId: 8, checkInType: "manual", wellbeingStatus: "safe", occurredAt: 1_000, locationState: "on_site", expectedSessionVersion: 1 } },
    ];
    for (const payload of payloads) expect(offlineSyncItemSchema.safeParse(payload).success, payload.operation).toBe(true);
  });

  it("allows the guided learning and enthusiasm fields without broadening the offline payload", () => {
    expect(offlineSyncItemSchema.safeParse({ ...report, payload: { ...report.payload, learning: "Completed a budgeting activity with prompts.", enthusiasm: "Engaged after choosing the activity." } }).success).toBe(true);
  });

  it("rejects broad cached case data, unsupported versions and unknown fields", () => {
    expect(offlineSyncItemSchema.safeParse({ ...report, cachedYoungPerson: { name: "not permitted" } }).success).toBe(false);
    expect(offlineSyncItemSchema.safeParse({ ...report, clientVersion: 2 }).success).toBe(false);
    expect(offlineSyncItemSchema.safeParse({ ...report, payload: { ...report.payload, bankDetails: "not permitted" } }).success).toBe(false);
  });
});
