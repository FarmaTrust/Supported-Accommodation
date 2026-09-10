import { describe, expect, it } from "vitest";
import { buildStaffRequestOutcomeNotification } from "./staffRequestNotifications";

describe("buildStaffRequestOutcomeNotification", () => {
  it("targets only the requesting staff member and creates a versioned approval alert", () => {
    expect(buildStaffRequestOutcomeNotification({ userId: 41, requestId: 22, outcome: "approved", version: 3 })).toEqual(expect.objectContaining({
      userId: 41, type: "staff_request_outcome", title: "Staff request approved", severity: "info", resourceType: "staff_request", resourceId: 22, deepLink: "/staff", acknowledgementRequired: 0, dedupeKey: "staff-request-outcome:22:v3",
    }));
  });

  it("uses an outcome-safe update message and warning severity when a request is returned", () => {
    const notification = buildStaffRequestOutcomeNotification({ userId: 41, requestId: 22, outcome: "returned", version: 4 });
    expect(notification.title).toBe("Staff request updated");
    expect(notification.severity).toBe("warning");
    expect(notification.message).toMatch(/returned.*review/i);
    expect(notification.message).not.toMatch(/notes|details|certificate|sickness/i);
  });
});
