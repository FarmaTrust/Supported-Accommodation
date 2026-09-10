# Supported Accommodation Hub — Role Acceptance Matrix

**Author:** Manus AI  
**Execution date:** 25 August 2026  
**Automated result:** 30 tests passed in seven test files  
**Browser result:** Authenticated owner shell and all registered routes completed desktop/mobile smoke checks

## Acceptance method

Role acceptance uses three complementary checks. First, the automated capability suite exercises every operational role against high-risk actions, explicit capability extensions, entity scope, property assignments and time-bounded young-person assignments. Second, router and service tests verify the state guards used by the workflows, including invoice approval/issue, secure links, retention approvals, legal holds, RAG and scheduled-rule dates. Third, the authenticated owner session was used to load every registered route and verify responsive, loading, no-data, permission/error and navigation states.

The platform does not include a role-impersonation control because that would weaken least privilege. Before production activation, the provider should repeat the **live identity check** column with separate non-production accounts issued by its identity provider. This is an operational sign-off step rather than an application-code gap.

| Role | Positive workflow accepted | Restricted workflow accepted | Scope condition | Evidence |
| --- | --- | --- | --- | --- |
| Owner | Entity/property setup, finance issue, audit, documents, compliance, placements and work plans | None within explicitly owned entities; sensitive actions remain audited and approval-gated | Owner account with active status | All-capability automated matrix; authenticated route smoke; invoice/retention independent-approval tests |
| Registered manager | Assigned properties, workforce-sensitive records, young-person plans, incidents, rota, compliance and work plans | Cannot issue invoices or change platform configuration | Active entity membership plus all-properties or explicit property grants | All-role matrix; property-scope helper tests; assignment-independent manager access tests |
| Support worker | Assigned property rota, clocking, handover, Key Worker reports and incidents for assigned young people | Cannot read HR-sensitive records, finance or audit; cannot access unassigned/expired-assignment placements | Active entity and property assignment plus current explicit placement assignment | Support-worker capability tests; property assignment tests; active, expired and wrong-user placement assignment tests |
| HR/compliance | Workforce checks, supervision, training, policy, property and compliance evidence | Cannot access young-person narratives or finance issue | Active entity membership and permitted property scope | All-role high-risk matrix; staff-sensitive capability checks; safeguarding and finance-denial checks |
| Finance | Authorities, fees, invoice drafting/approval/issue, statements, payments, credits, PDF and secure delivery | Cannot access safeguarding or HR-sensitive records | Active entity membership; finance capabilities; separate approver for own drafts | Finance capability tests; invoice calculations/numbering/PDF tests; independent approval guard; secure-link tests |
| Read-only | Entity/property, workforce summary, rota, compliance, documents and finance read views | Cannot create/update records, issue invoices, change configuration or write provider packs | Active entity membership and relevant property scope | Read-only capability tests; explicit-extension test confirms isolated grants do not widen base role |

## Workflow acceptance cases

| Case | Expected result | Verification status |
| --- | --- | --- |
| User requests an entity outside active memberships | Denied and audited with `membership_missing` | Passed through shared entity-decision contract |
| Property-scoped user opens an unassigned property | Denied and audited with `assignment_missing` | Passed through production property-scope helper test |
| Support worker opens an assigned placement within assignment dates | Allowed and safeguarding access event recorded | Passed through active-assignment decision test |
| Support worker opens an unassigned or expired placement | Denied and safeguarding denial recorded | Passed for wrong user and expired assignment |
| Finance user opens young-person narrative | Denied by role capability | Passed in all-role high-risk matrix |
| HR/compliance user issues an invoice | Denied by role capability | Passed in all-role high-risk matrix |
| Read-only user changes a property or issues finance | Denied by role capability | Passed in read-only boundary tests |
| Platform administrator reads business records by default | Denied; configuration only | Passed in platform-administrator boundary test |
| Invoice creator tries to approve own draft | Denied; independent approver required | Implemented in router guard and covered by workflow review |
| Retention requester tries to approve own deletion | Denied; independent approver required | Passed in retention service tests |
| Any user tries to delete a record under legal hold | Denied before object references are cleared | Passed in retention service tests |
| External recipient uses expired, revoked or exhausted invoice/pack link | Denied with non-sensitive failure state | Passed in secure-link tests and public-route failure smoke checks |

## Live identity-provider sign-off

The provider’s implementation lead should provision six non-production accounts, assign only the memberships shown above, and record the date, tester and outcome of each positive and negative case. MFA/SSO strength is governed by the identity provider, so this check must be performed in the final organisation-owned authentication configuration. No production young-person or workforce information should be used for sign-off.

| Role account | Tester | Date | Positive case | Negative case | Outcome |
| --- | --- | --- | --- | --- | --- |
| Owner |  |  |  |  | Pending organisational sign-off |
| Registered manager |  |  |  |  | Pending organisational sign-off |
| Support worker |  |  |  |  | Pending organisational sign-off |
| HR/compliance |  |  |  |  | Pending organisational sign-off |
| Finance |  |  |  |  | Pending organisational sign-off |
| Read-only |  |  |  |  | Pending organisational sign-off |
