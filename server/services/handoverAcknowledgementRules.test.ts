import { describe, expect, it } from "vitest";
import { assertIncomingHandoverCanBeAcknowledged } from "./handoverAcknowledgementRules";

const currentShift = { id: 44, propertyId: 5, assignedUserId: 8, startsAt: 200_000 };
const handover = { propertyId: 5, shiftId: 43, createdBy: 7, createdAt: new Date(190_000) };

describe("incoming handover acknowledgement rules", () => {
  it("allows the assigned incoming worker to acknowledge a previous handover at the same property", () => {
    expect(() => assertIncomingHandoverCanBeAcknowledged({ currentShift, handover, userId: 8 })).not.toThrow();
  });

  it("rejects an unassigned worker", () => {
    expect(() => assertIncomingHandoverCanBeAcknowledged({ currentShift: { ...currentShift, assignedUserId: 9 }, handover, userId: 8 })).toThrow(/assigned to this shift/);
  });

  it("rejects a different property, own shift handover and later note", () => {
    expect(() => assertIncomingHandoverCanBeAcknowledged({ currentShift, handover: { ...handover, propertyId: 6 }, userId: 8 })).toThrow(/current property/);
    expect(() => assertIncomingHandoverCanBeAcknowledged({ currentShift, handover: { ...handover, createdBy: 8 }, userId: 8 })).toThrow(/own current shift/);
    expect(() => assertIncomingHandoverCanBeAcknowledged({ currentShift, handover: { ...handover, createdAt: new Date(200_001) }, userId: 8 })).toThrow(/previous shift/);
  });
});
