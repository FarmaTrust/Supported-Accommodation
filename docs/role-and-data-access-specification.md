# Supported Accommodation Hub: Role and Data Access Specification

**Audience:** Backend, web and native-app technical teams  
**Baseline:** MySQL local-authentication release `3f598b0f`  
**Purpose:** Define the minimum functional and data access boundaries for **Superadmin**, **Owner**, **Key Worker**, **Key Worker Contractor**, **HR**, and **Finance** users. This specification is implementation guidance, not a substitute for safeguarding policy, employment policy, financial delegation rules, a DPIA, or legal advice.

> **Non-negotiable rule:** The server—not a web or native-app screen—must authorise every read, write, export, download, share, override and state transition. A valid password proves only identity. It does not grant a company, property, placement or sensitive-record entitlement. [1]

## 1. Role model at a glance

| Requested business role | Current implementation status | Recommended technical identity | Default scope |
| --- | --- | --- | --- |
| Superadmin | **Not a full operational role today.** `platform_admin` currently has only a narrow configuration capability. [1] | Separate platform-support role with case-based break-glass access | No standing customer-record access |
| Owner | Implemented as `owner` / “Company administrator”. [2] | Entity membership with the `owner` operational role | One named company; all properties in that company |
| Key Worker | Implemented as `support_worker`. [1] | Entity membership plus property grants and live placement assignments | Assigned properties and assigned young people only |
| Key Worker Contractor | **Not a first-class role today.** | New `support_worker_contractor` role; do not reuse `support_worker` without restrictive changes | Named property, named shifts and named placements only, time limited |
| HR | Implemented as `hr_compliance` / “HR & compliance”. [1] [2] | Entity membership plus property scope where needed | Named company and assigned/all approved properties |
| Finance | Implemented as `finance`. [1] | Entity membership plus property scope where needed | Named company and assigned/all approved properties |

## 2. Access model that applies to every role

- **Identity:** The user must complete local email-and-password sign-in. A valid session is HTTP-only and version-revocable; password changes invalidate older sessions.
- **Account status:** The backend must reject a suspended, inactive, expired or locked account before evaluating any role.
- **Tenant/company scope:** Every command and query must include or derive an `entityId`. The server must require an active membership in that exact company; no client-supplied company identifier is evidence of access. [1]
- **Capability scope:** The backend must check a named capability such as `finance.issue`, `staff.sensitive`, `incident.review` or `config.write`.
- **Property scope:** If the resource belongs to a property, the server must require either an explicit property grant, an approved all-properties flag, or the entity-owner rule. [1]
- **Placement scope:** For frontline care records, Key Workers must also have a current worker-to-placement assignment. Property access alone is not enough. [1]
- **Sensitivity and state:** The server must separately check whether the user can see safeguarding, health, medication, HR, bank or finance content, and whether the record state permits the transition.
- **Audit:** Record meaningful allowed and denied decisions, access to sensitive data, exports, downloads, secure-link creation, permission changes, overrides and approval/issue actions. Audit payloads must not contain plaintext passwords, reset tokens or secure-link tokens.
- **Data minimisation:** Search, autocomplete, native-app sync, notifications and offline caches must return only data that the user could open through the normal API.

## 3. Data classification used by the implementation

| Classification | Examples | Default exposure rule |
| --- | --- | --- |
| General operations | Property facts, approved general documents, routine compliance status | Role capability plus company/property scope |
| Care and placement | Placement reference, support plans, daily logs, attendance, curfew and key-work activity | Key Worker requires property **and** active placement assignment; managers may access in their company scope |
| Safeguarding and health | Safeguarding narratives, incident review, risk, allegations, medication administration, health monitoring | Explicit care/safeguarding capability, property/placement scope and record-state checks; never expose by generic document search |
| Workforce / HR | Staff profiles, DBS, Right to Work, references, training, supervision, appraisal | `staff.read` / `staff.write` / `staff.sensitive`; HR-classified documents only to authorised HR users |
| Finance | Fee schedules, invoices, payments, statements, credit notes, bank snapshots and finance documents | `finance.read`, `finance.write` or `finance.issue`; no care-record browsing by Finance |
| Restricted documents | HR, finance, safeguarding, bank and restricted document classes | Classification filter plus capability; workspace search currently filters classifications by role. [3] |
| Platform security | Session metadata, audit metadata, configuration, health and incident diagnostics | Superadmin/Owner only as defined below; no tokens, passwords or secret values in views or logs |

## 4. Superadmin — platform operations and emergency support

