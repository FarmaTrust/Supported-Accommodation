# Supported Accommodation Hub — Product Architecture

## Product boundary

The first delivery is a secure, responsive operational system of record for multiple legal entities and properties. It supports authenticated internal users and controlled external sharing. It is not a substitute for professional safeguarding judgement, legal advice, payroll software, banking software, an Ofsted submission portal, or a local authority’s case-management system. It prepares, records and evidences those workflows while preserving human review and formal submission evidence.

## Architecture decisions

| Decision | Selected approach | Reason |
| --- | --- | --- |
| Tenancy | One platform with strict entity and property scoping | Enables consolidated owner oversight while keeping ordinary users within explicit memberships |
| Authorisation | Server-enforced attribute and role-based checks | Role alone is insufficient for assigned-young-person, property, finance, HR and safeguarding restrictions |
| Operational timestamps | UTC instants plus explicit business timezone | Prevents rota, deadline and invoice drift while supporting England-based display conventions |
| Documents | Object storage for bytes; relational metadata and permissions in the database | Avoids database bloat and enables restricted downloads, versioning, retention and audit |
| Automation | Idempotent scheduled HTTP jobs over due-item queues | Survives autoscaling and supports deterministic reminders without long-running processes |
| Compliance | Versioned rules plus generated obligations | Future regulations can be added without adding a column or table per requirement |
| Accounting | Immutable issued snapshots and corrective documents | Preserves evidence and supports sequential-number control, credit notes and disputes |
| Audit | Append-only events for sensitive reads and all important changes | Provides access evidence without allowing operational users to edit history |
| Mobile | Responsive web application with a dedicated Key Worker mode | Delivers immediate phone usability while retaining one permissions and data model |

## Scope model

Every sensitive business record is linked to an **entity**. Property-bound records also hold a **property**. Young-person records are accessed through placement/property and explicit worker assignment. Records may carry an additional sensitivity class such as general, HR, finance, safeguarding, criminal-offence data, bank data or restricted management.

The permission engine evaluates requests in this order:

1. The user must have an active authenticated account.
2. The user must hold an active membership for the record’s entity, unless a platform-owner grant explicitly allows consolidated oversight.
3. If the record is property-bound, the membership must include the property or an entity-wide property scope.
4. The user’s operational role must permit the requested action for the record family.
5. Any data-class restriction must be satisfied, such as HR, finance, safeguarding or bank-data permission.
6. Young-person records require a current explicit assignment for support workers; manager and restricted oversight access is separately permissioned.
7. Record-state rules are applied, such as immutable issued invoices, approved plan versions or closed incidents.
8. Step-up or dual approval is required for configured high-risk actions.
9. The decision, scope and reason are written to the audit stream for sensitive allowed and denied actions.

The database is treated as untrusted input from an authorisation perspective: every API request derives visible entity and property identifiers from the authenticated user’s memberships and never accepts client-supplied scope as proof of access.

## Operational roles

| Role | Typical scope | Principal capabilities | Principal restrictions |
| --- | --- | --- | --- |
| Platform administrator | Platform infrastructure | Account setup, technical configuration, support diagnostics | No default young-person or finance access |
| Owner / responsible individual | All assigned entities | Consolidated assurance, entity configuration, finance, audit, quality review | Sensitive views remain audited; HR detail may be separately granted |
| Registered service manager | Assigned entities and properties | People, placements, incidents, rotas, compliance, support plans, quality reviews | Bank changes and HR disciplinary detail restricted |
| Support / key worker | Assigned properties, shifts and young people | Clocking, handovers, daily/weekly/monthly reports, incidents, assigned plans | No unrelated young people, finance, DBS, bank or broad exports |
| HR / compliance | Assigned entities/properties | Recruitment, DBS/RTW, training, policies, property/workforce compliance | No young-person case narrative or bank data |
| Finance | Assigned entities | Fee schedules, invoices, statements, payments and bank snapshots | Minimum placement references only; no case notes |
| Read-only auditor / regulator liaison | Explicit temporary scope | Read/export approved evidence packages | No changes, secure-data scope must be granted and time-limited |

Permissions are stored as stable capabilities rather than scattered role-name comparisons. Default role profiles can be customised per entity, but changes are versioned and audited.

## Domain model

