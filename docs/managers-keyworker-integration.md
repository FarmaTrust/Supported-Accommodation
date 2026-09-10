# Managers and Keyworker Workspace Integration

## Product boundary

The Managers and Keyworker experience is a responsive workspace inside the Supported Accommodation Hub. It uses the existing Hub identity, memberships, property assignments, placement assignments, records, files, notifications, workflow states and audit history. It must not create a parallel staff, property, young-person, placement, shift, incident, document or notification system.

## Existing authoritative records to reuse

| Workspace need | Existing Hub source of truth | Current server surface |
| --- | --- | --- |
| Users and launch roles | `users`, `entityMemberships`, `propertyAssignments`, `workerAssignments` | `authz.ts`, `entities`, `keywork.context` |
| Properties and rooms | `properties`, `propertyUnits`, `occupancyEvents`, `propertyEvidence` | `entities` |
| Young people and placements | `youngPeople`, `placements`, `carePlans`, `professionalContacts`, `scheduledActivities` | `placements`, `care`, `keywork` |
| Rota and attendance | `shifts`, `shiftRequests`, `shiftChangeEvents`, `shiftChangeAcknowledgements`, `clockEvents`, `timesheets`, `timesheetEntries`, `handovers` | `operations`, `rotaControls` |
| Reports and incidents | `keyWorkerReports`, `incidents`, `incidentChronology`, `incidentWitnesses` | `keywork` |
| Safeguarding and missing | `allegations`, `allegationEvidence`, `complaints`, `complaintEscalations`, `missingEpisodes`, `restraintEvents`, `behaviourSupportEvents` | `safeguarding` |
| Medication and curfew | `medications`, `medicationAdministrations`, `curfewPlans`, `curfewChecks`, `healthMonitoringPlans`, `healthMonitoringEvents` | `care` |
| Staff compliance and supervision evidence | `staffProfiles`, `workforceChecks`, `staffAvailability`, `policyAcknowledgements`, `documentTemplates` | `workforce`, `governance`, `rotaControls` |
| Files and evidence | `documents`, `documentVersions`, `documentScanJobs`, folders and retention records | `documents`, `server/storage.ts` |
| Tasks, reminders and escalation | `workPlanActions`, `notifications`, `automationRules`, `integrationConnections`, `integrationDeliveries` | `workspace`, `scheduled.ts`, `complianceHub` |
| Offline submissions | `offlineSyncReceipts` plus encrypted IndexedDB device queue | `offlineSync`, `useOfflineKeyWorkerQueue` |
| Audit and assurance | `auditLogs`, `auditReceiptMirrors`, `auditVerificationRuns` | `services/audit.ts`, `assurance` |

## Genuine first-release gaps

| Gap | Required integrated extension |
| --- | --- |
| Property visitor log | Add visitor/presence records linked to existing properties, placements, documents and incidents. |
| Resident finance and valuables | Add placement-scoped ledgers, transactions, approvals, reconciliations and valuables without reusing invoice records. |
| Room and operational property checks | Add versioned checklist runs and failed-item links to work plans or maintenance. |
| Maintenance operations | Add repair jobs and updates linked to existing properties, rooms, visitors, documents, incidents and work plans. |
| Lone-worker safety | Add shift-scoped monitoring sessions and check-ins linked to existing shifts, properties, notifications and audit. |
| Staff self-service | Add profile-change, sickness and leave requests; reuse shifts, staff profiles, documents and Manager review. |
| Supervision workflow | Add explicit schedule, shared/manager notes, actions and acknowledgement while retaining workforce checks/templates as compliance evidence. |
| Medication depth | Extend the current administration record with self-administration, PRN review, stock transactions, counts and discrepancies. |
| Report review depth | Extend reports with return/approval/lock/addendum behavior while preserving existing report IDs. |
| Incident depth | Add people involved, evidence links, chronology and Manager review actions around the existing incident record. |
| Offline breadth | Extend the strict offline contract beyond reports/incidents to agreed frontline operations, with record-specific version checks. |
| Unified phone workspace | Replace the two-tab Key Worker page with task-led Home, Shifts, Property, People and More views that call existing domain routers. |

## Authorization contract

All reads and writes retain the existing evaluation order: active authenticated user, active entity membership, capability, property scope, active placement assignment for support workers, sensitivity restriction and record state. Keyworkers remain the existing `support_worker` operational role in storage and are presented as **Keyworker** in the workspace. Managers remain `registered_manager` or an equivalently authorised owner. New procedures must call the existing `assertEntityCapability`, `assertPropertyCapability` or `assertPlacementCapability` helpers and add independent-review checks where the actor must not approve their own record.

## Database baseline

The live database contains 101 tables, comprising the 100 typed domain tables in `drizzle/schema.ts` plus `__drizzle_migrations`. This matched the source baseline before this integration work began. Any new migration must extend the typed schema first, be generated and inspected, then be applied through the managed database workflow.

## Delivery approach

The implementation will first add the missing shared domain records and protected procedures, then assemble the integrated responsive workspace over both old and new procedures. Existing Manager pages remain authoritative review surfaces until the new action inbox links and consolidates them. Scheduled reminders use the Hub Heartbeat pattern and are not implemented with in-process timers. Email and SMS remain provider-dependent adapters; the Hub will record intent, delivery attempts and inactive-provider status without claiming successful transmission.
