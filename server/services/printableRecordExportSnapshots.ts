import { and, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import {
  clockEvents, curfewChecks, curfewPlans, documentVersions, documents, healthMonitoringEvents, healthMonitoringPlans,
  incidents, keyWorkerReports, medicationAdministrations, medications, placements, properties, scheduledActivities,
  shifts, timesheetEntries, timesheets, users, youngPeople, handovers, professionalContacts,
} from "../../drizzle/schema";
import type { PrintableExportType } from "./printableRecordExportRules";
import type { RecordExportPdfSection } from "./recordExportPdf";
import { decryptSensitive } from "./crypto";

export type PrintableSnapshot = {
  type: PrintableExportType;
  entityName: string;
  propertyName?: string | null;
  placementReference?: string | null;
  preferredName?: string | null;
  recordCount: number;
  sourceCounts: Record<string, number>;
  sections: RecordExportPdfSection[];
};

const clean = (value?: string | null) => value?.trim() || null;
const titleCase = (value?: string | null) => value ? value.replaceAll("_", " ") : null;
const contextDate = (value?: Date | null) => value ? value.getTime() : null;

export async function buildYoungPersonPrintableSnapshot(db: any, input: { entityId: number; placementId: number; rangeStart: number; rangeEnd: number; entityName: string }) : Promise<PrintableSnapshot> {
  const [context] = await db.select({
    placementId: placements.id, propertyId: placements.propertyId, propertyName: properties.name, reference: youngPeople.reference, preferredName: youngPeople.preferredName,
  }).from(placements).innerJoin(youngPeople, eq(youngPeople.id, placements.youngPersonId)).leftJoin(properties, eq(properties.id, placements.propertyId))
    .where(and(eq(placements.id, input.placementId), eq(placements.entityId, input.entityId))).limit(1);
  if (!context) throw new Error("Placement not found");
  const [healthPlans, healthRows, medicineRows, administrationRows, curfewRows, curfewCheckRows, activityRows, contactRows, reportRows, incidentRows] = await Promise.all([
    db.select().from(healthMonitoringPlans).where(eq(healthMonitoringPlans.placementId, input.placementId)),
    db.select().from(healthMonitoringEvents).where(and(eq(healthMonitoringEvents.placementId, input.placementId), gte(healthMonitoringEvents.occurredAt, input.rangeStart), lte(healthMonitoringEvents.occurredAt, input.rangeEnd))).orderBy(desc(healthMonitoringEvents.occurredAt)),
    db.select().from(medications).where(eq(medications.placementId, input.placementId)),
    db.select().from(medicationAdministrations).where(and(eq(medicationAdministrations.placementId, input.placementId), gte(medicationAdministrations.scheduledAt, input.rangeStart), lte(medicationAdministrations.scheduledAt, input.rangeEnd))).orderBy(desc(medicationAdministrations.scheduledAt)),
    db.select().from(curfewPlans).where(eq(curfewPlans.placementId, input.placementId)),
    db.select().from(curfewChecks).where(and(eq(curfewChecks.placementId, input.placementId), gte(curfewChecks.expectedAt, input.rangeStart), lte(curfewChecks.expectedAt, input.rangeEnd))).orderBy(desc(curfewChecks.expectedAt)),
    db.select().from(scheduledActivities).where(and(eq(scheduledActivities.placementId, input.placementId), gte(scheduledActivities.scheduledStart, input.rangeStart), lte(scheduledActivities.scheduledStart, input.rangeEnd))).orderBy(desc(scheduledActivities.scheduledStart)),
    db.select({ id: professionalContacts.id, contactType: professionalContacts.contactType, name: professionalContacts.name, roleTitle: professionalContacts.roleTitle, organisation: professionalContacts.organisation, preferredContactMethod: professionalContacts.preferredContactMethod, isPrimary: professionalContacts.isPrimary, status: professionalContacts.status, createdAt: professionalContacts.createdAt }).from(professionalContacts).where(and(eq(professionalContacts.placementId, input.placementId), gte(professionalContacts.createdAt, new Date(input.rangeStart)), lte(professionalContacts.createdAt, new Date(input.rangeEnd)))).orderBy(desc(professionalContacts.createdAt)),
    db.select({ id: keyWorkerReports.id, reportType: keyWorkerReports.reportType, reportDate: keyWorkerReports.reportDate, mood: keyWorkerReports.mood, attitude: keyWorkerReports.attitude, learning: keyWorkerReports.learning, enthusiasm: keyWorkerReports.enthusiasm, discussions: keyWorkerReports.discussions, pointsToNote: keyWorkerReports.pointsToNote, plan: keyWorkerReports.plan, suggestions: keyWorkerReports.suggestions, status: keyWorkerReports.status, approvedAt: keyWorkerReports.approvedAt, authorName: users.name }).from(keyWorkerReports).innerJoin(users, eq(users.id, keyWorkerReports.authorUserId)).where(and(eq(keyWorkerReports.placementId, input.placementId), gte(keyWorkerReports.reportDate, input.rangeStart), lte(keyWorkerReports.reportDate, input.rangeEnd))).orderBy(desc(keyWorkerReports.reportDate)),
    db.select({ id: incidents.id, occurredAt: incidents.occurredAt, category: incidents.category, severity: incidents.severity, summary: incidents.summary, details: incidents.details, immediateActions: incidents.immediateActions, status: incidents.status, managerReviewState: incidents.managerReviewState }).from(incidents).where(and(eq(incidents.entityId, input.entityId), eq(incidents.placementId, input.placementId), gte(incidents.occurredAt, input.rangeStart), lte(incidents.occurredAt, input.rangeEnd))).orderBy(desc(incidents.occurredAt)),
  ]);
  const healthNames = new Map(healthPlans.map((row: any) => [row.id, row.title]));
  const medicineNames = new Map(medicineRows.map((row: any) => [row.id, row.name]));
  const curfewTimes = new Map(curfewRows.map((row: any) => [row.id, row.expectedReturnTime]));
  const reportNotes = (row: any) => [
    ["Mood", row.mood], ["Attitude and engagement", row.attitude], ["Learning", row.learning], ["Enthusiasm", row.enthusiasm], ["Discussion", row.discussions], ["Points for next shift", row.pointsToNote], ["Plan", row.plan], ["Observations", row.suggestions],
  ].filter((item): item is [string, string] => Boolean(clean(item[1]))).map(([label, value]) => `${label}: ${value}`).join("\n");
  const sections: RecordExportPdfSection[] = [
    { title: "College, court and appointments", records: activityRows.map((row: any) => ({ occurredAt: row.scheduledStart, title: `${titleCase(row.activityType)} · ${row.title}`, detail: [clean(row.organisation), `Attendance: ${titleCase(row.attendanceStatus)}`, clean(row.transport) ? `Travel: ${titleCase(row.transport)}` : null].filter(Boolean).join(" · "), notes: [clean(decryptSensitive(row.outcomeCiphertext)), clean(decryptSensitive(row.followUpCiphertext))].filter(Boolean).join("\n"), status: row.acknowledgedAt ? "acknowledged" : row.attendanceStatus })) },
    { title: "Curfew", records: curfewCheckRows.map((row: any) => ({ occurredAt: row.actualAt ?? row.expectedAt, title: `Expected return ${curfewTimes.get(row.curfewPlanId) ?? "time"}`, detail: [titleCase(row.status), row.escalationRequired ? "Escalation required" : null].filter(Boolean).join(" · "), notes: [clean(decryptSensitive(row.contactAttemptsCiphertext)), clean(decryptSensitive(row.reasonCiphertext)), clean(decryptSensitive(row.actionTakenCiphertext))].filter(Boolean).join("\n"), status: row.acknowledgedAt ? "acknowledged" : row.status })) },
    { title: "Professional contacts", records: contactRows.map((row: any) => ({ occurredAt: contextDate(row.createdAt), title: `${titleCase(row.contactType)} · ${row.name}`, detail: [clean(row.roleTitle), clean(row.organisation), `Preferred method: ${titleCase(row.preferredContactMethod)}`, row.isPrimary ? "Primary contact" : null].filter(Boolean).join(" · "), status: row.status })) },
    { title: "Medication", records: administrationRows.map((row: any) => ({ occurredAt: row.administeredAt ?? row.scheduledAt, title: medicineNames.get(row.medicationId) ?? "Medication", detail: [`Outcome: ${titleCase(row.outcome)}`, clean(row.doseAcknowledged) ? `Dose: ${row.doseAcknowledged}` : null, row.managerAcknowledgedAt ? "Manager acknowledged" : null, row.escalationRequired ? "Escalation required" : null].filter(Boolean).join(" · "), notes: [clean(decryptSensitive(row.reasonCiphertext)), clean(decryptSensitive(row.actionTakenCiphertext))].filter(Boolean).join("\n"), status: row.managerAcknowledgedAt ? "acknowledged" : row.outcome })) },
    { title: "Health monitoring", records: healthRows.map((row: any) => ({ occurredAt: row.occurredAt, title: healthNames.get(row.planId) ?? "Health observation", detail: [titleCase(row.outcome), clean(row.value) ? `${row.value}${row.unit ? ` ${row.unit}` : ""}` : null, row.escalationRequired ? "Escalation required" : null].filter(Boolean).join(" · "), notes: clean(decryptSensitive(row.notesCiphertext)), status: row.acknowledgedAt ? "acknowledged" : row.outcome })) },
    { title: "Keyworker reports", records: reportRows.map((row: any) => ({ occurredAt: row.reportDate, title: `${titleCase(row.reportType)} · ${row.authorName ?? "Key Worker"}`, detail: [`Status: ${titleCase(row.status)}`, row.approvedAt ? `Previously approved ${new Date(row.approvedAt).toLocaleDateString("en-GB")}` : null].filter(Boolean).join(" · "), notes: reportNotes(row), status: row.status })) },
    { title: "Incidents and significant events", records: incidentRows.map((row: any) => ({ occurredAt: row.occurredAt, title: `${titleCase(row.category)} · ${row.summary}`, detail: [`Severity: ${titleCase(row.severity)}`, `Review: ${titleCase(row.managerReviewState)}`, `Status: ${titleCase(row.status)}`].join(" · "), notes: [clean(row.details), clean(row.immediateActions)].filter(Boolean).join("\n"), status: row.managerReviewState })) },
  ];
  const sourceCounts = { activities: activityRows.length, curfewChecks: curfewCheckRows.length, professionalContacts: contactRows.length, medicationAdministrations: administrationRows.length, healthMonitoringEvents: healthRows.length, keyWorkerReports: reportRows.length, incidents: incidentRows.length };
  return { type: "young_person_compilation", entityName: input.entityName, propertyName: context.propertyName, placementReference: context.reference, preferredName: context.preferredName, recordCount: Object.values(sourceCounts).reduce((sum, count) => sum + count, 0), sourceCounts, sections };
}

export async function buildShiftPrintableSnapshot(db: any, input: { entityId: number; propertyIds: number[]; propertyName: string | null; rangeStart: number; rangeEnd: number; entityName: string; includeSensitiveHandover: boolean }): Promise<PrintableSnapshot> {
  const predicates = inArray(shifts.propertyId, input.propertyIds);
  const [shiftRows, clockRows, handoverRows] = await Promise.all([
    db.select({ id: shifts.id, title: shifts.title, startsAt: shifts.startsAt, endsAt: shifts.endsAt, requiredRole: shifts.requiredRole, status: shifts.status, coverageState: shifts.coverageState, propertyName: properties.name, workerName: users.name }).from(shifts).innerJoin(properties, eq(properties.id, shifts.propertyId)).leftJoin(users, eq(users.id, shifts.assignedUserId)).where(and(eq(shifts.entityId, input.entityId), predicates, gte(shifts.startsAt, input.rangeStart), lte(shifts.startsAt, input.rangeEnd))).orderBy(desc(shifts.startsAt)),
    db.select({ id: clockEvents.id, occurredAt: clockEvents.occurredAt, eventType: clockEvents.eventType, locationState: clockEvents.locationState, propertyName: properties.name, workerName: users.name }).from(clockEvents).innerJoin(properties, eq(properties.id, clockEvents.propertyId)).innerJoin(users, eq(users.id, clockEvents.userId)).where(and(eq(clockEvents.entityId, input.entityId), inArray(clockEvents.propertyId, input.propertyIds), gte(clockEvents.occurredAt, input.rangeStart), lte(clockEvents.occurredAt, input.rangeEnd))).orderBy(desc(clockEvents.occurredAt)),
    db.select({ id: handovers.id, createdAt: handovers.createdAt, summary: handovers.summary, risks: handovers.risks, outstandingActions: handovers.outstandingActions, sensitivity: handovers.sensitivity, propertyName: properties.name, authorName: users.name, reviewState: handovers.dictatedReviewState }).from(handovers).innerJoin(properties, eq(properties.id, handovers.propertyId)).innerJoin(users, eq(users.id, handovers.createdBy)).where(and(eq(handovers.entityId, input.entityId), inArray(handovers.propertyId, input.propertyIds), gte(handovers.createdAt, new Date(input.rangeStart)), lte(handovers.createdAt, new Date(input.rangeEnd)))).orderBy(desc(handovers.createdAt)),
  ]);
  const filteredHandovers = input.includeSensitiveHandover ? handoverRows : handoverRows.filter((row: any) => row.sensitivity === "operational");
  const sourceCounts = { shifts: shiftRows.length, clockEvents: clockRows.length, handovers: filteredHandovers.length };
  return {
    type: "shift_register", entityName: input.entityName, propertyName: input.propertyName, recordCount: Object.values(sourceCounts).reduce((sum, count) => sum + count, 0), sourceCounts,
    sections: [
      { title: "Planned and worked shifts", records: shiftRows.map((row: any) => ({ occurredAt: row.startsAt, title: `${row.propertyName} · ${row.title}`, detail: [`Ends ${new Date(row.endsAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`, row.workerName ? `Worker: ${row.workerName}` : "Unassigned", `Status: ${titleCase(row.status)}`, `Coverage: ${titleCase(row.coverageState)}`, clean(row.requiredRole) ? `Required: ${row.requiredRole}` : null].filter(Boolean).join(" · "), status: row.status })) },
      { title: "Clock evidence", records: clockRows.map((row: any) => ({ occurredAt: row.occurredAt, title: `${row.propertyName} · ${titleCase(row.eventType)}`, detail: `${row.workerName ?? "Worker"} · Location: ${titleCase(row.locationState)}`, status: row.locationState })) },
      { title: "Shift handovers", records: filteredHandovers.map((row: any) => ({ occurredAt: contextDate(row.createdAt), title: `${row.propertyName} · ${row.authorName ?? "Worker"}`, detail: `${titleCase(row.sensitivity)} · Dictation review: ${titleCase(row.reviewState)}`, notes: [clean(row.summary), clean(row.risks) ? `Risks: ${row.risks}` : null, clean(row.outstandingActions) ? `Outstanding actions: ${row.outstandingActions}` : null].filter(Boolean).join("\n"), status: row.reviewState })) },
    ],
  };
}

export async function buildTimesheetPrintableSnapshot(db: any, input: { entityId: number; timesheetId: number; entityName: string; workerName: string; rangeStart: number; rangeEnd: number; approvedAt: number | null }) : Promise<PrintableSnapshot> {
  const rows = await db.select().from(timesheetEntries).where(eq(timesheetEntries.timesheetId, input.timesheetId));
  return {
    type: "timesheet", entityName: input.entityName, propertyName: "Approved workforce record", recordCount: rows.length, sourceCounts: { timesheetEntries: rows.length },
    sections: [{ title: "Clock-derived timesheet entries", records: rows.map((row: any) => ({ title: `${row.minutes} minutes`, detail: [`Worker: ${input.workerName}`, `Exception: ${titleCase(row.exceptionType)}`, row.originalMinutes !== null ? `Original: ${row.originalMinutes} minutes` : null, input.approvedAt ? `Approved ${new Date(input.approvedAt).toLocaleDateString("en-GB")}` : null].filter(Boolean).join(" · "), status: row.exceptionType })) }],
  };
}

export async function buildDocumentRegisterPrintableSnapshot(db: any, input: { entityId: number; propertyIds: number[]; propertyName: string | null; rangeStart: number; rangeEnd: number; entityName: string }) : Promise<PrintableSnapshot> {
  const rows = await db.select({ id: documents.id, title: documents.title, documentType: documents.documentType, classification: documents.classification, status: documents.status, currentVersion: documents.currentVersion, propertyName: properties.name, reviewDueAt: documents.reviewDueAt, retentionUntil: documents.retentionUntil, fileName: documentVersions.fileName, contentHash: documentVersions.contentHash }).from(documents).leftJoin(properties, eq(properties.id, documents.propertyId)).leftJoin(documentVersions, and(eq(documentVersions.documentId, documents.id), eq(documentVersions.version, documents.currentVersion))).where(and(eq(documents.entityId, input.entityId), or(isNull(documents.propertyId), inArray(documents.propertyId, input.propertyIds)), gte(documents.createdAt, new Date(input.rangeStart)), lte(documents.createdAt, new Date(input.rangeEnd)))).orderBy(desc(documents.createdAt));
  return {
    type: "document_register", entityName: input.entityName, propertyName: input.propertyName, recordCount: rows.length, sourceCounts: { documents: rows.length },
    sections: [{ title: "Controlled document index", records: rows.map((row: any) => ({ title: row.title, detail: [`${row.propertyName ?? "Entity-level"} · ${titleCase(row.documentType)}`, `Classification: ${titleCase(row.classification)}`, `Status: ${titleCase(row.status)}`, `Version ${row.currentVersion}`, row.fileName ? `Stored file: ${row.fileName}` : "No file version", row.reviewDueAt ? `Review due ${new Date(row.reviewDueAt).toLocaleDateString("en-GB")}` : null, row.retentionUntil ? `Retain until ${new Date(row.retentionUntil).toLocaleDateString("en-GB")}` : null, row.contentHash ? `SHA-256: ${row.contentHash}` : null].filter(Boolean).join(" · "), status: row.status })) }],
  };
}
