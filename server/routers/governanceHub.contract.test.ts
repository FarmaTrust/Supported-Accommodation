import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  db: null as any,
  caseRecord: null as any,
  regimeRecord: null as any,
  measureRecord: null as any,
  placementDenied: false,
  writes: [] as Array<{ table: unknown; values: unknown }>,
}));

vi.mock("../authz", () => ({
  assertEntityCapability: vi.fn(async () => ({ role: "owner", allProperties: true })),
  assertPlacementCapability: vi.fn(async () => {
    if (state.placementDenied) throw new Error("Placement access denied");
    return { placement: { id: 9, entityId: 1, propertyId: 4 }, access: { role: "owner", allProperties: true } };
  }),
  assertPropertyCapability: vi.fn(async () => ({ role: "owner", allProperties: true })),
  listAccessiblePropertyIds: vi.fn(async () => [4]),
}));
vi.mock("./shared", () => ({ requireDb: async () => state.db }));
vi.mock("../services/audit", () => ({ writeAuditEvent: vi.fn(async () => undefined) }));
vi.mock("../services/crypto", () => ({ encryptSensitive: vi.fn((value: string) => `encrypted:${value}`), decryptSensitive: vi.fn((value: string) => value.replace("encrypted:", "")) }));

import { analyticsMeasures, dataRightsCases, dataRightsEvents, outcomeObservations, regulatoryRegimes } from "../../drizzle/schema";
import { governanceHubRouter } from "./governanceHub";

function buildDb() {
  const db: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === dataRightsCases) return state.caseRecord ? [state.caseRecord] : [];
            if (table === regulatoryRegimes) return state.regimeRecord ? [state.regimeRecord] : [];
            if (table === analyticsMeasures) return state.measureRecord ? [state.measureRecord] : [];
            return [];
          },
          orderBy: async () => [],
        }),
        orderBy: () => ({ limit: async () => [] }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        state.writes.push({ table, values });
        return { $returningId: async () => [{ id: state.writes.length + 10 }] };
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: async () => { state.writes.push({ table, values }); },
      }),
    }),
    transaction: async (callback: (tx: any) => Promise<unknown>) => callback(db),
  };
  return db;
}

