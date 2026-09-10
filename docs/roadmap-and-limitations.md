# Supported Accommodation Hub — Known Limitations and Roadmap

This release extends the **user-approved frozen recovery baseline**. It preserves the stable operational core and recovered assurance, Regulation 28/32, care, safeguarding, advanced rota, controlled offline Key Worker, data-rights, regulatory-framework and management-outcomes workspaces. It is suitable for structured configuration and user acceptance, but it is not approved as the sole production record for every regulated process.

## Checkpoint succession

The abandoned objective of one complete post-reset recovery checkpoint was replaced by a user-approved frozen-scope delivery to reduce further rebuild time. Version `30a71ba5` is the frozen recovery baseline. Version `d682da4e` is the subsequent validation, manager-calendar, fictional-test-data and reusable-skill upgrade. This release completes the data-rights workspace, regulatory-framework designer and management-outcomes reconstruction against the existing reconciled database tables. The integration hub remains deferred because no external supplier credentials or live integration tests were supplied.

## Pre-live governance requirements

| Priority | Requirement | Reason |
| --- | --- | --- |
| Critical | Complete and approve a DPIA, records-of-processing entry, privacy notices, lawful-basis matrix and information-sharing policy | The platform handles children’s, safeguarding, criminal-offence, workforce and geolocation data |
| Critical | Approve the role matrix, entity/property membership process, break-glass process and quarterly access review | Default profiles require organisational sign-off and named ownership |
| Critical | Approve the retention schedule and deletion/transfer procedure | Case records may require retention for 75 years from birth or 15 years from death, while other service records have a different minimum period.[1] [2] |
| Critical | Configure MFA/SSO assurance and step-up policies in the identity provider | The application is MFA/SSO-ready but does not independently attest authentication strength |
| Critical | Conduct penetration, backup/restore, disaster-recovery and independent accessibility testing | Local type, unit, build and visual checks are not substitutes for independent assurance |
| High | Validate Ofsted, host-authority and multi-agency notification recipient rules with safeguarding leads | The product structures and clocks notifications but does not submit to external agencies |
| High | Obtain tax review of each fee schedule and VAT treatment | VAT treatment depends on the provider’s supplies and circumstances |

## Functional roadmap

| Stage | Enhancement | Value |
| --- | --- | --- |
| 1 | Complete live identity-provider sign-off for owner, manager, support, HR/compliance, finance and read-only accounts, including MFA and recovery checks | Confirms organisation-owned identity assurance against the documented role matrix |
| 1 | Connect an approved malware-scanning service and quarantine workflow to pending document versions | Adds independent content inspection beyond MIME, size and hash controls |
| 1 | Configure off-platform backup, recovery drills, log alerting and security monitoring | Completes operational resilience and non-repudiation assurance |
| Delivered in frozen release | Regulation 28 decisions, Regulation 32 review workspace, specialist safeguarding, enhanced care, advanced rota controls and controlled offline Key Worker synchronisation | Available for user acceptance subject to organisational policies, training and live-role testing |
| Deferred | Controlled payroll, accounting, e-signature, email/SMS and local-authority integrations | No supplier credentials or live external service tests were provided; exports and evidence remain human-controlled |
| Delivered in this release | Data-subject rights case management | Permission-scoped cases, encrypted requester fields, independent identity verification/approval, controlled lifecycle, delivery evidence and audit records |
| Delivered in this release | Regulatory-framework designer | Source-linked framework drafts with explicit review, independent approval and independent activation/supersession controls |
| Delivered in this release | Management analytics and configurable outcome measures | Defined measures, independent activation, deliberate pause, period validation and server-scoped observations; management judgement remains essential |

## Current boundaries

The application does not fabricate statutory compliance. A green RAG state means that the configured due date/evidence state is currently satisfied; it is not a legal opinion. Geolocation is browser-reported and records accuracy, distance and overrides, but it cannot prove physical presence against deliberate device manipulation. Generated packs and invoices are dated snapshots and must be reviewed before external issue.

The audit stream is hash chained and new events are mirrored to unique object-storage receipts. The Assurance workspace verifies both chain links and stored receipt bodies; older events without mirrors are reported as receipt issues rather than treated as verified. The managed TiDB environment does not provide the attempted trigger/privilege strategy for database-enforced insert-only tables, so stronger non-repudiation should add independent off-platform log export and alerting for chain discontinuity. Document scan retry/quarantine controls are present, but an approved external malware-scanning provider must still be connected and live-tested.

The database had already received additive upgrade migrations before the sandbox reset. Recovery introspected the live database and reconciled the typed source schema to **100 tables**, but the restored repository does not contain a complete historical migration-file chain for every post-checkpoint change. Do not generate or apply a new migration from this checkpoint until a developer first baselines the live schema and migration journal in a controlled non-production environment.

Offline Key Worker storage is encrypted and minimal, but a managed device can still be lost or compromised. Organisations must configure device encryption, screen lock, remote-wipe, session timeout, breach response and staff instructions. Queued records expire after 48 hours and require conflict review; users must not rely on offline mode for emergency or time-critical safeguarding escalation.

The Governance & outcomes page has passed code, route, empty-state and TEST-only loaded-state desktop and phone checks. The loaded-state check used an existing authorised owner session with access to the isolated TEST entity. Separate non-production identity-provider role-account sign-off remains required before production activation; the project must not insert records that could be mistaken for genuine data-rights, regulatory or young-person operational evidence into the live workspace.

## References

[1]: https://www.legislation.gov.uk/uksi/2023/416/regulation/24/made "Regulation 24 — Children’s case records"
[2]: https://www.legislation.gov.uk/uksi/2023/416/regulation/25/made "Regulation 25 — Other records"
