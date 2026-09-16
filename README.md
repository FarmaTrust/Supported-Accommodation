# Supported Accommodation Hub

Supported Accommodation Hub is a multi-tenant operations platform for supported-accommodation services. It is designed to keep **company, property, workforce, placement, safeguarding, compliance, document and finance records** separated by server-enforced tenant, role, property and placement-assignment checks.

> **Security boundary:** Browser controls improve usability but do not grant access. Every protected request is authorised on the server. Do not bypass MySQL credential verification, tenant membership, property scope or placement-assignment checks when extending the application.

## Architecture at a Glance

The application runs as one Node.js service in development and production. The server hosts the Express API, the tRPC router at `/api/trpc`, local authentication endpoints, scheduled endpoints and—depending on mode—the Vite development middleware or built React client assets.

| Layer | Technology | Main locations |
|---|---|---|
| Frontend | React 19, TypeScript, Tailwind, shadcn/ui, Wouter, TanStack Query | `client/src/` |
| API / backend | Node.js, Express, tRPC 11, TypeScript | `server/`, `server/routers/` |
| Authorisation | Canonical tenant, role, property and placement guards | `server/authz.ts` |
| Identity | MySQL-backed email/password credentials with signed HTTP-only sessions | `server/routers/localAuth.ts`, `server/services/localAuth.ts`, `server/_core/sdk.ts` |
| Persistence | MySQL/TiDB, Drizzle ORM and migrations | `drizzle/schema.ts`, `drizzle/` |
| File storage | Private object storage with database metadata and access checks | `server/storage.ts` |
| Audit | Hash-linked audit events and receipt mirrors | `server/services/audit.ts` |

The full technical handoff and rendered systems diagram are in [`docs/technical-system-architecture.md`](docs/technical-system-architecture.md) and [`docs/technical-system-architecture.png`](docs/technical-system-architecture.png).

## Prerequisites

Use **Node.js 22+** and the project’s pinned **pnpm** version. You also need a development-only MySQL/TiDB database and a strong, one-time local owner bootstrap token.

```bash
corepack enable
pnpm install
```

## Local Configuration

The repository intentionally does **not** include a live `.env` file. It would contain credentials and must never be committed, emailed or copied from production. Create an ignored `.env.local` using the sanitised template:

```bash
cp docs/local-environment.template.txt .env.local
```

Replace only the placeholder values with **development-only** configuration. The managed deployment injects production values securely, so editing local files does not change the deployed environment.

| Variable | Visibility | Purpose |
|---|---|---|
| `DATABASE_URL` | Server-only | Development MySQL/TiDB connection string. |
| `JWT_SECRET` | Server-only | Strong, random development session-signing secret. |
| `LOCAL_AUTH_BOOTSTRAP_TOKEN` | Server-only | One-time high-entropy token used only to establish the first local owner account. Rotate or remove it after use. |
| `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY` | Server-only | Development integration endpoint and credential where storage/platform services are used. |
| `VITE_APP_TITLE`, `VITE_APP_LOGO` | Browser-visible | Optional presentation configuration. |

Read [`docs/local-environment-setup.md`](docs/local-environment-setup.md) and [`docs/local-authentication-operations.md`](docs/local-authentication-operations.md) before configuring a local environment.

## Run Frontend and Backend

There is **one development command**; it starts the backend and serves the React frontend through Vite middleware with hot-module reload.

```bash
pnpm dev
```

The service chooses an available port, beginning with `PORT` when supplied or `3000` otherwise. Open the displayed local URL in your browser. Do not run a separate frontend process unless you are intentionally changing the application architecture.

### Production Build and Local Production Run

```bash
pnpm build
pnpm start
```

`pnpm build` creates the React assets in `dist/public` and bundles the Node server into `dist/index.js`. `pnpm start` serves the built application with `NODE_ENV=production`.

## Database and Migrations

Treat `drizzle/schema.ts` as the typed schema source of truth. For each schema change, generate and inspect the migration before it is applied. Use an additive migration where possible; database data is not disposable.

