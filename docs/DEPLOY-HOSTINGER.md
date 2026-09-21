# Deploying to Hostinger Cloud Startup

The account has a Cloud Startup shared plan and no VPS, and a VPS cannot be
bought from a collaborator login. Shared hosting runs PHP and MySQL but cannot
keep a Node process alive, so the Express/tRPC server in `server/` has no home
there. The backend is being reimplemented as a Laravel application in
`laravel/`, and the React client is deployed unchanged.

## What the client never notices

The SPA talks to the server through tRPC's `httpBatchLink` with the superjson
transformer (`client/src/main.tsx`). The Laravel API implements that wire
protocol rather than a REST shape of its own, so none of the client's
`useQuery`/`useMutation` call sites change:

```
query     GET  /api/trpc/a.b,c.d?batch=1&input={"0":{...},"1":{...}}
mutation  POST /api/trpc/a.b            body {"json": ...}
response  [{"result":{"data":{json,meta}}}, {"error":{...}}]
```

Session cookies are interchangeable too. `laravel/app/Support/Jwt.php` produces
and accepts the same HS256 tokens `jose` does in `server/_core/sdk.ts`, signed
with `JWT_SECRET`, so a cookie issued by either runtime is honoured by the other.

## Layout on the server

```
~/domains/micare.online/
├── .env                 secrets, outside the document root
├── laravel/             the application, outside the document root
│   ├── app/ bootstrap/ config/ routes/ storage/ vendor/
│   └── artisan
└── public_html/         document root
    ├── index.html       Vite build output
    ├── assets/
    ├── .htaccess        from .deploy/public_html.htaccess
    └── api-index.php    Laravel's public/index.php
```

Only the front controller and the built client sit inside the document root.
The framework, its dependencies and uploaded evidence are all above it, so no
URL reaches them directly.

`laravel/bootstrap/app.php` loads the environment file from two levels above the
application, which resolves to `~/domains/micare.online/.env` on the server and
to the repository root during local development. One file therefore configures
the Node server and the Laravel API without being duplicated.

## One-time setup

### 1. Database

Already done. The database is MariaDB 11.8 on the Cloud Startup plan, with all
144 tables applied from `drizzle/`. Migrations are **not** run on the server:
generate and apply them from a developer machine, with that machine's address
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
APP_ENV=production
APP_DEBUG=false
APP_KEY=<php artisan key:generate --show>
NODE_ENV=production
TIDB_DATABASE_URL=mysql://user:password@localhost:3306/database
JWT_SECRET=<openssl rand -hex 32>
APP_PUBLIC_URL=https://micare.online
VITE_APP_ID=local
```

The database host is `localhost` on the server: MySQL runs on the same machine,
and the remote hostname is only for connections from a developer's machine.

Use a fresh `JWT_SECRET`. Changing it later signs every existing session out,
which is the intended behaviour if one is ever suspected of leaking — but note
it also makes existing encrypted bank details unreadable, because the field
encryption key is derived from it.

### 3. Domain

Point `micare.online` at the hosting plan in hPanel and enable the free SSL
certificate. The session cookie is issued with `SameSite=None` over HTTPS and
will not be stored over plain HTTP.

### 4. GitHub secrets

Repo → Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `FTP_SERVER` | FTP hostname from hPanel → Files → FTP Accounts |
| `FTP_USERNAME` | FTP account username |
| `FTP_PASSWORD` | FTP account password |
| `FTP_REMOTE_DIR` | `/domains/micare.online/` |

Every push to `main` then runs `.github/workflows/deploy.yml`: it regenerates the
cross-runtime fixture from the Node sources, lints and tests the PHP, builds the
SPA, assembles the tree above and uploads it.

## Running it locally

```bash
php -S 127.0.0.1:8000 -t laravel/public      # or: cd laravel && php artisan serve
curl "http://127.0.0.1:8000/api/trpc/auth.me?batch=1&input=%7B%7D"
```

The test suite needs no database or server:

```bash
JWT_SECRET=test-secret-value-1234567890 \
  npx tsx laravel/tests/fixtures/make-fixture.ts > laravel/tests/fixtures/node-fixture.json
cd laravel && vendor/bin/phpunit
```

The fixture holds real output from `jose`, `superjson`, the production
`buildAuditEnvelope`, the capability matrix and the workflow guards, so the
checks fail if either runtime drifts.

## Passwords do not carry over

The Node server stores scrypt digests with a 16-byte salt. PHP's only scrypt
binding requires a 32-byte salt and exposes opslimit/memlimit instead of
N/r/p, so a Node-written hash can be read but never verified here.

New credentials are written with `password_hash()`'s argon2id. A credential that
still holds a `scrypt$…` digest is recognised and refused with a reset
requirement rather than being misread as a wrong password. The database created
for this deployment is empty, so this only matters if user rows are ever
imported from the old TiDB database — those users must reset their passwords.

## Two deliberate differences from the Node server

**Uploaded evidence.** The Node server put files in S3 through the Manus Forge
API and handed back a presigned URL; that service is not reachable from this
deployment. Files now go to `laravel/storage/app/private`, outside the document
root, and are served by a route that re-checks permission on every request and
records each read. A presigned URL is a bearer token — whoever holds the link
can fetch the file until it expires, whatever their role is by then — and these
are photographs of a young person's room and scanned identity documents.

**Scheduling.** The Node server registered cron jobs with the Manus heartbeat
service. The schedule is now stored on the automation rule and read by a
scheduled command, so one cron entry on the host drives every company's rules.
Add it in hPanel → Advanced → Cron Jobs:

```
* * * * * cd ~/domains/micare.online/laravel && php artisan schedule:run >/dev/null 2>&1
```

## Port status

The Laravel API is not yet a complete replacement for the Node server. See the
git log for what each router covers; `laravel/app/Trpc/RouterRegistrar.php` is
the authoritative list of what is wired up. A procedure that has not been ported
answers `NOT_FOUND`, so an unported screen fails visibly rather than silently
returning nothing.

`server/` stays in the repository until the port is finished: it is both the
reference the PHP is written against and the runtime that still works.
