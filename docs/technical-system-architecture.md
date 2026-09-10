# Supported Accommodation Hub — Technical System Architecture

**Architecture baseline:** published release `ca69b230`, with colleague pre-authorisation enhancements staged for the next release.  
**Prepared for:** Technical delivery, security and operations teams.  
**Date:** 7 September 2026.  
**Scope:** A backend-ready logical and deployment architecture for a multi-entity supported-accommodation operations platform. It distinguishes **implemented baseline controls**, **credential-ready patterns**, and **production decisions still requiring organisational approval**.

![Full technical system architecture](./technical-system-architecture.png)

## 1. Architecture intent and boundaries

The Hub is a **modular monolith**: a React client uses typed tRPC procedures provided by Express, with Drizzle persisting to MySQL/TiDB and private object storage holding binary evidence. This retains one transaction boundary and one server-side enforcement layer while the operating model is still evolving. It should not be split into separately deployed microservices until team ownership, integration volume, throughput or isolation requirements create a concrete reason to do so. [1] [2]

> **Core rule:** Identity-provider authentication proves who is signing in. The Hub independently derives whether that user has an active account, entity membership, capability, property scope, placement assignment and sufficient sensitivity/state authority for the requested action.

| Architectural objective | Implemented response | Production decision still required |
|---|---|---|
| Tenant isolation | Entity-scoped records; server checks membership and scope | Access-review cadence and automated deprovisioning policy |
| Least privilege | Capability, property and placement checks run server-side | Formal policy-as-code review ownership |
| Passwordless sign-in | Delegated provider authentication with nonce-bound OAuth callback and signed session | IdP choice, MFA, account lifecycle, device and conditional-access policy |
| Colleague onboarding | Hub-side email pre-authorisation with role/property scope activated after matching provider sign-in | Provider-side account creation, directory sync and approved sender domain |
| Evidence safety | Relational metadata plus private object-storage bytes | Scanner, object-lock and data-loss-prevention provider |
| Auditability | Append-only hash-linked audit records with object-store receipts | SIEM retention, alerting and incident-response integration |

## 2. Full system context

The diagram separates five trust boundaries. End users, guests and external webhooks are untrusted clients. The identity and edge boundary handles HTTPS, passwordless provider sign-in, OAuth state binding and signed sessions. The Hub contains logical modules that share a database transaction boundary but retain separate domain ownership. Managed data services hold relational facts and binary evidence separately. Scheduler and optional provider adapters are isolated from browser-initiated actions. [1] [3]

| Boundary | Entry points | Trust requirements |
|---|---|---|
| User/client | Manager, Key Worker, company administrator and restricted guest views | Browser data and route values are untrusted; client visibility is never an authorisation decision |
| Identity/edge | OAuth callback, session cookie, API request | One-time state nonce; fixed in-app callback; HTTPS; short error messages with no provider internals |
| Hub application | `/api/trpc`, controlled public secure-link procedures, authenticated job endpoint | Input validation; tenant, property, placement, sensitivity and record-state checks; audit evidence |
| Data | MySQL/TiDB and private object storage | Database holds state/scope/hash metadata; object storage holds documents, PDFs and audit receipts |
| External/async | Scheduler, webhooks and optional adapters | Authenticated callbacks, idempotency, approved connections and durable delivery receipts |

## 3. Identity, colleague provisioning and authorisation

### 3.1 Current passwordless identity flow

The existing provider callback requires an authorisation code and a browser-bound one-time nonce before token exchange. It resolves the provider identity, upserts a local user record, creates the Hub session cookie and returns to a fixed in-app route. The Hub does not store or reset passwords. Browser modes that block required cookies may prevent completion of this flow. [3] [4]

### 3.2 Colleague provisioning flow

The new **Hub-side pre-authorisation** workflow is intentionally separate from provider administration. A company administrator records a colleague’s provider email, non-owner operational role, all-property or named-property scope, approved exception capabilities, expiry and reason. The Hub does not create an external provider account or send an email automatically. The colleague must authenticate independently through the configured provider with the same verified email address.

On successful provider sign-in, the Hub compares the provider email to active, unrevoked, unexpired pre-authorisations. It creates the tenant membership and any named property grants in one database transaction, marks the invitation accepted and writes restricted audit evidence. An existing membership is never overwritten by a pre-authorisation. [3] [5]

