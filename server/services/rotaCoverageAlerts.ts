import type { RotaCoverageGap } from "./rotaOverview";

export type CoverageAlertRecipient = {
  userId: number;
  operationalRole: "owner" | "registered_manager";
};

export type RotaCoverageAlert = {
  userId: number;
  dedupeKey: string;
  title: string;
  message: string;
  severity: "urgent";
  propertyId: number;
  dueAt: number;
  deepLink: string;
};

export function rotaCoverageAlertDedupeKey(entityId: number, gap: Pick<RotaCoverageGap, "propertyId" | "startsAt" | "endsAt" | "deficit">, userId: number) {
  return `rota-coverage:${entityId}:${gap.propertyId}:${gap.startsAt}:${gap.endsAt}:${gap.deficit}:${userId}`;
}

/**
 * Produces safe, idempotent manager alerts from exact uncovered intervals. The
 * message deliberately contains rota metadata only—never young-person or care
 * narrative content.
 */
export function buildRotaCoverageAlerts(input: { entityId: number; gaps: RotaCoverageGap[]; recipients: CoverageAlertRecipient[] }): RotaCoverageAlert[] {
  return input.gaps.flatMap(gap => input.recipients.map(recipient => ({
    userId: recipient.userId,
    dedupeKey: rotaCoverageAlertDedupeKey(input.entityId, gap, recipient.userId),
    title: `Coverage gap: ${gap.propertyName}`,
    message: `${gap.deficit} Key Worker cover is missing from ${formatTime(gap.startsAt)} to ${formatTime(gap.endsAt)}. Open the rota to assign safe cover.`,
    severity: "urgent" as const,
    propertyId: gap.propertyId,
    dueAt: gap.startsAt,
    deepLink: `/rota?day=${dateValue(gap.startsAt)}&property=${gap.propertyId}`,
  })));
}

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

function dateValue(value: number) {
  return new Date(value).toISOString().slice(0, 10);
}
