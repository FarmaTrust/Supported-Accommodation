import { describe, expect, it } from "vitest";
import { assertManagerRole, assertRecordState, requireAttendanceOverride, workspaceFieldError } from "./workspaceGuards";

describe("workspace guards", () => {
  it("returns stable field-level business validation metadata", () => {
    const error = workspaceFieldError("date_required", "occurredAt", "Date is required");
    expect(error.code).toBe("BAD_REQUEST");
    expect((error as typeof error & { workspaceError: unknown }).workspaceError).toEqual({ code: "date_required", fieldErrors: { occurredAt: ["Date is required"] } });
  });

  it("gates record states and Manager-only decisions", () => {
    expect(() => assertRecordState("submitted", ["submitted"])).not.toThrow();
    expect(() => assertRecordState("locked", ["submitted"])).toThrow(/not available/);
    expect(() => assertManagerRole("registered_manager")).not.toThrow();
    expect(() => assertManagerRole("support_worker")).toThrow(/Manager access/);
  });

  it("requires an override reason whenever verified on-site location is unavailable", () => {
    expect(() => requireAttendanceOverride({ locationState: "on_site" })).not.toThrow();
    expect(() => requireAttendanceOverride({ locationState: "off_site" })).toThrow(/requires a reason/);
    expect(() => requireAttendanceOverride({ locationState: "manual", overrideReason: "Device location permission was unavailable" })).not.toThrow();
  });
});
