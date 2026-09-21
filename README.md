# Supported Accommodation Hub

Supported Accommodation Hub is a multi-tenant operations platform for supported-accommodation services. It is designed to keep **company, property, workforce, placement, safeguarding, compliance, document and finance records** separated by server-enforced tenant, role, property and placement-assignment checks.

> **Security boundary:** Browser controls improve usability but do not grant access. Every protected request is authorised on the server. Do not bypass MySQL credential verification, tenant membership, property scope or placement-assignment checks when extending the application.

## Architecture at a Glance

The application is two pieces: a React client built by Vite, and a Laravel API. The API implements the tRPC wire protocol at `/api/trpc` rather than a REST shape of its own, so the client's `useQuery`/`useMutation` call sites are the same ones they always were.

There was a Node/Express server in `server/` until the port to Laravel finished. It is gone; `git log` has it. The `mirroring server/...` notes in the PHP docblocks name the file each behaviour came from, and those paths resolve against the commit before the removal.

| Layer | Technology | Main locations |
|---|---|---|
| Frontend | React 19, TypeScript, Tailwind, shadcn/ui, Wouter, TanStack Query | `client/src/` |
| API / backend | PHP 8.3, Laravel, tRPC wire protocol | `laravel/app/Trpc/`, `laravel/app/Trpc/Routers/` |
| Authorisation | Canonical tenant, role, property and placement guards | `laravel/app/Support/Authz.php` |
| Identity | MySQL-backed email/password credentials with signed HTTP-only sessions | `laravel/app/Trpc/Routers/AuthRouter.php`, `laravel/app/Support/LocalAuth.php`, `laravel/app/Support/Jwt.php` |
| Persistence | MySQL/MariaDB, schema and migrations defined with Drizzle | `drizzle/schema.ts`, `drizzle/` |
| File storage | Private disk below the document root, re-checked on every download | `laravel/app/Support/EvidenceStorage.php`, `laravel/app/Http/Controllers/EvidenceController.php` |
| Audit | Hash-linked audit events and object receipt mirrors | `laravel/app/Support/Audit.php` |

The full technical handoff and rendered systems diagram are in [`docs/technical-system-architecture.md`](docs/technical-system-architecture.md) and [`docs/technical-system-architecture.png`](docs/technical-system-architecture.png).

## Prerequisites

Use **Node.js 22+** and the project’s pinned **pnpm** version for the client and the schema tooling, and **PHP 8.3 with Composer** for the API. You also need a development-only MySQL/MariaDB database and a strong, one-time local owner bootstrap token.

```bash
corepack enable
pnpm install
cd laravel && composer install
```

## Local Configuration

The repository intentionally does **not** include a live `.env` file. It would contain credentials and must never be committed, emailed or copied from production. Create an ignored `.env.local` using the sanitised template:

```bash
cp docs/local-environment.template.txt .env.local
```

Replace only the placeholder values with **development-only** configuration. The managed deployment injects production values securely, so editing local files does not change the deployed environment.

| Variable | Visibility | Purpose |
|---|---|---|
| `TIDB_DATABASE_URL` | Server-only | Development MySQL/TiDB connection string. |
| `JWT_SECRET` | Server-only | Strong, random development session-signing secret. |
| `LOCAL_AUTH_BOOTSTRAP_TOKEN` | Server-only | One-time high-entropy token used only to establish the first local owner account. Rotate or remove it after use. |
| `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY` | Server-only | Development integration endpoint and credential where storage/platform services are used. |
| `VITE_APP_TITLE`, `VITE_APP_LOGO` | Browser-visible | Optional presentation configuration. |

Read [`docs/local-environment-setup.md`](docs/local-environment-setup.md) and [`docs/local-authentication-operations.md`](docs/local-authentication-operations.md) before configuring a local environment.

## Run Frontend and Backend

Two processes: the API and the client. Run them in separate terminals.

```bash
pnpm dev:api   # php artisan serve on 127.0.0.1:8000
pnpm dev       # vite on :3000, proxying /api to the API
```

Open the Vite URL. The proxy target can be pointed elsewhere with `API_ORIGIN` if the API is not on the default port.

### Production Build

```bash
pnpm build
```

This creates the React assets in `dist/public`. The API is deployed as the Laravel application rather than built; see [`docs/DEPLOY-HOSTINGER.md`](docs/DEPLOY-HOSTINGER.md) for the layout on the server.

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
pnpm check                            # TypeScript across the client
pnpm build                            # the client actually builds
cd laravel && php vendor/bin/phpunit  # the API's rules
```

The PHP tests are unit tests over the rules the API enforces: authorisation, working time, retention, the age policy, escalation, offline sync and the printable-export controls. `CrossRuntimeTest` is the one to read first — it pins the session token, the encrypted-column and the audit-envelope formats against a fixture captured from the Node runtime, so a drift in any of them fails here rather than in a production audit chain that has to keep linking to rows that runtime wrote.

## Fictional Test Data

The repository has a clearly labelled, isolated TEST scenario, described in [`docs/test-data-guide.md`](docs/test-data-guide.md). It is for local and demo validation only and must not be mixed with operational data.

The `testdata:*` loader scripts that guide refers to are not in the repository — they were already absent before the Laravel port, and nothing here replaces them yet. Treat the guide as a description of the scenario rather than as runnable instructions.

## Key Development Rules

All time values at the API and database layer are UTC Unix milliseconds. Store documents in object storage and keep metadata/authorisation records in the database. Never store file bytes in database columns.

Use tRPC hooks from `client/src/lib/trpc.ts`; do not add ad hoc frontend HTTP wrappers. Note that those hooks are no longer typed from the API — the API is PHP, so there is nothing to infer from, and a call's input and output are `any`. Where a response shape is worth stating, state it on the screen that reads it, as `pages/RoleManagement.tsx` does.

New procedures go in a router under `laravel/app/Trpc/Routers/` and are registered in `RouterRegistrar`. Every protected one must use the canonical guards in `laravel/app/Support/Authz.php`. When a user has narrow property or placement scope, validate it again on every operation and record sensitive decisions through `laravel/app/Support/Audit.php`.

There is no worker and no daemon. Anything that would have been background work runs in the request that asked for it — see `workspace.runAutomationNow` — because shared hosting has nowhere to keep a process alive, and a button that silently queued work nobody would run is worse than one that takes a moment.

## Project Structure

```text
client/src/                 React pages, components, routes and client data hooks
laravel/app/Trpc/           tRPC dispatcher, context, input checking
laravel/app/Trpc/Routers/   One class per domain router
laravel/app/Support/        Authorisation, rules, PDFs, crypto, audit
laravel/tests/Unit/         Rule tests, including the cross-runtime format checks
drizzle/schema.ts           Typed MySQL/MariaDB schema
drizzle/*.sql               Generated, reviewed migration history
docs/local-authentication-operations.md  Local email/password operational controls
docs/                       Architecture, operator guidance and local setup material
```

## Release Procedure

Before release, run type checking, tests and production build; inspect fresh runtime logs; and validate relevant desktop/mobile workflows. Create a reviewable checkpoint only after the checklist is accurate. The managed project is configured to publish automatically when a checkpoint is saved.

For a complete security and deployment rationale, start with the technical architecture handoff and the existing verification reports in `docs/`.
