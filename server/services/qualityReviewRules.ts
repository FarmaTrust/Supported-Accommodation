import { TRPCError } from "@trpc/server";

export const qualityReportManagerRoles = new Set(["owner", "registered_manager"]);

export function isQualityReportManager(role: string) {
  return qualityReportManagerRoles.has(role);
}

export function assertIndependentQualityApproval(input: {
  status: string;
  reviewerId: number;
  createdBy?: number | null;
  completedBy?: number | null;
  existingReportDocumentId?: number | null;
}) {
  if (input.status !== "report_draft") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only a checked draft quality review can be independently approved." });
  }
  if (!input.existingReportDocumentId) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Preview and save the final report draft before requesting independent approval." });
  }
  if ([input.createdBy, input.completedBy].filter((value): value is number => typeof value === "number").includes(input.reviewerId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "A different authorised Manager, RSM or Owner must approve this quality review." });
  }
}

export function qualityReviewDocumentTitle(title: string, reviewId: number) {
  return `${title} · QSR-${reviewId}`.slice(0, 240);
}

export const qualityReviewRetentionBasis = "Quality of support review — retain under organisation retention schedule";
export const qualityReviewRetentionMs = 7 * 365 * 86_400_000;

export function qualityReviewAuditMetadata(input: { state: "draft" | "approved" | "download"; documentId?: number; version?: number; evidenceCount: number; consultationCount: number }) {
  return {
    state: input.state,
    documentId: input.documentId ?? null,
    version: input.version ?? null,
    evidenceCount: input.evidenceCount,
    consultationCount: input.consultationCount,
  };
}
