export type RetentionDecision = "hold" | "approved_delete" | "approved_transfer" | "cancelled";

export function validateRetentionDecision(input: { requestedBy: number; decidedBy: number; legalHold: boolean; decision: RetentionDecision }) {
  if (input.requestedBy === input.decidedBy && ["approved_delete", "approved_transfer"].includes(input.decision)) return { allowed: false as const, reason: "independent_approval_required" as const };
  if (input.legalHold && input.decision === "approved_delete") return { allowed: false as const, reason: "legal_hold" as const };
  return { allowed: true as const, reason: "valid" as const };
}

export function canCompleteDeletion(input: { status: string; legalHold: boolean; resourceType: string }) {
  return input.status === "approved_delete" && !input.legalHold && input.resourceType === "document";
}

export function retentionQueueState(input: { retentionUntil: number; reviewDueAt: number; legalHold: boolean }, now = Date.now()) {
  if (input.legalHold) return "hold" as const;
  if (input.reviewDueAt <= now) return "review_due" as const;
  if (input.retentionUntil <= now) return "eligible" as const;
  return "scheduled" as const;
}