### Intended purpose

- Operate the platform safely across customers without giving routine access to their care, HR or finance records.
- Manage platform configuration, tenant lifecycle, security posture, service health and approved support cases.
- Provide emergency technical support only through an auditable, time-limited and approval-controlled process.

### May do

- Create, suspend and reactivate **tenant/company shell records** and platform configuration, subject to change management.
- View platform health, job status, anonymised metrics, error identifiers, audit metadata and configuration state.
- Manage platform-level roles, feature flags, security policy and approved support workflows.
- Initiate a **break-glass support session** only when a support case, reason, target company, target data class, start/end time and required approvals are recorded.
- During an approved break-glass session, access the minimum required records for troubleshooting and show a persistent “support access” banner.
- Revoke a platform support session immediately and review its audit trail.

### May see by default

- Tenant identifiers, company name, subscription/configuration metadata, operational health and non-sensitive audit metadata.
- User account security metadata such as account status, session revocation status, last sign-in timestamp and failed-login counters.
- No resident, safeguarding, health, medication, HR, payroll/bank, invoice-line or document content by default.

### Must not do by default

- Must not have a standing “read every tenant” API route, cross-tenant search index, bulk export or data-download permission.
- Must not use a customer’s Owner account, share a customer credential or alter records while presenting as the customer.
- Must not view full young-person records, safeguarding narratives, staff vetting evidence, bank data or invoice PDFs without a granted break-glass case.
- Must not approve their own break-glass request; require a second authorised approver for sensitive classes.

### Backend implementation requirements

- Implement Superadmin as a **separate platform role**, not as an `owner` membership and not as a hidden cross-company bypass.
- Keep the current `platform_admin` capability narrow until a separate platform-support service and policy have been implemented; the present role only has `config.write`. [1]
- Model break-glass access as a separate table containing `caseId`, `targetEntityId`, `requestedDataClasses`, `reason`, `approvedBy`, `startsAt`, `endsAt`, `revokedAt` and immutable audit references.
- Require each support query to carry the active break-glass grant ID; reject access outside its entity, class and time window.
- Mask identifiers in default support listings; only reveal the minimum required record after the grant passes server-side validation.

### Native-app requirements

- Do **not** include Superadmin care operations in the frontline native app.
- Prefer a separate web-only operations console with hardware/MFA policy, short session duration and no offline cache.
- If a mobile support app is ever required, disable local document download, screenshots where platform controls allow it, background sync and push payloads containing personal data.

## 5. Owner — company administrator

### Intended purpose

- Be the accountable company-level administrator for one or more explicitly assigned companies.
- Run company operations, configure local access, oversee safeguarding/compliance/finance and review audit evidence.

### May do

- Manage company profile, properties, property assignments, operational settings, controlled templates and local workflows.
- Create, update, suspend and scope company memberships; set property scope; issue local credentials through the controlled company-admin workflow; revoke access; and record a meaningful reason for each change.
- Access workforce, staffing, recruitment/compliance, placements, care operations, safeguarding/incident workflows, compliance records, documents, finance, packs, analytics, audit evidence and data-rights workflows within their company.
- Create and manage provider/local-authority packs, authorised documents, secure controlled sharing and company-level reports.
- Create, draft, approve and issue invoices or credit notes only where the finance workflow’s independent-approval rule is satisfied.
- Run and review company compliance automation and resolve operational exceptions.

### May see

- All approved company data in the entity, including all properties, young-person records, safeguarding/health records, workforce evidence, finance records, approved documents and audit logs.
- The current server role map gives `owner` all defined capabilities and treats it as all-property access **inside the active entity membership only**. [1]

### Must not do

- Must not access a company for which they do not hold an active Owner membership.
- Must not bypass immutable audit history, document versioning, finance snapshots or record-state validation.
- Must not approve an invoice they created; independent approval is required before issue. [4]
- Must not remove or demote the last active Owner in a company.
- Must not receive plaintext passwords, plaintext reset tokens, secure-link tokens or secret configuration values in standard application responses.

### Backend implementation requirements

- Store an Owner as an explicit membership per company, not as a global flag on the person.
- Enforce all-property access only after active entity membership has been confirmed.
- Require `config.write` for role, property-scope and credential administration; require reason, actor, before/after scope and audit event.
- Apply dual control to selected high-risk operations: self-created invoice approval is already rejected; extend this pattern to break-glass approvals and any future bank-detail change approval. [4]

### Native-app requirements

