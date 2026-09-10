# Supported Accommodation Hub — Implementation and Operator Guide

**Author:** Manus AI  
**Delivery stage:** Frozen-scope recovery release for user acceptance  
**Scope:** Multi-entity supported-accommodation operations in England

## Purpose

The Supported Accommodation Hub is a secure operational system of record for legal entities, properties, workforce evidence, placements, key-worker reporting, rotas, compliance, work plans, documents, provider packs and local-authority invoicing. The product is designed to reduce repeat entry: entity facts feed properties, provider packs and supplier snapshots; property information feeds placement, rota, clocking and reporting workflows; and placements, authorities and effective-dated fees feed invoice drafts.

The platform operationalises records and evidence, but it does not replace management judgement, safeguarding decisions, professional tax advice, payroll software or submission to Ofsted and local authorities. The Supported Accommodation (England) Regulations 2023 require structured records, policies, notifications, quality reviews and secure record keeping; these obligations informed the database and workflow architecture.[1]

## Delivered platform

| Area | Current capability |
| --- | --- |
| Identity and scope | Authenticated accounts, owner bootstrap, operational roles, entity memberships, property assignments, server-side capability checks and support-worker placement assignment checks |
| Entity and property | Multiple legal entities, encrypted bank setup, supplier and Ofsted references, invoice sequences, properties, units, vacancies, occupancy history, geofences and certificate/insurance/tenure/maintenance evidence registers |
| Workforce | Staff profiles plus typed checks for identity, DBS, Right to Work, references, qualifications, training, induction, probation, supervision, appraisal and policy acknowledgement |
| Young people | Reference-led referrals and placements, authority and professional contacts, assignment-restricted access, plans with versions and approvals, reviews and incident records |
| Key Worker | Phone-first incident, daily, weekly and monthly reporting, address/reference selectors, guided prompts, encrypted IndexedDB drafts, controlled offline submission, idempotent reconciliation, conflict review and manager review states |
| Operations | Property rota, manager week calendar with drag/drop and accessible move controls, simultaneous minimum-coverage states, property-eligible Key Workers, role/qualification/rest warnings, staff availability, replacement/additional staffing, affected-worker acknowledgements, policy-driven working-time exceptions, worked-shift summaries, clocking, handovers, timesheet approval and payroll CSV export |
| Care and safeguarding | Assigned-placement health monitoring, medication administration and acknowledgement, curfew, college/court activity, complaints, allegations, missing episodes, return interviews, restraint review and behaviour-support learning |
| Statutory review and assurance | Regulation 28 admission/discharge decisions, Regulation 32 six-month reviews, identity assurance, document quarantine/resubmission, resilience checks, hash-chain verification and object-receipt verification |
| Compliance | Unified property/staff dashboard; configurable HMO, Ofsted, gas, electrical, fire, insurance and other property certificates; DBS, Right to Work and training renewals; approved evidence links; red/amber/green/grey renewal states; 90/60/30-day in-app reminders; inactive email-ready outbox; inspection exports |
| Information rights and governance | Encrypted data-rights requester records; independent identity verification and case approval; explicit collection, redaction, delivery and closure states; source-linked regulatory-framework draft/review/approval/activation; and independently activated outcome measures with scope-validated observations |
| Improvement | Source-linked actions with accountable owner, target date, dependencies, overdue escalation, progress, controlled evidence, independent completion review and append-only history |
| Documents and packs | Classified folders, object-storage uploads, immutable versions, templates, policy acknowledgements, retention/legal-hold review, deletion receipts, inspection manifests and expiring/view-limited provider-pack links |
| Finance | Scoped/effective fee schedules, 28-day suggestions, VAT, duplicate-period checks, independent draft approval, atomic numbering, immutable snapshots, payments, credits/reissues, disputes, reconciliation, aged debt, generated PDFs and expiring secure delivery |
| Search and notification | Permission-aware cross-record search, role-default saved views, favourites, recent records, dashboard data-quality priorities, in-app notification acknowledgement/snooze/resolution and direct links |
| Automation | Manual and managed daily evaluation for property certificates, staff checks/training, compliance, plans, placements, work plans, policies and invoices, with idempotent keys, owner routing, escalations, overdue transitions and delivery history |
| Audit | Hash-chained application events mirrored to unique object-storage receipts for sensitive reads, writes, downloads, exports, logins, permission decisions, secure external views and automation |

