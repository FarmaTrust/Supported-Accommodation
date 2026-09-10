# Supported Accommodation Hub — Developer Code Documentation

## Purpose and operating boundary

Supported Accommodation Hub is a multi-tenant operational platform for supported-accommodation providers. It manages legal entities, properties, staff, placements, care records, safeguarding, rotas, compliance evidence, finance, documents, audit evidence and controlled external delivery. All business timestamps are Unix milliseconds in UTC. The user interface converts them to local time only for display.

The system must be operated on the principle that an entity is a legal and data-isolation boundary. A user cannot read or mutate another entity's records solely because they hold an owner-style role elsewhere. Property and placement controls apply additionally to sensitive operational records.

## Technology and repository layout

| Layer | Implementation | Primary locations |
|---|---|---|
| Web client | React 19, TypeScript, Tailwind and shadcn/ui | `client/src/` |
| API | Express, tRPC 11 and Zod contracts | `server/routers/`, `server/routers.ts` |
| Data access | Drizzle ORM with MySQL/TiDB | `drizzle/schema.ts`, `server/db.ts` |
| Identity | Manus OAuth session integration | `server/_core/oauth.ts`, `server/_core/context.ts` |
| Files | Object storage, with metadata and version records in the database | `server/storage.ts`, `documents`, `documentVersions` |
| Audit and encryption | Hash-chained audit events and encrypted sensitive fields | `server/services/audit.ts`, `server/services/crypto.ts` |
| Testing | Vitest unit, contract and integration-style tests | `server/**/*.test.ts`, `client/src/**/*.test.ts` |

## Domain modules

| Module | Responsibilities | Key tables / routers |
|---|---|---|
| Tenancy and access | Entities, memberships, property grants, roles and capability overrides | `entities`, `entityMemberships`, `propertyAssignments`, `server/authz.ts`, `accessControl` |
| Property and compliance | Property profile, safety evidence, obligations, certificates and renewal alerts | `properties`, `propertyEvidence`, `propertyChecks`, `compliance` |
| Workforce | Staff profiles, checks, training, availability, working time and shift acknowledgements | `staffProfiles`, `workforceChecks`, `staffAvailability`, `workingTime*`, `workforce` |
| Placements and care | Young-person references, placement, professional contacts, key-worker records and activity monitoring | `youngPeople`, `placements`, `workerAssignments`, `care` |
| Safeguarding | Incidents, concerns, allegations, missing episodes, restraint and controlled reviews | `incidents`, `safeguardingConcerns`, `restraintEvents`, `safeguarding` |
| Rotas | Shift allocation, change events, coverage, timesheets and rescheduling | `shifts`, `shiftChangeEvents`, `timesheets`, `operations`, `rotaControls` |
| Finance | Local Authorities, fee schedules, invoices, payments, credits, statements and statement PDF archive | `localAuthorities`, `feeSchedules`, `invoices`, `payments`, `statementArchives`, `finance` |
| Documents | Metadata, versions, retention and secure links; file bytes never live in MySQL | `documents`, `documentVersions`, `secureLinks`, `documents` |

## API and authorization conventions

Every API procedure is registered in `server/routers.ts`, consumed using the typed tRPC client in `client/src/lib/trpc.ts`, and should use `protectedProcedure` unless public access is intentionally required. A procedure must first call an appropriate guard from `server/authz.ts`.

`assertEntityCapability(userId, entityId, capability)` establishes tenant membership and capability before reading or changing entity data. `assertPropertyCapability` adds property scope. `assertPlacementCapability` adds active worker assignment or approved placement scope. New procedures must not recreate these checks ad hoc.

Role/capability changes are controlled by `accessControl` and must retain the last active tenant owner. Elevated capability changes require a reason and create audit evidence containing restricted before/after metadata. User interfaces may hide unavailable actions but are not a security control.

## Data model and migration practice

Drizzle schema definitions are the source of truth. For every data-model change, update `drizzle/schema.ts`, run `pnpm drizzle-kit generate`, review the generated SQL, and apply reviewed additive SQL through the managed database migration path. Do not use destructive migration operations without explicit approval, dependency analysis and a restoration plan.