- Provide a mobile-friendly Owner dashboard for alerts, approvals, compliance RAG, staffing exceptions, invoice status and access reviews.
- Require re-authentication for high-risk actions: changing roles, issuing passwords, exporting data, opening bank details, issuing invoices and sharing documents.
- Do not preload all sensitive records into offline storage; obtain them on demand and redact the mobile notification body.

## 6. Key Worker — employed frontline care worker

### Intended purpose

- Deliver day-to-day support to named young people at named properties and record contemporaneous care activity.

### May do

- View assigned shifts, clock in/out where enabled, complete handovers and maintain their own timesheet entries.
- Read the property operational context for their assigned properties.
- Read and update **only assigned** young-person/placement records required to provide support, including daily notes, key-work activity, attendance/curfew observations, care-plan contributions and authorised operational updates.
- Record incidents, submit frontline observations, acknowledge medication administration where policy and workflow permit, and record approved resident-finance activity.
- Read general documents, approved property compliance context and their own self-service/supervision information.
- View their own notifications, tasks and assigned record shortcuts.

### May see

- Assigned property facts, shift/rota details and handover context.
- Young-person references and care records only where there is both an active property scope and a current placement assignment.
- General documents only by default; the current workspace classification filter restricts frontline workers to `general` documents. [3]

### Must not do

- Must not search, browse or sync all young people in a company.
- Must not access a placement merely because they work at the same company or property; an active placement assignment is required. [1]
- Must not access HR files, DBS/Right to Work, colleague supervision records, finance invoices/statements/bank data, audit evidence or administrator settings.
- Must not approve/review safeguarding incidents, override care restrictions, amend role/property scope or issue controlled documents.
- Must not make high-risk clinical decisions; medication and health workflows must remain limited to the organisation’s approved policy, training and record-state controls.

### Backend implementation requirements

- Map the role to the current `support_worker` capability set, then call `assertPlacementCapability` for placement/care/safeguarding reads and writes. [1]
- Include `entityId`, `propertyId` and `placementId` in relevant command validation; derive them from the record rather than trusting the device payload.
- Return only assigned placements from search, saved views, native-app sync and notification deep links. [3]
- Audit sensitive record reads, care writes, incident writes, medication actions and denied assignment checks.

### Native-app requirements

- Default landing screen: **My shift**, **My assigned young people**, **Handover**, **My tasks** and **Report an incident**.
- Use large touch targets, controlled dropdowns, clearly labelled form fields and server-generated validation errors.
- Offline mode, if enabled, must cache only the current user’s assigned placement summary and pre-authorised form drafts; encrypt data, bind it to the device/user, expire it and re-check all assignments at sync.
- Hide all non-authorised navigation entries, but still expect the server to reject direct API requests.

## 7. Key Worker Contractor — restricted frontline worker

### Intended purpose

- Allow agency, casual or contracted staff to complete a scheduled, specifically scoped support shift without expanding access to the wider service.

### Status and recommended design

- This is **not currently a first-class backend role**. The current `support_worker` role includes `resident_finance.write`, medication/frontline write access and other capabilities that may be too broad for a contractor. [1]
- Implement a distinct `support_worker_contractor` role rather than attempting to subtract permissions with the current additive extra-capability mechanism.
- Link the role to the staff profile’s employment type (`agency`, `casual` or other contractor policy value), named shift assignment and an end date.

### May do

- View the assigned property, shift details, emergency/operational contacts and only the young people explicitly assigned for the live shift.
- Read the minimum support-plan, risk-summary, communication, medication alert and safeguarding-contact information needed for that shift.
- Submit shift handover, daily note, attendance/curfew observation, incident report and escalation request.
- Acknowledge—not independently alter—tasks assigned to the contractor during the shift.

### May see

- Minimal necessary care data for the assigned placement and shift window.
- General operational documents specifically linked to the shift/property; no broad document library.
- No unassigned placement, historical case chronology, full safeguarding narrative, detailed health history or resident-finance information by default.

### Must not do

- Must not access any other company, property, shift or placement.
- Must not access HR, finance, staff profiles, compliance registers, audit logs, full document library, user management or reports.
- Must not issue medication, edit care plans, change risk assessments, edit historical case notes, approve incidents, approve invoices or make resident-finance entries unless a separately approved, trained and audited policy explicitly grants it.
- Must not use offline data outside the active shift window.

### Backend implementation requirements