## Initial setup order

The owner should complete setup in the following sequence because each later record reuses earlier facts.

| Step | Action | Why it comes first |
| --- | --- | --- |
| 1 | Create the legal entity | Establishes accountable supplier, Ofsted and invoice scope |
| 2 | Review entity invoice and bank settings | Controls issued-number prefix, VAT defaults and invoice snapshots |
| 3 | Add properties and units | Establishes operating addresses, capacity, vacancies and geofences |
| 4 | Add local authorities | Supplies placement and invoice customer details |
| 5 | Add workforce profiles and checks | Enables safer rota and assignment decisions |
| 6 | Create referrals and placements | Links a reference, property, authority and key worker |
| 7 | Add fee schedules | Enables effective-dated invoice calculation |
| 8 | Add compliance obligations and plans | Populates priorities and proactive reminders |
| 9 | Run automation manually | Confirms owner routing and initial due-state calculations |
| 10 | Publish, then enable daily automation | Managed callbacks require the published application URL |

## Role model

| Role | Intended access |
| --- | --- |
| Owner | Consolidated legal-entity oversight, configuration, finance, audit, operational and safeguarding records |
| Registered manager | Assigned entities/properties, workforce, placements, incidents, compliance, rotas, plans and assurance information |
| Support worker | Assigned properties, shifts and explicitly assigned young people; Key Worker reports and incidents; no HR, bank or finance detail |
| HR/compliance | Workforce and property compliance evidence, policies and assurance records; no case narrative or finance detail |
| Finance | Authorities, fee schedules, invoices, payments and approved provider-pack information; no unrestricted case notes |
| Read-only | Explicitly scoped operational views without write, issue or configuration privileges |
| Platform administrator | Technical configuration only by default; no automatic access to business records |

The server derives access from the authenticated account and active membership. A browser-supplied entity, property or placement identifier is never treated as evidence of permission. Sensitive young-person access uses active explicit worker assignments, and meaningful sensitive reads and denied decisions are written to the audit stream.

### Company-admin access control

Open **Access control** to manage active members of the selected legal entity. This workspace is available only to an active company administrator (the existing `owner` role) within that entity; it is not a platform-wide administrative view. It shows each member’s operational role, all-property or named-property scope, and any permitted additional capabilities.

Select **Manage access** beside a member, choose a controlled role from the dropdown, then either enable all-company-property access or select named properties. The available capability list is intentionally narrow: core role permissions are derived server-side and cannot be widened in the browser. Every change needs a business reason of at least 20 characters. The server rejects cross-company target users and properties, inactive targets, invalid roles/capabilities, self-removal from the owner role, and removal of the last active company administrator. Successful changes replace the member’s property grants atomically and record restricted audit evidence containing the prior scope, next scope, actor and reason.

### Secure sign-in and access messages

The public sign-in screen checks the existing secure session before presenting an action. During this check, it shows a visible loading animation and the message **“Checking your secure session…”**. When sign-in cannot be completed, the screen presents plain-English feedback alongside a stable developer code that can be quoted to support or an administrator. It never displays raw provider, cookie, token, tenant or account-enumeration detail.

| Code | Plain-English meaning | Operator action |
| --- | --- | --- |
| `AUTH_SIGN_IN_INCOMPLETE` | The provider did not return enough information to complete sign-in. | Start a new sign-in and keep the browser window open until it returns. |
| `AUTH_SIGN_IN_EXPIRED` | The one-time sign-in attempt expired or did not match the browser session. | Start a new sign-in. |
| `AUTH_PROVIDER_REJECTED` | The sign-in provider did not accept the supplied verification. | Check the details with the provider and retry; the Hub does not receive or display passwords. |
| `AUTH_SESSION_INVALID` | The stored secure session ended or could not be verified. | Sign in again. |
| `AUTH_ACCESS_DENIED` | The user is signed in but lacks the current role, property scope or capability. | Ask a company administrator to review **Access control**. |
| `AUTH_NO_WORKSPACE_ACCESS` | The user has authenticated but has no active company membership. | A company administrator must add the user to the correct legal entity. |
| `AUTH_SIGN_IN_FAILED` or `AUTH_SERVICE_UNAVAILABLE` | The sign-in path could not complete safely. | Retry once; if it persists, provide the displayed code to support. |

