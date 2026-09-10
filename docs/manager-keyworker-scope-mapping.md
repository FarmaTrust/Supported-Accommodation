# Manager and Key Worker App Scope Mapping

## Delivery decision

The attached proposal recommends a native iOS and Android staff app with a wider manager dashboard, but it also recognises that a mobile-first web application is a viable route. This release implements the **mobile-first web experience** inside the existing Supported Accommodation Hub. It keeps the current platform as the authoritative source for users, properties, placements, shifts, evidence, reports, incidents, staff requests, notifications and audit events. No second operational data store is introduced.

## Requirement traceability

| Proposal area | Current platform capability | This release | Deferred boundary |
| --- | --- | --- | --- |
| Role-aware home and navigation | Authenticated entity, property and placement scope is already server-enforced | Dedicated Manager App and Key Worker App entry routes, role-safe empty/restricted states, large mobile quick actions | Native app shell and app-store distribution |
| Shifts, rota and time entry | Authoritative rota, clock events, coverage, breaks, timesheets and change requests exist | Mobile current-shift card, clock-in/out guidance and controlled exception path | Device attestation, background geofencing and automatic lateness alerts |
| Key-worker operational records | Assigned placement context, reports, incidents, handover, care and staff self-service modules exist | Mobile caseload, current shift, urgent workload and contextual quick-action hub | Voice transcription, camera-first scanning and native offline storage beyond the existing encrypted report/incident queue |
| Manager oversight | Existing manager queue, staffing records, reports, incidents, staff requests, compliance and work plans exist | Consolidated exception inbox and actionable mobile manager overview linked to authoritative workflows | Configurable manager analytics, background escalation and external authority workflows |
| Property, visitors, curfew and maintenance | Existing guarded operations and care routes own these records | Quick links and visible operational status from the app homes | New category, policy, escalation and retention configuration |
| Notifications | In-app current-user notifications and staff-request outcome alerts are delivered | Role-specific notification entry point and unread visibility reuse | Email, SMS and provider push delivery require approved adapters and supplier testing |
| Security and governance | Entity, property, placement, sensitivity and record-state checks are evaluated server-side; audit logging is established | Apps call existing scoped procedures and do not accept identifiers as evidence of access | Formal device-management, MFA policy, penetration testing and organisational role-account acceptance |

## Implemented product scope

The Manager App is a mobile-responsive operational cockpit for authorised managers. It provides an exception-led summary and direct paths to review staff requests, rota requests, incidents, reports, safeguarding, compliance, work plans and the existing broader dashboards. It is not a replacement for the full manager configuration workspace.

The Key Worker App is a mobile-responsive operational hub for the current staff member. It provides current-shift and assigned-caseload context, direct access to the established report, incident, visitor, handover, curfew, staff-request and notification workflows, and controlled clock-in/out actions. The underlying server remains responsible for every property, placement, shift and clock-event decision.

## Product limitations

The user-supplied proposal identifies several discovery decisions that must precede a native rollout. This web release does **not** claim native iOS or Android packaging, background geofencing, biometric relock, camera optical character recognition, external messaging delivery, live chat, payroll, app-store distribution or off-device sync. It does not hard-code organisation-specific curfew, escalation, age, retention, report-template or notification policy.

The existing encrypted device queue remains limited to its supported Key Worker record operations. Any expansion to offline clocking, visitor logs, handovers, location data or sensitive file capture requires an explicit device-risk decision, encryption design, expiry model and reconnection review.