- Add `support_worker_contractor` to the role enum and role-capability map with a **smaller** set than `support_worker`.
- Enforce all of: active account, active entity membership, contractor engagement dates, assigned property, active shift and current placement assignment.
- Issue short session lifetime and automatic access expiry at the engagement/shift end; revoke scope immediately when a shift is cancelled.
- Add a `careDataMinimum` projection for contractor APIs; do not reuse the full Key Worker placement payload.
- Require an explicit manager review for contractor-submitted medication, incident and safeguarding-related entries before they become an approved record where policy requires it.

### Native-app requirements

- Provide a restricted “Contractor shift” mode, not the full Key Worker application.
- Show only **Today’s shift**, **Assigned young people**, **Handover**, **Report incident** and **Escalate**.
- Disable download/share, screenshots where technically supported, broad search, cross-property navigation and background sync.
- Remove cached data at shift end, logout, device compromise signal or loss of assignment.

## 8. HR — workforce and compliance administrator

### Intended purpose

- Manage workforce records, safer-recruitment evidence, training, supervision, appraisal and workforce compliance without accessing care or finance data unnecessarily.

### May do

- Create and update staff profiles, employment details, contracts/engagement metadata and workforce lifecycle records.
- Create, review and update DBS, Right to Work, identity, references, qualifications, training, induction, probation, supervision, appraisal and policy-acknowledgement checks.
- Upload and manage HR-classified evidence documents; record expiry/renewal information and workforce compliance actions.
- View rota/shift data to support workforce planning and compliance, subject to property scope.
- View property compliance status, selected provider packs, workforce analytics and data-rights cases necessary for HR compliance.

### May see

- Staff directory, role/job title, contact data, employment type and staff compliance evidence.
- HR-classified documents and general documents only; the current workspace filter maps HR to `general` and `hr` document classes. [3]
- Workforce compliance alerts, training/renewal status and HR audit evidence related to their actions.

### Must not do

- Must not access young-person records, placements, support plans, safeguarding narratives, medication, resident finance or frontline case notes.
- Must not access invoices, statements, payments, bank details, finance documents or finance secure links.
- Must not change company Owner memberships, issue platform-level roles or bypass an existing staff confidentiality rule.
- Must not read other data classes simply because a document is attached to a shared property.

### Backend implementation requirements

- Map the role to `hr_compliance` and retain its separation from `young_person.*`, `incident.*`, `medication.*`, `resident_finance.*` and `finance.*` capabilities. [1]
- Require `staff.sensitive` for vetting, training, supervision, reference and appraisal records; `staff.read` alone must not expose those fields. [5]
- Enforce HR document classification on every upload/download and audit sensitive workforce reads/writes.
- Use property scope for property-specific HR/compliance work; an entity-wide HR grant must be explicit, not implied by job title.

### Native-app requirements

- Provide a workforce/compliance app area: **Staff**, **Safer recruitment**, **Training renewals**, **Supervision**, **Compliance evidence** and **My tasks**.
- Redact finance/care tabs and ensure links from notifications open only permitted HR records.
- Do not allow local retention of DBS/reference images or HR evidence unless encrypted device storage, remote wipe and retention policy have been approved.

## 9. Finance — controlled billing and financial operations

### Intended purpose

- Maintain fee schedules, billing, invoice lifecycle, payments, statements, credit notes and finance-controlled sharing for a company.

### May do

- Read fee schedules, invoices, invoice lines, payments, invoice events, credit notes, statement archives and permitted local-authority billing context.
- Create and update fee schedules, create invoice drafts, request approval, allocate payments, record delivery, open/resolve disputes, reconcile records, create/revoke invoice links and reissue eligible drafts.
- Approve and issue invoices, and issue credit notes, only with `finance.issue`.
- Generate immutable invoice/statement PDFs and manage finance-classified archive records.
- Prepare provider/local-authority packs only to the level required for billing and controlled finance sharing.

### May see

- Finance data for the active company: fee schedules, invoices, invoice references, local-authority billing details, payment/reconciliation status, statement archives and finance documents.
- The young-person **reference** and placement/billing context necessary to invoice; not the full care, safeguarding, health or case-record profile.
- General and finance-classified documents only; the current workspace filter maps Finance to `general` and `finance`. [3]

### Must not do

- Must not access full young-person records, care plans, daily notes, safeguarding, health/medication, incidents, staff HR records, DBS/reference documents or supervision/appraisal content.
- Must not manage user roles, property scope, platform configuration, company bank configuration without an additional approved Owner/dual-control workflow.
- Must not approve an invoice they created. The current invoice flow requires a different authorised user before issue. [4]
- Must not create broad public links; every controlled link must be scoped, time-limited, view-limited, revocable and audited.

