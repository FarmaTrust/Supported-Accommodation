export type DataRightsStatus = "received" | "identity_check" | "scoping" | "collecting" | "redacting" | "awaiting_approval" | "ready" | "delivered" | "restricted" | "refused" | "withdrawn" | "closed" | "overdue";
export type RegulatoryRegimeStatus = "draft" | "in_review" | "approved" | "active" | "superseded" | "withdrawn";

const dataRightsTransitions: Partial<Record<DataRightsStatus, readonly DataRightsStatus[]>> = {
  received: ["identity_check", "withdrawn"],
  identity_check: ["scoping", "refused", "withdrawn"],
  scoping: ["collecting", "restricted", "refused", "withdrawn"],
  collecting: ["redacting", "awaiting_approval", "restricted", "refused", "withdrawn"],
  redacting: ["awaiting_approval", "restricted", "refused", "withdrawn"],
  restricted: ["collecting", "awaiting_approval", "closed"],
  ready: ["delivered", "restricted"],
  delivered: ["closed"],
  overdue: ["collecting", "redacting", "awaiting_approval", "ready", "delivered", "restricted", "refused", "withdrawn"],
};

const regimeTransitions: Partial<Record<RegulatoryRegimeStatus, readonly RegulatoryRegimeStatus[]>> = {
  draft: ["in_review", "withdrawn"],
  in_review: ["approved", "withdrawn"],
  approved: ["active", "withdrawn"],
  active: ["superseded", "withdrawn"],
};

export function dataRightsTransitionAllowed(from: DataRightsStatus, to: DataRightsStatus) {
  return dataRightsTransitions[from]?.includes(to) ?? false;
}

export function regimeTransitionAllowed(from: RegulatoryRegimeStatus, to: RegulatoryRegimeStatus) {
  return regimeTransitions[from]?.includes(to) ?? false;
}

export function independentlyApprovedBy(actorId: number, authors: Array<number | null | undefined>) {
  return !authors.some(author => author === actorId);
}

export function validObservationPeriod(periodStart: number, periodEnd: number) {
  return Number.isFinite(periodStart) && Number.isFinite(periodEnd) && periodEnd > periodStart;
}

