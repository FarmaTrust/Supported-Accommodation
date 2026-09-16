import { describe, expect, it } from "vitest";
import { pendingShiftStartHandoverReminders } from "./handoverShiftStartReminders";

const hour = 3_600_000;
const now = Date.UTC(2026, 8, 16, 9, 0, 0);
const activeShift = { id: 10, entityId: 1, propertyId: 5, assignedUserId: 7, startsAt: now - hour, endsAt: now + 7 * hour, status: "assigned" };

function handover(id: number, overrides: Partial<{ propertyId: number; shiftId: number | null; createdBy: number; createdAt: number }> = {}) {
  return { id, entityId: 1, propertyId: 5, shiftId: 9, createdBy: 8, createdAt: now - 2 * hour, ...overrides };
}

describe("shift-start handover reminders", () => {
  it("creates a recipient-specific reminder only after the assigned shift begins", () => {
    const reminder = pendingShiftStartHandoverReminders({ now, userId: 7, shifts: [activeShift], handovers: [handover(22)], acknowledgements: [] });
    expect(reminder).toEqual([{ shiftId: 10, handoverId: 22, entityId: 1, propertyId: 5, recipientUserId: 7, dedupeKey: "handover-shift-start:22:10:7" }]);
    expect(pendingShiftStartHandoverReminders({ now: activeShift.startsAt - 1, userId: 7, shifts: [activeShift], handovers: [handover(22)], acknowledgements: [] })).toEqual([]);
  });

  it("does not remind for an acknowledged, future, self-authored or other-property handover", () => {
    const rows = [handover(1), handover(2, { createdBy: 7 }), handover(3, { propertyId: 6 }), handover(4, { createdAt: now })];
    const result = pendingShiftStartHandoverReminders({ now, userId: 7, shifts: [activeShift], handovers: rows, acknowledgements: [{ handoverId: 1, shiftId: 10, userId: 7 }] });
    expect(result).toEqual([]);
  });

  it("limits notifications to the three latest relevant handovers for a shift", () => {
    const rows = [1, 2, 3, 4].map(id => handover(id, { createdAt: activeShift.startsAt - id * 1000 }));
    const result = pendingShiftStartHandoverReminders({ now, userId: 7, shifts: [activeShift], handovers: rows, acknowledgements: [] });
    expect(result.map(item => item.handoverId)).toEqual([1, 2, 3]);
  });
});