Use database transactions where a record, its related event and its audit receipt must succeed or fail together. For money amounts, use decimal columns and convert to `number` only when calculating or displaying values. File content belongs in object storage; database rows contain keys, hashes, MIME metadata, approval/scan state and access boundaries.

## Sensitive data, documents and audit

Sensitive narratives, identity contacts, professional contact details and other protected fields use `encryptSensitive`; never introduce the obsolete `encryptString` API. Read/decryption must be limited to a server path guarded by entity, property and placement rules. Avoid inserting protected content into logs, notifications, URL parameters or browser storage.

Documents require an entity-bound `documents` row and versioned `documentVersions` metadata. Uploads are scanned/quarantined before operational use. Finance PDFs are generated server-side from immutable issued snapshots or server-calculated statement data, stored in object storage and hashed. Secure links store only token hashes and enforce expiry, revocation and view limits.

`writeAuditEvent` is mandatory for sensitive reads, access changes, issued finance records, document generation, delivery actions and workflow decisions. Audit verification treats receipt hash mismatches as a failure, not a warning.

## Finance PDFs and statement archive

The `finance.statement` procedure calculates selected ranges up to three years. It returns server-calculated opening and closing balances based on invoices, dated payments and issued credits. `finance.generateStatementPdf` renders this result server-side, creates an approved finance document version, hashes the file and stores searchable metadata in `statementArchives`.

The finance UI offers a **Statement PDF archive** tab, with Local Authority filters, client search within the authorised list, in-browser preview and download. Archive queries always apply the caller's `finance.read` entity boundary. Invoice PDF preview is embedded within its existing controlled PDF/delivery dialog. Browser `mailto:` composition never transmits a file; the user attaches the already authorised PDF in their email client unless a separately approved email integration is configured.

## Authentication and support

The Hub delegates authentication to its identity provider and therefore does not retain user passwords. Sign-in errors map to plain-English messages and stable support codes in `shared/authFeedback.ts`. The sign-in page offers a provider-safe recovery route. Company administrators can configure tenant-specific support contact details. Support-request emails include safe technical context only; they must not include access tokens, young-person data, finance information or raw server errors.

## Local development

1. Ensure supported environment variables are supplied by the managed environment; do not commit `.env` files or credentials.
2. Install lockfile dependencies with `pnpm install --frozen-lockfile`.
3. Run `pnpm dev` for the local service.
4. Run `pnpm check` for TypeScript, `pnpm test` for Vitest and `pnpm build` for the production bundle.
5. Run `pnpm testdata:load -- <sourceEntityId>` only in an approved development/training environment. It creates `TEST — Training Provider Limited`, not operational data.

## Testing and release gates

The minimum release sequence is TypeScript check, focused tests for altered rules, full `pnpm test`, `pnpm build`, restart, desktop/phone smoke checks, and review of logs strictly after that restart. Test failures must be fixed or explicitly accepted by the release owner; do not mask test conditions by weakening authorization or evidence checks.

The TEST scenario and all generated names, emails, certificate files, Local Authorities, young-person references, placements and invoices are fictional. They must remain inside the dedicated TEST entity. Before release, verify that test identifiers do not appear in an operational entity.

## Operations and deployment

Autoscale hosting is appropriate for request-driven work. Recurrent renewal evaluations must use authenticated managed scheduler callbacks and idempotency keys, not persistent background workers. Email, malware scanning, e-signature, accounting and payroll integrations remain inactive until supplier credentials, data-processing agreements, security review and live end-to-end tests are complete.

Maintain secure backups, tested restoration procedures, access reviews, retention schedules, alerting and incident-response ownership outside the source repository. Configure production observability to redact protected data and alert on failed jobs, database connectivity, unexpected authorization errors, storage failures and PDF generation failures.

## Developer delivery checklist

- Verify the current database schema matches all applied migrations.
- Confirm every new procedure has a server-side entity scope guard before its query.
- Confirm property/placement guards where a record is property-bound or young-person-sensitive.
- Add a deterministic test for every new policy or calculation and negative authorization tests for sensitive mutations.
- Preserve immutable snapshots and audit events for issued finance, safeguarding and access-control actions.
- Generate a checkpoint only after the release gates pass and document explicitly inactive integrations.

