import { TRPCError } from "@trpc/server";
import { dateRangeIssue } from "./inputValidation";

export const printableExportTypes = ["young_person_compilation", "shift_register", "timesheet", "document_register"] as const;
export type PrintableExportType = typeof printableExportTypes[number];
export const printableReviewDecisions = ["approved", "returned", "declined"] as const;
export type PrintableReviewDecision = typeof printableReviewDecisions[number];

const MAX_PRINTABLE_RANGE_MS = 366 * 3 * 86_400_000;

export function printableRangeIssue(rangeStart: number, rangeEnd: number) {
  const chronology = dateRangeIssue(rangeStart, rangeEnd, "Printable record range", "rangeEnd");
  if (chronology) return chronology;
  if (rangeEnd - rangeStart > MAX_PRINTABLE_RANGE_MS) {
    return {
      field: "rangeEnd",
      message: "Printable record ranges can cover up to three years. Choose a shorter period before requesting the export.",
      overrideAvailable: false,
    };
  }
  return null;
}

export function assertPrintableRange(rangeStart: number, rangeEnd: number) {
  const issue = printableRangeIssue(rangeStart, rangeEnd);
  if (issue) throw new TRPCError({ code: "BAD_REQUEST", message: issue.message, cause: issue });
}

export function assertIndependentPrintableReview(input: {
  status: string;
  requestedBy: number;
  reviewerId: number;
  decision: PrintableReviewDecision;
  notes?: string;
}) {
  if (!['awaiting_approval', 'returned', 'failed'].includes(input.status)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This export is not awaiting an approval decision." });
  }
  if (input.requestedBy === input.reviewerId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "A different authorised Manager, RSM or Owner must approve a young-person record export." });
  }
  if (input.decision !== "approved" && (!input.notes || input.notes.trim().length < 10)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Add a clear return or decline reason of at least 10 characters." });
  }
}

export function isPrintableExportManagerRole(role: string | null | undefined) {
  return role === "owner" || role === "registered_manager";
}

export function isPrintableShiftExportRole(role: string | null | undefined) {
  return role === "owner" || role === "registered_manager" || role === "hr_compliance";
}

export function isPrintableDocumentExportRole(role: string | null | undefined) {
  return role === "owner" || role === "registered_manager" || role === "hr_compliance";
}

/** Keeps provider/object-store failures stable and prevents raw backend detail entering records or audit metadata. */
export function printableExportFailureCode(_error: unknown) {
  return "pdf_generation_failed" as const;
}

export function printableExportFileName(type: PrintableExportType, reference: number, createdAt: number) {
  const date = new Date(createdAt).toISOString().slice(0, 10);
  const prefix = type === "young_person_compilation" ? "young-person-record" : type === "shift_register" ? "shift-register" : type === "timesheet" ? "timesheet" : "document-register";
  return `${prefix}-${reference}-${date}.pdf`;
}

export function printableExportTitle(type: PrintableExportType) {
  if (type === "young_person_compilation") return "Young-person record compilation";
  if (type === "shift_register") return "Shift and attendance register";
  if (type === "timesheet") return "Approved timesheet";
  return "Controlled document register";
}

export function printableExportClassification(type: PrintableExportType) {
  return type === "young_person_compilation" ? "safeguarding" as const : type === "timesheet" ? "hr" as const : "restricted" as const;
}

export function printableExportRequiresIndependentApproval(type: PrintableExportType) {
  return type === "young_person_compilation";
}

export const printableExportRetentionBasis = "Controlled printable-record export — retain under the entity record-retention schedule";
export const printableExportRetentionMs = 7 * 366 * 86_400_000;
export const printableAuditMetadata = (input: { exportType: PrintableExportType; recordCount: number; documentId?: number }) => ({
  exportType: input.exportType,
  recordCount: input.recordCount,
  ...(input.documentId ? { documentId: input.documentId } : {}),
});
