export type EvidenceReminderConfiguration = {
  enabled: boolean;
  staffEvidenceReviewHours: number;
  documentReviewLeadDays: number;
  retentionReviewLeadDays: number;
  runAtHourUtc: number;
};

export const DEFAULT_EVIDENCE_REMINDER_CONFIGURATION: EvidenceReminderConfiguration = {
  enabled: true,
  staffEvidenceReviewHours: 48,
  documentReviewLeadDays: 30,
  retentionReviewLeadDays: 30,
  runAtHourUtc: 7,
};

export function normaliseEvidenceReminderConfiguration(input?: Partial<EvidenceReminderConfiguration> | null): EvidenceReminderConfiguration {
  const source = input ?? {};
  return {
    enabled: source.enabled ?? DEFAULT_EVIDENCE_REMINDER_CONFIGURATION.enabled,
    staffEvidenceReviewHours: clampInteger(source.staffEvidenceReviewHours, 1, 720, DEFAULT_EVIDENCE_REMINDER_CONFIGURATION.staffEvidenceReviewHours),
    documentReviewLeadDays: clampInteger(source.documentReviewLeadDays, 1, 365, DEFAULT_EVIDENCE_REMINDER_CONFIGURATION.documentReviewLeadDays),
    retentionReviewLeadDays: clampInteger(source.retentionReviewLeadDays, 1, 365, DEFAULT_EVIDENCE_REMINDER_CONFIGURATION.retentionReviewLeadDays),
    runAtHourUtc: clampInteger(source.runAtHourUtc, 0, 23, DEFAULT_EVIDENCE_REMINDER_CONFIGURATION.runAtHourUtc),
  };
}

export function evidenceReminderCron(hourUtc: number): string {
  if (!Number.isInteger(hourUtc) || hourUtc < 0 || hourUtc > 23) {
    throw new Error("Reminder hour must be a whole UTC hour between 0 and 23");
  }
  return `0 0 ${hourUtc} * * *`;
}

export function shouldNotifyByLeadTime(dueAt: number | null | undefined, leadDays: number, now = Date.now()): boolean {
  return typeof dueAt === "number" && dueAt <= now + leadDays * 86_400_000;
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value as number));
}
