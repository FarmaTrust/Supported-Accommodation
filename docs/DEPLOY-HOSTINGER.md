# Deploying to Hostinger Cloud Startup

The account has a Cloud Startup shared plan and no VPS, and a VPS cannot be
bought from a collaborator login. Shared hosting runs PHP and MySQL but cannot
keep a Node process alive, so the Express/tRPC server in `server/` has no home
there. The backend is therefore being reimplemented in PHP under `php/`, and the
React client is deployed unchanged.

## What the client never notices

The SPA talks to the server through tRPC's `httpBatchLink` with the superjson
transformer (`client/src/main.tsx`). The PHP API implements that wire protocol
rather than a REST shape of its own, so none of the 295 `useQuery`/`useMutation`
call sites change:

```
query     GET  /api/trpc/a.b,c.d?batch=1&input={"0":{...},"1":{...}}
mutation  POST /api/trpc/a.b            body {"json": ...}
response  [{"result":{"data":{json,meta}}}, {"error":{...}}]
```

Session cookies are interchangeable too. `php/api/src/Jwt.php` produces and
accepts the same HS256 tokens `jose` does in `server/_core/sdk.ts`, signed with
`JWT_SECRET`, so a cookie issued by either runtime is honoured by the other.

## Layout on the server

```
~/domains/micare.online/
├── .env                 secrets, outside the document root
└── public_html/         document root
    ├── index.html       Vite build output
    ├── assets/
    ├── .htaccess        from php/public/.htaccess
    └── api/
        ├── index.php    front controller
        └── src/         classes, denied by their own .htaccess
```

`php/api/index.php` finds the environment file two levels up, which resolves to
`~/domains/micare.online/.env` on the server and to the repository root during
local development. The same file therefore configures the Node server and the
PHP API without being duplicated.

## One-time setup

### 1. Database

Already done. The database is MariaDB 11.8 on the Cloud Startup plan, with all
144 tables applied from `drizzle/`. Migrations are **not** run on the server:
generate and apply them from a developer machine, with the remote address
whitelisted under hPanel → Databases → Remote MySQL.

```bash
set -a; . ./.env; set +a
npx drizzle-kit migrate
```

Remote MySQL whitelists a specific address, and consumer ISP addresses change.
When a connection that used to work starts timing out, check the current address
with `curl https://api.ipify.org` and update the whitelist before suspecting the
credentials.

### 2. The environment file

Upload `.env` to `~/domains/micare.online/.env` — one level **above**
`public_html`, so no URL can reach it. Set permissions to 600.

```ini
NODE_ENV=production
TIDB_DATABASE_URL=mysql://u519956850_admin:PASSWORD@HOST:3306/u519956850_cgt
JWT_SECRET=<openssl rand -hex 32>
APP_PUBLIC_URL=https://micare.online
VITE_APP_ID=local
```

Use a fresh `JWT_SECRET`; changing it later signs every existing session out,
which is the intended behaviour if one is ever suspected of leaking.

### 3. Domain

Point `micare.online` at the hosting plan in hPanel. The domain currently
resolves to Hostinger's parking IP, so nothing is lost by repointing it. Enable
the free SSL certificate — the session cookie is issued with `SameSite=None`
over HTTPS and will not be stored over plain HTTP.

### 4. GitHub secrets

Repo → Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `FTP_SERVER` | FTP hostname from hPanel → Files → FTP Accounts |
| `FTP_USERNAME` | FTP account username |
| `FTP_PASSWORD` | FTP account password |
| `FTP_REMOTE_DIR` | `/domains/micare.online/public_html/` |

Every push to `main` then runs `.github/workflows/deploy.yml`: it type-checks and
runs the PHP self-check, builds the SPA, assembles `public_html` and uploads it.

## Running the API locally

PHP's built-in server is enough, because `.htaccess` only matters for routing:

```bash
php -S 127.0.0.1:8099 php/api/index.php
curl "http://127.0.0.1:8099/api/trpc/auth.me?batch=1&input=%7B%7D"
```

The self-check needs no database or server:

```bash
npx tsx php/tests/make-fixture.ts > php/tests/fixture.json
php php/tests/run.php
```

The fixture holds real output from `jose`, `superjson` and the production
`buildAuditEnvelope`, so the checks fail if either runtime drifts.

## Passwords do not carry over

The Node server stores scrypt digests with a 16-byte salt. PHP's only scrypt
binding requires a 32-byte salt and exposes opslimit/memlimit instead of
N/r/p, so a Node-written hash can be read but never verified in PHP.

New credentials are written with `password_hash()`'s argon2id. A credential that
still holds a `scrypt$…` digest is recognised and refused with a reset
requirement rather than being misread as a wrong password. The production
database created for this deployment is empty, so this only matters if user rows
are ever imported from the old TiDB database — those users must reset their
passwords.

## What is ported so far

| Area | State |
| --- | --- |
| superjson wire format | done, checked against Node output byte-for-byte |
| Session tokens (HS256) | done, interchangeable with `jose` |
| Audit hash chain | done, hashes match `server/services/audit.ts` |
| tRPC batching, guards, error shapes | done |
| `auth.me`, `auth.status`, `auth.logout` | done |
| `localAuth.bootstrapStatus`, `localAuth.login` | done |
| The other 28 routers, ~310 procedures | not started |
| PDF generation (`pdf-lib` × 4) | not started, needs a PHP equivalent |
| Scheduled automation (`server/scheduled.ts`) | not started, needs hPanel cron |
| Object storage, maps, notifications | not started; these call the Manus Forge API, which has to be reachable from Hostinger or replaced |

Until the remaining routers exist, the deployed site signs in and then fails on
every other call. Deploy it to a subdomain, or keep the domain parked, until
enough of the surface is ported to be useful.
