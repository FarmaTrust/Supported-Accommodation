import { describe, expect, it } from "vitest";
import { assertExpectedVersion, assertIndependentReviewer, assertWorkspaceTransition, calculateSignedAmount, notificationChannels, safeNotificationPreview } from "./staffWorkspacePolicy";

describe("staff workspace policy", () => {
  it("allows defined workflow transitions and rejects state skipping", () => {
    expect(() => assertWorkspaceTransition("maintenance", "reported", "triaged")).not.toThrow();
    expect(() => assertWorkspaceTransition("maintenance", "reported", "verified")).toThrow(/Invalid maintenance transition/);
    expect(() => assertWorkspaceTransition("report", "approved", "locked")).not.toThrow();
  });

  it("detects stale device versions", () => {
    expect(() => assertExpectedVersion(3, 3)).not.toThrow();
    try { assertExpectedVersion(4, 3); } catch (error) {
      expect((error as { workspaceError?: unknown }).workspaceError).toEqual({ code: "record_version_conflict", fieldErrors: { version: ["This record changed on another device. Refresh before trying again."] } });
    }
  });

  it("requires independent Manager review", () => {
    expect(() => assertIndependentReviewer(10, 11)).not.toThrow();
    expect(() => assertIndependentReviewer(10, 10)).toThrow(/different Manager/);
  });

  it("calculates signed ledger amounts without accepting zero or negative inputs", () => {
    expect(calculateSignedAmount("deposit", 25)).toBe(25);
    expect(calculateSignedAmount("purchase", 25)).toBe(-25);
    expect(() => calculateSignedAmount("withdrawal", 0)).toThrow(/greater than zero/);
  });

  it("does not claim inactive email or SMS delivery and keeps previews private", () => {
    expect(notificationChannels({ urgent: true, providerEmailActive: false, providerSmsActive: true })).toEqual({ push: true, email: false, sms: true, externalDeliveryPending: true });
    const preview = safeNotificationPreview({ category: "Safeguarding", propertyLabel: "North House", urgent: true });
    expect(preview.body).not.toMatch(/young person|medication|incident details/i);
    expect(preview.title).toBe("Urgent action required");
  });
});