An unauthorised or forbidden API response is not silently redirected. The application shows a plain-English authority banner with the relevant code. This preserves a clear explanation of why a page or action is unavailable without exposing sensitive access-control logic.

### Account recovery and support contacts

When a sign-in error is shown, users can select **Account recovery** to restart the secure identity-provider journey or **Email a support request** to open a prefilled email. The email includes only the developer code and current page; it explicitly warns users not to include passwords, one-time codes or sensitive case details. The Hub does not store, reset or reveal passwords.

Company administrators can open **Access control → Configure support** to set a tenant-scoped support contact name, email, telephone number and concise guidance. At least one email address or telephone number is required. These fields appear in the signed-in access-denial banner for the selected company only. Updating them requires `config.write` and creates a restricted audit event.

## Compliance and safeguarding operation

The compliance calendar uses an obligation’s due date, lead period, completion state and evidence link to calculate green, amber, red or grey status. Serious-event records include severity, immediate actions, notifiability, recipient fields, an explicit due clock, submission evidence, learning and follow-up state. Regulation 27 uses the statutory wording **“without delay”**, so the interface does not imply that every serious event shares a universal 24-hour limit.[2]

The **Compliance dashboard** presents every accessible property as a certificate matrix and combines property and permitted staff totals in colour-coded cards. Controlled property categories cover HMO licence, Ofsted registration/renewal, gas safety, electrical safety, fire safety, property insurance and an explicitly named other legal/regulatory certificate. Applicability must be confirmed for each premises: the existence of a category does not state that every certificate is legally required for every property.

The **Property records** workflow requires a reference, issuing body or inspector, issue date and later expiry/review date; invalid chronology is rejected by the server with a corrective field message. An approved certificate/evidence document attached to the same property can be selected when creating the record or linked later. Staff records use controlled DBS, Right to Work, safeguarding, first aid, medication, fire safety, food hygiene, manual handling and other-training categories. Staff evidence must be an approved HR-classified certificate. A record is red when overdue, due within 30 days or missing approved evidence; amber at 31–60 or 61–90 days; green beyond 90 days with evidence; and grey where no renewal date is recorded. Calendar obligations governed by certificate evidence cannot be manually completed to bypass evidence linking.

Placement commencement and closure records hold the facts needed for a Regulation 28 admission or discharge decision. Quality and work-plan records are designed to receive six-month review findings and track resulting actions. Regulation 32 requires a quality review at least every six months and a report to Ofsted within 28 days of completion, which should be configured as an organisation-owned obligation.[3]

## Invoicing operation

An invoice starts as an internal draft without a statutory invoice number. The issue action locks the customer, supplier, placement reference, 28-day period, fee, VAT and bank snapshot, and commits the next per-entity number atomically. Issued records are not edited; later corrections should use a credit and reissue process. This reflects HMRC requirements for uniquely identifying sequential invoice numbers and retained invoice records.[4]

A different authorised user must approve a draft before issue. The platform can then render a branded PDF from the issued snapshot, store its content hash and file metadata, and create expiring, revocable, view-limited delivery links. Delivery, external views, reminders, disputes, payments, credits and reconciliation all join one invoice chronology. Statements calculate current, 1–30, 31–60, 61–90 and 90-plus-day balances after payments and credits.

### PDF delivery and statements of account

The generated invoice PDF takes its supplier, customer, Local Authority, PO, placement reference, fee period and VAT facts only from the immutable issued-invoice snapshot. An authorised user can download/view the stored PDF, create a recipient-bound secure link, or open an email with an approved recipient and message prefilled. Because no email provider is connected, staff must attach the generated PDF themselves and send it through their approved mail system; the interface states this clearly.

Finance users and registered managers can create a Local Authority or all-authority statement for a chosen date range of up to three years. The API validates dates and calculates opening balance, billed value and closing balance server-side using dated invoices, payments and issued credits. Users can download CSV or use **Print / save PDF** for the currently authorised range.

VAT treatment remains a controlled setup decision. The product calculates from the selected effective fee schedule, but the provider remains responsible for confirming whether a supply is standard-rated, reduced-rated, zero-rated, exempt or outside scope with its professional adviser.

## Secure provider packs

Provider packs are dated snapshots rather than live direct database views. A secure token is stored only as a SHA-256 hash. Each link has an expiry and view limit, can be revoked, increments its view count transactionally, and records an external-view audit event. The external page identifies its expiry and bank-detail inclusion state and provides a printable layout.

