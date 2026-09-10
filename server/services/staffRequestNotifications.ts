export type StaffRequestOutcome = "approved" | "declined" | "returned";

export function buildStaffRequestOutcomeNotification(input: { userId: number; requestId: number; outcome: StaffRequestOutcome; version: number }) {
  const returned = input.outcome === "returned";
  const approved = input.outcome === "approved";
  return {
    userId: input.userId,
    type: "staff_request_outcome",
    title: approved ? "Staff request approved" : "Staff request updated",
    message: returned
      ? "A manager has returned your staff request for review. Open your Staff workspace to see the outcome."
      : "A manager has updated your staff request. Open your Staff workspace to see the outcome.",
    severity: returned ? "warning" as const : "info" as const,
    resourceType: "staff_request",
    resourceId: input.requestId,
    deepLink: "/staff",
    acknowledgementRequired: 0,
    dedupeKey: `staff-request-outcome:${input.requestId}:v${input.version}`,
  };
}