| Stage | Owner | System action | Safety control |
|---|---|---|---|
| Create provider identity | IdP administrator | Creates/disables account and enforces MFA according to provider policy | Outside Hub; requires IdP administrative access and organisation-approved policy |
| Pre-authorise Hub scope | Company administrator | Records email, role, property scope, expiry and reason | `config.write`, no owner role through this workflow, tenant property validation and audit evidence |
| Sign in | Colleague | Uses passwordless provider sign-in | OAuth nonce/state binding and provider-verified identity |
| Activate access | Hub service | Creates active membership/property grants only for a matching pending invitation | Transactional acceptance, no replacement of existing membership, audit event |
| Revoke before use | Company administrator | Marks pending pre-authorisation revoked | `config.write`, meaningful reason and audit evidence |
| Remove access after use | Company administrator | Uses existing access-control workflow to suspend/end membership and remove grants | Server-authoritative RBAC and property scope checks |

### 3.3 Authorisation decision order

Every protected procedure follows this order: **valid authenticated session → active local account → active entity membership → role/capability → property scope → placement assignment for frontline access → sensitivity and record-state constraints → allow/deny audit event**. The order is evaluated on the server; neither a client-supplied entity ID nor a navigation item confers authority. [2] [5]

## 4. Logical application modules

| Module | Primary ownership | Scope keys | Sensitive classes | Authoritative state changes |
|---|---|---|---|---|
| Identity and access | Users, memberships, roles, capability and property/placement grants | User, entity, property, placement | Restricted | Membership activation, suspension, scope grant and role change |
| Colleague provisioning | Pending pre-authorisations and accepted identity matches | Email, entity, property | Restricted | Pending → accepted, revoked or expired |
| Accommodation and operations | Entities, properties, units, occupancy, placements, rota and timesheets | Entity, property, placement | General/restricted | Property, placement, shift and approval transitions |
| Workforce | Staff profile, recruitment, checks, training and supervision | Entity, property, staff | HR | Staff lifecycle and evidence status |
| Care and safeguarding | Key Worker records, medication, incidents, allegations and reviews | Entity, property, placement | Safeguarding/health | Restricted documentation, review and closure transitions |
| Compliance and governance | Obligations, evidence, quality, statutory review and work plans | Entity, property, staff | General/restricted | Evidence approval, due-state and action completion |
| Finance and controlled sharing | Fees, invoices, statements, packs and secure links | Entity, property, local authority | Finance/bank | Immutable invoice snapshots, payment allocation, link lifecycle |
| Documents, audit and retention | Metadata, versions, legal holds, audit records and receipts | Entity, record, document | Restricted | Version append, retention hold and audit hash chain |
| Notification and outbox | In-app reminders, delivery intents and provider receipts | Entity, user, delivery | General/restricted | Idempotent notification/delivery attempt lifecycle |

## 5. Data architecture and invariants

The relational database is the source of truth for scope, relationships, lifecycle state, approvals, metadata and hashes. Private object storage is the source of truth for binary evidence, generated PDFs and audit receipt bodies. This division prevents document bytes being duplicated into relational BLOB columns and supports controlled download through authorised metadata checks. [1] [2]

| Data group | Examples | Required invariant |
|---|---|---|
| Identity and tenant access | `users`, `entityMemberships`, `propertyAssignments`, colleague invitations | Provider authentication alone does not grant tenant access; active membership remains required |
| Care and safeguarding | Placements, Key Worker reports, incidents and health content | Frontline access depends on active assignment and restricted handling |
| Finance | Fees, invoices, statement archives and payment allocations | Issued records are immutable snapshots with scoped finance access |
| Documents/evidence | Metadata, versions, folders, retention and object keys | Bytes remain outside DB; metadata is authorised before access |
| Audit | Events, hash pointers and receipt mirrors | Append-only evidence with minimal metadata and no plaintext invitation token |
| Delivery | Connection settings, outbox, attempts and receipts | Outbound delivery is idempotent and disabled until provider activation |

## 6. API, scheduler and integration patterns

Internal browser traffic uses typed tRPC at `/api/trpc`. Public flows are deliberately narrow, such as guest property-summary link redemption. A scheduled job enters through an authenticated endpoint and performs deterministic due-state evaluation. Browser forms never call mail, scanning, accounting, e-signature or other suppliers directly. [1] [6]

For production integrations, a business transaction must persist both the domain state and a delivery-intent/outbox record. An approved dispatcher later sends only through an active connection, captures attempts and receipts, honours retry/backoff policy and routes persistent failures to review. Supplier webhooks must verify a signature, use idempotency keys and minimise data. The present baseline has email-ready records but does not claim live email delivery. [1]

