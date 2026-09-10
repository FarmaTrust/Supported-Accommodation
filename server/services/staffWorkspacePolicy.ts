import { TRPCError } from "@trpc/server";
import { workspaceFieldError } from "./workspaceGuards";

export type WorkspaceDomain =
  | "report"
  | "incident"
  | "property_check"
  | "maintenance"
  | "staff_request"
  | "supervision"
  | "investigation"
  | "medication_discrepancy"
  | "finance_transaction"
  | "finance_reconciliation"
  | "finance_discrepancy";

const transitions: Record<WorkspaceDomain, Record<string, readonly string[]>> = {
  report: { draft: ["submitted"], submitted: ["reviewed", "returned", "approved"], reviewed: ["returned", "approved"], returned: ["submitted"], approved: ["locked"], locked: [] },
  incident: { pending: ["in_review", "returned", "approved"], in_review: ["returned", "approved", "closed"], returned: ["in_review"], approved: ["closed"], closed: [] },
  property_check: { draft: ["submitted"], submitted: ["reviewed", "returned", "closed"], reviewed: ["closed", "returned"], returned: ["submitted"], closed: [] },
  maintenance: { reported: ["triaged", "cancelled"], triaged: ["assigned", "scheduled", "cancelled"], assigned: ["scheduled", "in_progress", "cancelled"], scheduled: ["in_progress", "cancelled"], in_progress: ["completed", "cancelled"], completed: ["verified", "reopened"], verified: ["reopened"], cancelled: ["reopened"], reopened: ["triaged", "assigned", "in_progress"] },
  staff_request: { draft: ["submitted", "withdrawn"], submitted: ["approved", "declined", "returned", "withdrawn"], returned: ["submitted", "withdrawn"], approved: [], declined: [], withdrawn: [] },
  supervision: { scheduled: ["draft", "cancelled"], draft: ["submitted", "cancelled"], submitted: ["acknowledged", "completed"], acknowledged: ["completed"], completed: [], cancelled: [] },
  investigation: { open: ["evidence_gathering", "cancelled"], evidence_gathering: ["awaiting_response", "review", "action_plan", "cancelled"], awaiting_response: ["evidence_gathering", "review", "action_plan"], review: ["evidence_gathering", "action_plan", "closed"], action_plan: ["review", "closed"], closed: [], cancelled: [] },
  medication_discrepancy: { open: ["under_review", "action_required"], under_review: ["action_required", "resolved"], action_required: ["under_review", "resolved"], resolved: ["closed", "under_review"], closed: [] },
  finance_transaction: { draft: ["submitted"], submitted: ["approved", "returned", "reversed"], returned: ["submitted"], approved: ["reversed"], reversed: [] },
  finance_reconciliation: { draft: ["submitted"], submitted: ["balanced", "discrepancy", "returned"], returned: ["submitted"], balanced: ["approved", "returned"], discrepancy: ["returned", "approved"], approved: [] },
  finance_discrepancy: { open: ["under_review", "action_required"], under_review: ["action_required", "resolved"], action_required: ["under_review", "resolved"], resolved: ["closed", "under_review"], closed: [] },
};

export function assertWorkspaceTransition(domain: WorkspaceDomain, current: string, next: string) {
  if (!(transitions[domain][current] ?? []).includes(next)) {
    throw workspaceFieldError("workflow_transition_invalid", "status", `Invalid ${domain.replaceAll("_", " ")} transition from ${current} to ${next}`, "CONFLICT");
  }
}

export function assertExpectedVersion(actual: number, expected: number) {
  if (actual !== expected) {
    throw workspaceFieldError("record_version_conflict", "version", "This record changed on another device. Refresh before trying again.", "CONFLICT");
  }
}

export function assertIndependentReviewer(createdBy: number | null | undefined, reviewerUserId: number) {
  if (createdBy === reviewerUserId) {
    throw workspaceFieldError("independent_reviewer_required", "reviewer", "A different Manager must complete this review.", "FORBIDDEN");
  }
}

export function calculateSignedAmount(type: "deposit" | "withdrawal" | "purchase" | "refund" | "adjustment" | "reversal", amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) throw workspaceFieldError("amount_invalid", "amount", "Amount must be greater than zero.");
  return ["deposit", "refund"].includes(type) ? amount : -amount;
}

export function notificationChannels(input: { urgent: boolean; providerEmailActive: boolean; providerSmsActive: boolean }) {
  return {
    push: true,
    email: input.urgent && input.providerEmailActive,
    sms: input.urgent && input.providerSmsActive,
    externalDeliveryPending: input.urgent && (!input.providerEmailActive || !input.providerSmsActive),
  };
}

export function safeNotificationPreview(input: { category: string; propertyLabel?: string; urgent: boolean }) {
  return {
    title: input.urgent ? "Urgent action required" : "Action required",
    body: `${input.category}${input.propertyLabel ? ` at ${input.propertyLabel}` : ""}. Open the Hub to view details.`,
  };
}