## Evidence, retention and inspection exports

Document bytes live in object storage while access scope, classification, folder, version, scan state, hash, approval, review and retention facts remain relational. The Compliance dashboard can create a restricted **Certificates** root with property folders for HMO, gas, electrical, fire, insurance, Ofsted and other legal certificates, plus HR-classified staff folders for DBS/Right to Work and each training family. Library rows display folder, classification, version, scan/quarantine state and approval state. Restricted downloads and exports are permission checked and audited. Retention actions require a recorded basis and independent decision; legal hold prevents deletion approval. Completing an approved document deletion clears storage references, archives the document metadata and records a non-sensitive deletion receipt rather than silently removing history.

Inspection exports preserve scope, redaction choice, included-record counts and a manifest hash. Property evidence records generate or update the related compliance obligation so renewals appear in the same calendar rather than a separate spreadsheet.

## Automation and publishing

The background evaluator is idempotent: each reminder has a stable key based on record, user and renewal band, so retries update rather than multiply notifications. Property certificates, staff checks and staff training create reminders at the 90-day, 60-day and 30-day bands and remain overdue thereafter. Recipient routing prefers the record owner or staff member and manager, with registered-manager/owner fallback. The selected deployment uses in-app reminders plus persisted email-ready delivery records. The email connection is visibly inactive and no external transmission is attempted until an approved provider is configured and tested.

Managed daily automation cannot be activated against the development preview because callbacks require a deployed URL. After reviewing the checkpoint, use the **Publish** button. Then open **Search → Automation**, run the evaluator manually, and enable one daily schedule. Schedules can be inspected, paused, resumed and investigated from the project’s Schedules panel.

## Information rights, regulatory frameworks and outcomes

The **Governance & outcomes** workspace is a controlled operational aid rather than a legal decision engine. It stores requester and identity-reference fields encrypted at rest, records lifecycle actions in a case event stream, and writes restricted audit events for case creation, identity decisions, status changes, approvals and delivery evidence. A case must have a verified or not-required identity decision before it can be prepared for independent approval. The same user cannot create and verify a case, or approve a case they created or verified. Recording delivery creates evidence only; it does not transmit personal data.

Regulatory-framework records retain an authoritative source URL and move through draft, review, independent approval and independent activation states. Activating a framework supersedes an active record with the same name and jurisdiction rather than silently replacing it. Outcome measures begin as drafts, require a different authorised user to activate them, and can be paused deliberately. Outcome observations are accepted only for active measures, a valid time period and a placement that passes server-side scope checks. These controls support governance review but do not determine whether the organisation has met a legal obligation.

## Validation, overrides and manager rota calendar

Date chronology is enforced on the server. A shift, activity or timesheet period cannot end before or at its start; the interface repeats the rule immediately and preserves the server’s corrective message. Invalid chronology is not overrideable because it would corrupt duration, overlap and payroll calculations.

Young-person age is calculated using calendar birthdays on the referral or placement date. The configured default minimum is 14. An owner or registered manager can record an exceptional under-14 decision only with a reason of at least 20 characters. The reason is encrypted, the decision is included in restricted audit metadata, and a future or invalid date of birth cannot be overridden.

Owners and registered managers open **Rota & shifts → Manager calendar**. Dragging a shift preserves its duration and proposes a new worker/day; phone users use the visible **Move** action. Before saving, the server reloads the shift and rechecks optimistic version, both property scopes, active Key Worker membership, target-property assignment, chronology, overlap, rest, availability and the active working-time policy. Remaining warnings require a 20-character manager reason. Successful changes create affected-worker acknowledgement records and an audit event.

## Fictional training scenario

The development database contains a separate **TEST — Training Provider** entity for `TEST-SA-TRAINING-2026`: three TEST-labelled properties including **TEST — Radford House at 30 Radford Road**, seven fictional Key Workers using reserved `example.test` email addresses, three fictional young people per property and 42 rota shifts. Run `pnpm testdata:load -- 1` from the project directory; `1` identifies the source owner used to attribute creation, while records are isolated in the TEST entity. Run `pnpm testdata:verify -- 1` to load twice and verify exact counts, distribution and zero leakage into entity 1. The loader uses stable natural keys, replaces only scenario-owned shifts and does not create genuine compliance evidence. See `docs/test-data-guide.md`.