### Backend implementation requirements

- Map the role to `finance`; require `finance.read` for visibility, `finance.write` for controlled changes and `finance.issue` for independent approval/issue/credit actions. [1] [4]
- Restrict all invoice, statement, payment and secure-link queries to the active entity; property scope should apply where the finance record is property-linked.
- Store issued PDFs and statements as immutable, finance-classified document versions; store finance bank snapshots encrypted and never return them to roles without the dedicated authorised endpoint.
- Require state transitions: draft → pending approval → independently approved → issued → delivered/payment/reconciled/credited/disputed; prevent invalid transitions server-side. [4]

### Native-app requirements

- Provide a finance-first dashboard: **Billing queue**, **Approval queue**, **Overdue invoices**, **Payments**, **Statements**, **Secure links** and **Exceptions**.
- Re-authenticate before issuing invoices, opening bank data, exporting statements, issuing credits or generating an external link.
- Disable care, safeguarding, health and HR navigation; do not synchronise those data domains to Finance devices.

## 10. Backend implementation contract

- **Membership table:** Store each role as an active, dated membership of one `entityId`; do not use one global “company access” boolean.
- **Property grants:** Store all-properties as an explicit flag or individual property assignments; revoke grants independently of the user account.
- **Placement assignments:** Store Key Worker and contractor assignments with start/end dates; all frontline young-person requests must validate current assignment.
- **Contractor extension:** Add a dedicated contractor role, engagement dates, shift binding, minimal-care projection and independent review states before enabling contractor access.
- **Capabilities:** Keep the role→capability map on the server. Extra capabilities must be allowlisted and auditable; never let a mobile client submit arbitrary permission names.
- **Document classification:** Require a classification filter at database-query level and at secure-download level; never rely on a hidden UI document folder.
- **Commands versus queries:** Use explicit commands for high-risk transitions such as approve invoice, issue invoice, revoke link, approve incident review, change role, set password and revoke membership.
- **Audit receipt:** Write an audit event for sensitive reads, permission decisions, creates/updates, exports, downloads, shares, approvals, denials and overrides. Restrict audit-log access itself.
- **Error contract:** Return stable user-safe messages and developer codes. Do not reveal whether an inaccessible record, company or user exists outside the caller’s scope.
- **Testing:** For each role, add positive tests for allowed behaviour and negative tests for cross-company, unassigned-property, unassigned-placement, sensitive-document, direct-route and forged-ID requests.

## 11. Native-app authorisation and offline contract

- Treat every native app as an untrusted client. UI navigation and local role flags are convenience only; API enforcement is authoritative.
- Obtain a server-generated **scope manifest** after sign-in containing only the active company, allowed properties, assigned placements, capabilities, account expiry and cache expiry.
- Re-fetch the manifest on app open, background resume, property switch, shift start/end, assignment change, password change and before a high-risk command.
- Use separate mobile experiences for Owner, Key Worker, Contractor, HR and Finance; do not build one app with all local data hidden by tabs.
- Keep push notifications generic: “You have an urgent task at your assigned property,” not names, health facts, safeguarding details, finance amounts or document titles.
- Encrypt permitted offline data, bind it to the device and user, expire it quickly, prevent unsupported downloads and delete it on logout/revocation/assignment end.
- Queue offline writes with immutable idempotency keys and record version IDs. On sync, the server must re-run membership, capability, property, placement, sensitivity and state checks before accepting the write.

## 12. Delivery priorities for the technical team

1. **First:** Preserve current tenant → property → placement server-side enforcement; add an automated negative-test matrix for every role.
2. **Second:** Implement the dedicated contractor role and minimum-data API before giving contractors production access.
3. **Third:** Implement Superadmin break-glass controls as a separate audited platform module; do not turn Owner into a global cross-tenant role.
4. **Fourth:** Build role-specific mobile scope manifests and offline deletion/revalidation controls.
5. **Fifth:** Add MFA, credential-issuance policy, password-reset delivery, device management, monitoring and penetration testing before operational rollout.

## References

[1]: [Canonical capability, entity, property and placement authorisation rules](../server/authz.ts)
[2]: [Current manageable roles and role labels](../server/services/rbacRules.ts)
[3]: [Role-filtered workspace search, documents and saved views](../server/routers/workspace.ts)
[4]: [Finance lifecycle, independent approval and controlled sharing rules](../server/routers/finance.ts)
[5]: [Workforce sensitive-record and HR evidence rules](../server/routers/workforce.ts)
