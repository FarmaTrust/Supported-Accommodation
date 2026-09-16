export type ReportCompletionStatus = "draft" | "submitted" | "reviewed" | "returned" | "approved" | "locked";

export type ReportCompletionRow = {
  id: number;
  propertyId: number;
  propertyName: string;
  authorUserId: number;
  authorName: string | null;
  status: ReportCompletionStatus;
  reportDate: number;
};

export type ReportCompletionCounts = Record<ReportCompletionStatus, number> & {
  logged: number;
  needsCompletion: number;
  awaitingReview: number;
  approvedOrLocked: number;
};

function emptyCounts(): ReportCompletionCounts {
  return { draft: 0, submitted: 0, reviewed: 0, returned: 0, approved: 0, locked: 0, logged: 0, needsCompletion: 0, awaitingReview: 0, approvedOrLocked: 0 };
}

function addCount(counts: ReportCompletionCounts, status: ReportCompletionStatus) {
  counts[status] += 1;
  if (["submitted", "reviewed", "approved", "locked"].includes(status)) counts.logged += 1;
  if (["draft", "returned"].includes(status)) counts.needsCompletion += 1;
  if (["submitted", "reviewed"].includes(status)) counts.awaitingReview += 1;
  if (["approved", "locked"].includes(status)) counts.approvedOrLocked += 1;
}

type MutableWorkerGroup = {
  userId: number;
  name: string;
  counts: ReportCompletionCounts;
  latestReportAt: number | null;
};

type MutablePropertyGroup = {
  propertyId: number;
  propertyName: string;
  counts: ReportCompletionCounts;
  latestReportAt: number | null;
  workers: Map<number, MutableWorkerGroup>;
};

/**
 * Produces a factual roll-up of existing report states. `logged` means a
 * submitted, reviewed, approved or locked report; it intentionally does not
 * infer an expected report schedule or a completion percentage.
 */
export function summariseReportCompletion(rows: ReportCompletionRow[]) {
  const properties = new Map<number, MutablePropertyGroup>();
  for (const row of rows) {
    let property = properties.get(row.propertyId);
    if (!property) {
      property = { propertyId: row.propertyId, propertyName: row.propertyName, counts: emptyCounts(), latestReportAt: null, workers: new Map() };
      properties.set(row.propertyId, property);
    }
    let worker = property.workers.get(row.authorUserId);
    if (!worker) {
      worker = { userId: row.authorUserId, name: row.authorName?.trim() || `Key Worker ${row.authorUserId}`, counts: emptyCounts(), latestReportAt: null };
      property.workers.set(row.authorUserId, worker);
    }
    addCount(property.counts, row.status);
    addCount(worker.counts, row.status);
    property.latestReportAt = Math.max(property.latestReportAt ?? 0, row.reportDate) || null;
    worker.latestReportAt = Math.max(worker.latestReportAt ?? 0, row.reportDate) || null;
  }

  return Array.from(properties.values())
    .map(property => ({
      propertyId: property.propertyId,
      propertyName: property.propertyName,
      counts: property.counts,
      latestReportAt: property.latestReportAt,
      keyWorkers: Array.from(property.workers.values())
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(worker => ({ userId: worker.userId, name: worker.name, counts: worker.counts, latestReportAt: worker.latestReportAt })),
    }))
    .sort((left, right) => left.propertyName.localeCompare(right.propertyName));
}