## 7. Deployment and resilience target

The appropriate production target is stateless Hub API instances behind HTTPS edge protection, a managed HA MySQL-compatible database, private encrypted object storage and a managed scheduler. The application must not rely on sandbox local files or permanently running background workers.

| Area | Target control |
|---|---|
| Compute | Stateless containers behind managed HTTPS gateway, health checks and autoscaling |
| Secrets | Managed store, least-privilege service identities, rotation runbook and no committed credentials |
| Database | TLS, encrypted backups, point-in-time recovery, tested restore, migration gates and non-production separation |
| Object storage | Private encrypted bucket, scoped keys, retention/lifecycle policy, quarantine area and presigned retrieval only |
| Observability | Correlation IDs, structured logs, request/job/delivery metrics, audit-receipt failure alerts and secure error codes |
| Security assurance | Dependency scanning, SAST, secret scanning, access review, penetration test and tested incident response |

## 8. Current baseline versus production target

| Capability | Current state | Production target / decision |
|---|---|---|
| Provider sign-in | Active delegated OAuth callback and signed Hub session | Select enterprise OIDC/SAML provider, MFA, session lifetime and offboarding controls |
| Colleague scope activation | Hub-side pre-authorisation matched to provider email at sign-in | Confirm email-verification claim, approved domain policy and SCIM strategy |
| Guest access | Narrow property-summary links, hash-only tokens, expiry/revocation/use limit | Formal external sharing assessment before any broader scope |
| Email/SMS | In-app and email-ready outbox only | Configure provider, sender domain, consent wording and receipt monitoring |
| Document scanning | Metadata/quarantine model | Choose scanner, service level and review process |
| Audit | Hash-linked events and object-store receipt mirror | SIEM integration, retention schedule and incident alerting |
| DR | Managed project deployment and schema checks | Agree RTO/RPO, regional posture, restore test cadence and accountable owner |

## 9. Production decision register

| Decision | Owner | Required before | Due date |
|---|---|---|---|
| IdP product, MFA and session policy | Security/IT lead | Onboarding production staff | To be set |
| Account joiner/mover/leaver and deprovisioning process | HR/operations + IT lead | First production colleague | To be set |
| Provider-email verification and matching policy | Security lead | Colleague pre-authorisation use | To be set |
| SCIM or directory-sync scope | IT lead | Scale-up beyond manual invitations | To be set |
| Sender domain and outbound notification provider | Operations/IT lead | Live email/SMS | To be set |
| Data residency, DPIA, retention and legal-hold policy | Data-protection lead | Live sensitive records | To be set |
| Backup, restoration and incident targets | Technical lead | Production go-live | To be set |
| Malware scanning and evidence quarantine process | Security/operations lead | External evidence uploads | To be set |

## 10. Technical-team delivery sequence

1. Stabilise identity, active account, membership, capability, property and placement enforcement with negative tests.
2. Configure provider-side colleague accounts and MFA; pre-authorise Hub scope through company administration; validate first sign-in and audit acceptance.
3. Complete operational, care, compliance, finance and document modules with encryption, state transitions and audit evidence.
4. Activate external adapters only after credentials, sender/domain verification, supplier testing, signed webhook contracts and support ownership are approved.
5. Complete production assurance: migration rehearsal, backup/restore test, access review, performance test, security review, accessibility review and incident exercise.

## 11. Developer handoff checklist

- Preserve server-side authorisation; do not use client routing or visible controls as a security boundary.
- Treat provider identity as authentication only; require local active membership and scope for every protected Hub action.
- Do not auto-create owner access from colleague pre-authorisation, and never overwrite a live membership during invitation acceptance.
- Use object storage for bytes and relational storage for metadata, state, scope, classification and hashes.
- Keep every external call behind a controlled adapter, durable outbox, idempotency contract and audit trail.
- Keep sensitive values and raw provider diagnostics out of browser-visible errors, diagrams, logs and support templates.

## References

[1]: [Existing backend solution architecture](./backend-solution-architecture.md)
[2]: [Canonical server authorisation model](../server/authz.ts)
[3]: [Nonce-bound OAuth callback](../server/_core/oauth.ts)
[4]: [OAuth integration guidance](../../skills/webdev-manus-oauth/SKILL.md)
[5]: [Identity-provider session and local user synchronisation](../server/_core/sdk.ts)
[6]: [Application API and job-route registration](../server/_core/index.ts)
