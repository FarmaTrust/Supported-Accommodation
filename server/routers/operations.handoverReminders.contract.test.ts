import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./operations.ts", import.meta.url), "utf8");

describe("shift-start handover reminder delivery", () => {
  it("derives reminders only through the server-side shift query and writes user-scoped notifications", () => {
    expect(source).toContain("pendingShiftStartHandoverReminders");
    expect(source).toContain("shift.assignedUserId === ctx.user.id");
    expect(source).toContain("eq(handoverAcknowledgements.userId, ctx.user.id)");
    expect(source).toContain("eq(notifications.userId, ctx.user.id)");
    expect(source).toContain('type: "handover_acknowledgement"');
    expect(source).toContain('action: "handover.shift_start_reminder"');
  });
});