```bash
# 1. Edit drizzle/schema.ts
pnpm drizzle-kit generate

# 2. Review the generated SQL file in drizzle/
# 3. Apply the reviewed migration to a development database
pnpm drizzle-kit migrate
```

The `db:push` script combines generation and migration, but it should only be used after reviewing the generated SQL. In the managed project, apply production migrations through the reviewed database-migration workflow rather than running destructive SQL ad hoc.

## Authentication and Colleague Access

The Hub uses **MySQL-backed email/password credentials**. The database stores a salted, memory-hard one-way password hash, never a plaintext password. Successful verification issues a signed HTTP-only session. Changing a password increments a credential version so prior local sessions cannot continue to authenticate.

For the initial owner, configure `LOCAL_AUTH_BOOTSTRAP_TOKEN`, open **First owner setup**, provide the approved owner email, a strong new password and the token. Rotate or remove the token after initial use. Company administrators may then pre-authorise colleagues with a role, property scope, optional allowlisted capabilities, expiry and recorded business reason, then use **Local email and password access** to issue a temporary password. Do not create direct database edits, unrestricted access endpoints or self-service role elevation.

For an existing active account, a company administrator can instead create one **account-specific temporary sign-in link** in **Access control**. It requires a business reason, expires in one to 30 days, is copyable once only, is stored only as a SHA-256 hash, can be revoked before use and is audit logged. Redeeming it consumes the link atomically and issues the normal password-version-bound local session; it never creates a user or expands company, role, property or placement scope, and it cannot bypass lockout, account status or a required password change.

Guest links are separate from staff identity and provide only a deliberately restricted, read-only property summary. They must never be extended to young-person, safeguarding, HR, finance, document-library, audit or cross-tenant content.

## Tests and Quality Checks

Run the following before proposing a release:

```bash
pnpm check
pnpm test
pnpm build
```

Focused test files live beside their services and routers. The minimum security regression set should cover entity boundaries, property scope, placement assignment, access-control mutations, guest-invitation lifecycle, credential hashing, bootstrap-token validation, lockout state, password-reset lifecycle and safe unauthenticated responses.

## Fictional Test Data

The repository has a clearly labelled, isolated TEST scenario. It is for local/demo validation only and must not be mixed with operational data.

```bash
pnpm testdata:load
pnpm testdata:verify

# Optional mock compliance evidence and reminder evaluation
pnpm testdata:compliance
pnpm testdata:compliance:evaluate
pnpm testdata:compliance:verify
```

## Key Development Rules

All time values at the API and database layer are UTC Unix milliseconds. Store documents in object storage and keep metadata/authorisation records in the database. Never store file bytes in database columns.

Use tRPC hooks from `client/src/lib/trpc.ts`; do not add ad hoc frontend HTTP wrappers. New protected procedures must use the canonical guards in `server/authz.ts`. When a user has narrow property or placement scope, validate it again on every server operation and log sensitive decisions through `server/services/audit.ts`.

Scheduled work uses authenticated managed callbacks. Do not add a persistent worker or background daemon to this application. For any external integration, add required credentials through the secure project configuration workflow, never source files.

## Project Structure

```text
client/src/                 React pages, components, routes and client data hooks
server/_core/               Express bootstrap, session context and Vite/static hosting
server/routers/             tRPC domain routers
server/services/            Authorisation-adjacent business services, audit and background logic
server/authz.ts             Canonical tenant, role, property and placement authorisation
drizzle/schema.ts           Typed MySQL/TiDB schema
drizzle/*.sql               Generated, reviewed migration history
docs/local-authentication-operations.md  Local email/password operational controls
docs/                        Architecture, operator guidance and local setup material
scripts/                    TEST-only fixture and verification utilities
```

## Release Procedure

Before release, run type checking, tests and production build; inspect fresh runtime logs; and validate relevant desktop/mobile workflows. Create a reviewable checkpoint only after the checklist is accurate. The managed project is configured to publish automatically when a checkpoint is saved.

For a complete security and deployment rationale, start with the technical architecture handoff and the existing verification reports in `docs/`.