## Offline Key Worker operation

Offline support is intentionally limited to the active Key Worker page and the signed-in user. Minimal report or incident payloads are encrypted in IndexedDB with a non-extractable Web Crypto key, bound to the authenticated user and a non-sensitive random device identifier, and expire after 48 hours. The queue does not cache broad placement, HR, finance, bank or document data. Reconnection retries occur only while the authenticated workflow is open; there is no persistent browser or server worker.

Every queued item carries a user-bound idempotency key and a placement-version snapshot. The server rechecks current entity, property, placement assignment and restriction rules before writing. Duplicate submissions return the original outcome, stale or unauthorised records become explicit conflicts, and the user must review, re-queue or discard them. Offline storage is a resilience aid, not a substitute for incident escalation, emergency contact or safeguarding procedures.

## Data protection and workforce cautions

Processing children’s data, special-category information, criminal-offence information and geolocation can trigger a data-protection impact assessment where processing is likely to be high risk.[5] Before live use, the organisation should approve its lawful bases, privacy notices, retention schedule, subject-access/redaction process, incident response process and DPIA register.

DBS records should be minimised. Official guidance indicates that certificate information should normally be destroyed after a suitable period, usually no longer than six months; the application therefore favours compliance metadata and restricted evidence references rather than broad certificate visibility.[6] Right to Work procedures and check rules should be reviewed against the current Home Office guide before onboarding staff.[7]

## Verification summary

| Check | Result |
| --- | --- |
| TypeScript | Passed with no errors |
| Vitest | 154 tests passed in 46 files, including company-admin RBAC rule and router contracts, last-owner protection, invalid role/capability rejection, restricted access-change audit evidence, cross-tenant authorization, property/staff certificate taxonomy, exact 90/60/30-day bands, stable reminder/outbox keys, no external email transmission, compliance authorization, HR evidence controls, safe sign-in status and public error-code coverage, data-rights state/approval/delivery controls, regulatory-framework separation, outcome-measure lifecycle, observation scope, governance-route contracts, and entity/tab deep-link validation |
| Production build | Passed; routes and React/UI/data/icon vendors are split so operational modules load on demand |
| Database state | The restored typed schema was reconciled to all 100 live tables. The database already contained the later additive upgrades before the sandbox recovery; see the limitations document before creating future migrations |
| Responsive review | Unified Compliance dashboard was verified at 1280 × 800 and 390 × 844; metric cards, matrix, tab strip, actions and certificate rows remain readable and touch accessible |
| Runtime smoke test | Authenticated Governance & outcomes route loaded after the final restart with no server errors, browser error-level entries or HTTP 4xx/5xx responses strictly after `2026-08-27T09:39:50.000Z` |

WCAG 2.2-oriented controls include persistent labels, visible focus styles, reduced-motion handling, keyboard-reachable actions, text-backed status indicators, responsive card alternatives and large phone targets. The Governance & outcomes empty state was reviewed at 1280 × 800 and 390 × 844; the page-level action, tab strip and information-rights empty state remained readable after the redundant case action was removed. Loaded-state visual acceptance remains an explicit non-production test task. A formal independent accessibility audit remains a pre-live governance action; GOV.UK identifies WCAG 2.2 AA as the appropriate target for public-sector services.[8]

## References

[1]: https://www.legislation.gov.uk/uksi/2023/416/contents/made "The Supported Accommodation (England) Regulations 2023"
[2]: https://www.legislation.gov.uk/uksi/2023/416/regulation/27/made "Regulation 27 — Notification of a serious event"
[3]: https://www.legislation.gov.uk/uksi/2023/416/regulation/32/made "Regulation 32 — Quality of support review"
[4]: https://www.gov.uk/guidance/record-keeping-for-vat-notice-70021 "Record keeping (VAT Notice 700/21)"
[5]: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/when-do-we-need-to-do-a-dpia/ "When do we need to do a DPIA?"
[6]: https://www.gov.uk/guidance/dbs-check-requests-guidance-for-employers "DBS checks guidance for employers"
[7]: https://www.gov.uk/government/publications/right-to-work-checks-employers-guide "Right to work checks: an employer's guide"
[8]: https://www.gov.uk/service-manual/helping-people-to-use-your-service/understanding-wcag "Understanding WCAG 2.2"