function caller(actorId = 1) {
  return governanceHubRouter.createCaller({ user: { id: actorId, openId: "owner", name: "Owner", email: null, loginMethod: "manus", role: "admin", operationalRole: "owner", accountStatus: "active", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: {} as any, res: {} as any } as any);
}

const caseBase = () => ({ id: 21, entityId: 1, placementId: null, status: "identity_check", identityStatus: "pending", createdBy: 2, identityVerifiedBy: null });

describe("governance hub contracts", () => {
  beforeEach(() => { state.caseRecord = null; state.regimeRecord = null; state.measureRecord = null; state.placementDenied = false; state.writes = []; state.db = buildDb(); });

  it("rejects a data-rights case where the response deadline is not after receipt", async () => {
    await expect(caller().createCase({ entityId: 1, caseReference: "DR-2026-001", requestType: "access", requesterType: "young_person", requesterName: "Test Requester", scope: ["all_records"], receivedAt: 200, dueAt: 200 })).rejects.toThrow(/due date must be after/i);
  });

  it("blocks self-verification and invalid data-rights state transitions", async () => {
    state.caseRecord = { ...caseBase(), createdBy: 1 };
    await expect(caller(1).verifyCaseIdentity({ entityId: 1, caseId: 21, status: "verified", method: "Secure identity check" })).rejects.toThrow(/different authorised user/i);
    state.caseRecord = { ...caseBase(), status: "delivered", identityStatus: "verified" };
    await expect(caller().transitionCase({ entityId: 1, caseId: 21, status: "collecting", reasonCode: "records_collected" })).rejects.toThrow(/cannot move/i);
  });

  it("records an independently approved data-rights case only after identity verification", async () => {
    state.caseRecord = { ...caseBase(), status: "awaiting_approval", identityStatus: "verified", createdBy: 2, identityVerifiedBy: 3 };
    await expect(caller(1).approveCase({ entityId: 1, caseId: 21 })).resolves.toEqual({ success: true });
    expect(state.writes.some(item => item.table === dataRightsCases && (item.values as any).status === "ready")).toBe(true);
    expect(state.writes.some(item => item.table === dataRightsEvents && (item.values as any).eventType === "case.approved")).toBe(true);
  });

  it("records delivery evidence only for a ready data-rights case", async () => {
    state.caseRecord = { ...caseBase(), status: "awaiting_approval", identityStatus: "verified" };
    await expect(caller().recordCaseDelivery({ entityId: 1, caseId: 21, method: "secure_link", reference: "DEL-001" })).rejects.toThrow(/only approved, ready cases/i);
    state.caseRecord = { ...caseBase(), status: "ready", identityStatus: "verified" };
    await expect(caller().recordCaseDelivery({ entityId: 1, caseId: 21, method: "secure_link", reference: "DEL-001" })).resolves.toEqual({ success: true });
    expect(state.writes.some(item => item.table === dataRightsCases && (item.values as any).status === "delivered")).toBe(true);
    expect(state.writes.some(item => item.table === dataRightsEvents && (item.values as any).eventType === "case.delivered")).toBe(true);
  });

  it("requires regulatory records to follow review and independent approval stages", async () => {
    state.regimeRecord = { id: 31, entityId: 1, status: "draft", createdBy: 1, approvedBy: null, name: "Test Regulations", jurisdiction: "England" };
    await expect(caller(1).approveRegime({ entityId: 1, regimeId: 31 })).rejects.toThrow(/not ready for approval/i);
    state.regimeRecord = { ...state.regimeRecord, status: "in_review" };
    await expect(caller(1).approveRegime({ entityId: 1, regimeId: 31 })).rejects.toThrow(/different authorised user/i);
    await expect(caller(2).approveRegime({ entityId: 1, regimeId: 31 })).resolves.toEqual({ success: true });
    expect(state.writes.some(item => item.table === regulatoryRegimes && (item.values as any).status === "approved")).toBe(true);
  });

  it("requires a third authorised actor to activate an approved regulatory framework", async () => {
    state.regimeRecord = { id: 31, entityId: 1, status: "approved", createdBy: 2, approvedBy: 3, name: "Test Regulations", jurisdiction: "England" };
    await expect(caller(3).activateRegime({ entityId: 1, regimeId: 31 })).rejects.toThrow(/different authorised user/i);
    await expect(caller(1).activateRegime({ entityId: 1, regimeId: 31 })).resolves.toEqual({ success: true });
    expect(state.writes.some(item => item.table === regulatoryRegimes && (item.values as any).status === "superseded")).toBe(true);
    expect(state.writes.some(item => item.table === regulatoryRegimes && (item.values as any).status === "active")).toBe(true);
  });

  it("blocks outcome observations for inactive measures and invalid periods before writing", async () => {
    state.measureRecord = { id: 41, entityId: 1, status: "draft", createdBy: 2 };
    const input = { entityId: 1, measureId: 41, placementId: 9, periodStart: 100, periodEnd: 200, numericValue: "1", source: "key_worker" as const };
    await expect(caller().recordObservation(input)).rejects.toThrow(/active measures/i);
    state.measureRecord = { ...state.measureRecord, status: "active" };
    await expect(caller().recordObservation({ ...input, periodEnd: 100 })).rejects.toThrow(/period end must be after/i);
    expect(state.writes.some(item => item.table === outcomeObservations)).toBe(false);
  });

  it("enforces placement scope before recording an otherwise valid outcome observation", async () => {
    state.measureRecord = { id: 41, entityId: 1, status: "active", createdBy: 2 };
    state.placementDenied = true;
    await expect(caller().recordObservation({ entityId: 1, measureId: 41, placementId: 9, periodStart: 100, periodEnd: 200, numericValue: "1", source: "key_worker" })).rejects.toThrow(/placement access denied/i);
    expect(state.writes.some(item => item.table === outcomeObservations)).toBe(false);
  });

  it("requires independent measure activation and supports controlled pause", async () => {
    state.measureRecord = { id: 41, entityId: 1, status: "draft", createdBy: 1 };
    await expect(caller(1).activateMeasure({ entityId: 1, measureId: 41 })).rejects.toThrow(/different authorised user/i);
    await expect(caller(2).activateMeasure({ entityId: 1, measureId: 41 })).resolves.toEqual({ success: true });
    expect(state.writes.some(item => item.table === analyticsMeasures && (item.values as any).status === "active")).toBe(true);
    state.measureRecord = { ...state.measureRecord, status: "active" };
    await expect(caller(2).pauseMeasure({ entityId: 1, measureId: 41 })).resolves.toEqual({ success: true });
    expect(state.writes.some(item => item.table === analyticsMeasures && (item.values as any).status === "paused")).toBe(true);
  });
});