| Domain | Core records | Important relationships |
| --- | --- | --- |
| Identity and scope | users, memberships, property grants, capabilities, access reviews | User → entity → property → role/capabilities |
| Organisations | entities, service registrations, regulatory regimes, local authorities, contacts, bank accounts | Entity → registrations/properties/invoice sequences |
| Accommodation | properties, units, occupancy events, licences, leases, insurance, safety evidence, location assessments, repairs | Property → units → placements/occupancy/compliance |
| Workforce | staff profiles, employment, recruitment checks, qualifications, training, supervision, appraisal, policy acknowledgements | Staff → entity/property grants → shifts/assignments/compliance |
| Young people | references, referrals, matching decisions, placements, assignments, plans, plan versions, contacts, reviews, reports | Young person → placement → property → assigned workers |
| Operations | shifts, requirements, offers, swaps, clock events, handovers, timesheets, payroll exports | Property → shift → staff → clock/timesheet |
| Safeguarding | incidents, triage decisions, notifications, agency contacts, outcomes, lessons and follow-up actions | Incident → young person/property → notification → work plan |
| Compliance | rule definitions, applicability, obligations, evidence, reminders, escalations, exceptions | Any scoped record → obligation → evidence/action |
| Quality and improvement | audits, quality reviews, feedback, work plans, actions, dependencies, evidence | Finding/event → action → owner/date/escalation |
| Documents | documents, versions, classifications, links, templates, generation jobs, acknowledgements, retention events | Document/version → any record → access/export audit |
| Finance | fee schedules, contracts, invoice sequences, invoices, lines, payments, credits, reminders, statements | Placement + fee schedule → invoice snapshot → payment |
| Sharing | provider packs, pack versions, secure links, access events, revocation | Pack snapshot → expiring token → view/download events |
| Notifications | due events, in-app notifications, delivery attempts, ownership routes, job runs | Obligation/action/invoice/review → notification → recipient |
| Audit | activity events, before/after hashes, export manifests, permission decisions | Actor + action + record + scope + request context |

## Reuse and pre-population rules

The system stores facts once and presents their source whenever they are reused. Entity registration and branding populate packs and invoices. Property address, registration and vacancy data populate referrals, placements, rota locations, key-worker forms and provider packs. Placement references, authority details, fee schedules and occupancy periods populate invoices. Assignments populate key-worker selectors and prevent workers seeing unrelated young people. Compliance evidence produces obligations and dashboard priorities. Incidents, audits and overdue obligations can create work-plan actions with an explicit source link.

Pre-populated values remain reviewable. Generated documents and issued invoices preserve snapshots so later source changes do not rewrite historic evidence.

## Proactive operating model

The core automation is deterministic. A scheduled job evaluates active obligations and business records, upserts due events idempotently, assigns the correct owner from entity/property routing rules and creates in-app notifications. Escalations are separate records with first-due, last-notified, next-notification and resolution timestamps. Repeated job execution cannot duplicate reminders for the same rule, record and escalation stage.

| Rule family | Default owner | Trigger examples | Escalation outcome |
| --- | --- | --- | --- |
| Property compliance | Property manager, then registered manager | Certificate lead date, expiry, repair SLA | Work-plan action and RAG downgrade |
| Workforce compliance | HR/compliance, then registered manager | DBS/RTW/training/supervision due | Rota warning or assignment block |
| Placement and plans | Key worker, then manager | Review date, plan approval, placement milestone | Dashboard priority and manager task |
| Quality review | Registered manager, then responsible individual | Six-month review window, 28-day report deadline | Governance alert and overdue action |
| Policy acknowledgement | Staff member, then line manager | New approved version or due date | Reminder, manager queue and compliance effect |
| Work plans | Action owner, then manager | Target date or dependency completion | Escalation and improvement dashboard impact |
| Invoices | Finance owner, then entity owner | Draft approval, due date, ageing threshold | Reminder task, statement queue and debt status |

External email, SMS, push, e-signature and accounting integrations remain optional adapters. The core database records notification intent and delivery status even when only in-app notification is enabled.

## Audit and immutability

Audit events include timestamp, actor, impersonation or scheduled-job context, entity/property scope, action, resource type and identifier, sensitivity, result, reason code, request correlation identifier and a minimal metadata payload. Sensitive values are not copied into the audit payload. Change events use canonical hashes and permitted summaries rather than full safeguarding or bank details.

Application procedures never expose update or delete operations for audit events. Issued invoice snapshots, submitted notification versions, approved plan versions and document versions are superseded rather than mutated. Operational deletions become archived states unless an approved retention process authorises cryptographic/object deletion and records a non-sensitive deletion receipt.

## Delivery approach

The implementation will expose all requested domains through a coherent navigation system, working database-backed summaries and representative creation flows. Highly regulated actions such as formal Ofsted submission, payroll import and external email delivery will prepare and record the workflow but remain pending external service configuration and organisational policy approval. Location verification will use browser geolocation, stored property coordinates and a configurable tolerance, while clearly recording accuracy and off-site overrides rather than claiming tamper-proof attendance.

