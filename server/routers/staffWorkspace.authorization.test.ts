import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ entityDenied: false, manager: false, propertyDenied: false, placementDenied: false, selectResults: [] as any[], inserted: [] as any[] }));

vi.mock("../authz", () => ({
  assertEntityCapability: vi.fn(async () => {
    if (state.entityDenied) throw new Error("Staff self-service access denied");
    return { role: state.manager ? "registered_manager" : "support_worker", allProperties: false };
  }),
  assertPropertyCapability: vi.fn(async () => {
    if (state.propertyDenied) throw new Error("Property access denied");
    return { role: "support_worker", allProperties: false };
  }),
  assertPlacementCapability: vi.fn(async () => {
    if (state.placementDenied) throw new Error("You are not assigned to this young person");
    return { placement: { id: 3, entityId: 1, propertyId: 2 }, access: { role: "support_worker", allProperties: false } };
  }),
  getUserAccess: vi.fn(async () => ({ user: { operationalRole: "support_worker" }, memberships: [{ entityId: 1, operationalRole: "support_worker" }] })),
  listAccessiblePropertyIds: vi.fn(async () => [2]),
}));
vi.mock("../services/workspaceGuards", async importOriginal => ({
  ...(await importOriginal<typeof import("../services/workspaceGuards")>()),
  assertHrAccess: vi.fn(async () => undefined),
}));
vi.mock("./shared", () => ({
  requireDb: vi.fn(async () => {
    const transactionDb = {
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      insert: () => ({ values: (values: any) => { state.inserted.push(values); return { onDuplicateKeyUpdate: async () => undefined, $returningId: async () => [{ id: state.inserted.length }] }; } }),
    };
    return {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => state.selectResults.length ? [state.selectResults.shift()] : [] }) }) }),
      ...transactionDb,
      transaction: async (callback: (tx: typeof transactionDb) => Promise<void>) => callback(transactionDb),
    };
  }),
}));
vi.mock("../services/audit", () => ({ writeAuditEvent: vi.fn(async () => undefined) }));
vi.mock("../storage", () => ({ storagePut: vi.fn(async () => { throw new Error("Storage should not be reached after denied authorization"); }) }));

import { staffWorkspaceRouter } from "./staffWorkspace";

function caller() {
  return staffWorkspaceRouter.createCaller({ user: { id: 7, openId: "worker-7", name: "Worker", email: null, loginMethod: null, role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: {} as any, res: {} as any } as any);
}

describe("staff workspace procedure authorization", () => {
  beforeEach(() => { state.entityDenied = false; state.manager = false; state.propertyDenied = false; state.placementDenied = false; state.selectResults = []; state.inserted = []; });

  it("blocks the restored self-service workspace when staff capability is denied", async () => {
    state.entityDenied = true;
    await expect(caller().staffWorkspace({ entityId: 1 })).rejects.toThrow(/Staff self-service access denied/);
  });

  it("blocks the Manager app queue before any operational record is read when the caller is not a manager", async () => {
    await expect(caller().managerQueue({ entityId: 1 })).rejects.toThrow(/Manager access required/);
  });

  it("returns a safe no-profile response when a permitted user has no linked staff record", async () => {
    await expect(caller().staffWorkspace({ entityId: 1 })).resolves.toEqual({ profile: null, requests: [], supervisions: [] });
  });

  it("creates an in-app outcome alert only for the staff member whose request was independently approved", async () => {
    state.manager = true;
    state.selectResults = [{ id: 55, entityId: 1, userId: 71, createdBy: 71, status: "submitted", version: 4 }];
    await expect(caller().reviewStaffRequest({ entityId: 1, requestId: 55, decision: "approved", expectedVersion: 4 })).resolves.toEqual({ success: true, notificationQueued: true });
    expect(state.inserted).toContainEqual(expect.objectContaining({ entityId: 1, userId: 71, type: "staff_request_outcome", title: "Staff request approved", resourceType: "staff_request", resourceId: 55, deepLink: "/staff", acknowledgementRequired: 0, dedupeKey: "staff-request-outcome:55:v5" }));
  });

  it("blocks visitor and evidence operations when property assignment is denied", async () => {
    state.propertyDenied = true;
    await expect(caller().arriveVisitor({ entityId: 1, propertyId: 2, visitorType: "relative", name: "Visitor", purpose: "Family visit", idCheckStatus: "verified" })).rejects.toThrow(/Property access denied/);
    await expect(caller().uploadEvidence({ entityId: 1, propertyId: 2, title: "Incident evidence", fileName: "photo.jpg", mimeType: "image/jpeg", contentBase64: "ZmFrZQ==", documentType: "evidence", classification: "general" })).rejects.toThrow(/Property access denied/);
  });

  it("creates an encrypted visitor arrival only after the authorised property check", async () => {
    await expect(caller().arriveVisitor({ entityId: 1, propertyId: 2, visitorType: "professional", name: "Fictional professional", purpose: "Planned review", idCheckStatus: "verified" })).resolves.toEqual({ id: 1 });
    expect(state.inserted).toContainEqual(expect.objectContaining({ entityId: 1, propertyId: 2, visitorType: "professional", arrivedAt: expect.any(Number), createdBy: 7 }));
    expect(state.inserted.some(value => value.name === "Fictional professional")).toBe(false);
  });

  it("blocks young-person notes when the active placement assignment is absent", async () => {
    state.placementDenied = true;
    await expect(caller().createDailyNote({ entityId: 1, propertyId: 2, placementId: 3, noteType: "observation", observedAt: Date.now(), content: "Factual observation", status: "submitted" })).rejects.toThrow(/not assigned/);
  });

  it("blocks Keyworkers from Manager-only restricted investigations", async () => {
    await expect(caller().createInvestigation({ entityId: 1, investigationType: "safeguarding", terms: "Independent safeguarding investigation terms", leadUserId: 8 })).rejects.toThrow(/Manager access required/);
  });

  it("blocks document links when the parent property is outside the Keyworker assignment", async () => {
    state.selectResults = [{ entityId: 1, propertyId: 2 }]; state.propertyDenied = true;
    await expect(caller().linkDocument({ entityId: 1, documentId: 4, resourceType: "incident", resourceId: "5", linkType: "evidence" })).rejects.toThrow(/Property access denied/);
  });

  it("blocks restricted document linking for a non-Manager Keyworker", async () => {
    state.selectResults = [{ entityId: 1, propertyId: 2 }, { id: 4, entityId: 1, classification: "restricted" }];
    await expect(caller().linkDocument({ entityId: 1, documentId: 4, resourceType: "incident", resourceId: "5", linkType: "evidence" })).rejects.toThrow(/Manager access is required/);
  });

  it("requires a correction addendum when report sources change after submission", async () => {
    state.selectResults = [{ id: 6, entityId: 1, placementId: 3, status: "submitted" }];
    await expect(caller().linkReportSource({ entityId: 1, reportId: 6, sourceType: "daily_note", sourceId: "12", linkReason: "included" })).rejects.toThrow(/approved correction addendum/);
  });

  it("requires a correction addendum when incident details change after review starts", async () => {
    state.selectResults = [{ id: 5, entityId: 1, propertyId: 2, managerReviewState: "in_review" }];
    await expect(caller().addIncidentPerson({ entityId: 1, incidentId: 5, personType: "staff", involvement: "witness", name: "Witness" })).rejects.toThrow(/approved correction/);
  });
});
