# Deploying to a Hostinger VPS

This app is a long-running Node 22 process (Express + tRPC serving a built Vite SPA)
backed by MySQL. Hostinger's shared/Premium/Business plans only run PHP, so this needs
a **VPS (KVM) plan**. KVM 2 or larger is recommended — `vite build` is the memory-hungry
step and can get OOM-killed on a 1 GB box.

Everything below is a one-time setup. After it, every push to `main` deploys via
`.github/workflows/deploy.yml`.

## 1. Server packages

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt update && sudo apt install -y nodejs mysql-server nginx git
sudo npm i -g pm2
sudo mysql_secure_installation
```

## 2. Database

```bash
sudo mysql
```

```sql
CREATE DATABASE hub CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'hub'@'localhost' IDENTIFIED BY 'a-long-random-password';
GRANT ALL PRIVILEGES ON hub.* TO 'hub'@'localhost';
FLUSH PRIVILEGES;
```

Keep MySQL bound to `127.0.0.1` (the Ubuntu default). The app talks to it over
localhost, so the database port never needs to be open to the internet.

## 3. Deploy user and checkout

```bash
sudo adduser --disabled-password deploy
sudo mkdir -p /var/www/hub && sudo chown deploy:deploy /var/www/hub
sudo -iu deploy
git clone https://github.com/FarmaTrust/Supported-Accommodation.git /var/www/hub
```

For a private repo, add a read-only deploy key on the server and register its public
half under the repo's **Settings → Deploy keys**.

## 4. Environment file

`/var/www/hub/.env` — never committed, `chmod 600`:

```ini
NODE_ENV=production
PORT=3000
TIDB_DATABASE_URL=mysql://hub:a-long-random-password@127.0.0.1:3306/hub
JWT_SECRET=<openssl rand -hex 32>
APP_PUBLIC_URL=https://your-domain.com

# Only if the matching feature is in use
RESEND_API_KEY=
RESET_EMAIL_FROM=
OAUTH_SERVER_URL=
OWNER_OPEN_ID=
BUILT_IN_FORGE_API_URL=
BUILT_IN_FORGE_API_KEY=
LOCAL_AUTH_BOOTSTRAP_TOKEN=
```

## 5. First build and process start

```bash
cd /var/www/hub
npm ci
set -a; . ./.env; set +a        # drizzle.config.ts reads the URL from the shell
npx drizzle-kit migrate
npm run build
pm2 start dist/index.js --name hub
pm2 save
pm2 startup                      # run the command it prints, as root
```

## 6. Nginx and TLS

`/etc/nginx/sites-available/hub`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    client_max_body_size 25m;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/hub /etc/nginx/sites-enabled/hub
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

Point the domain's A record at the VPS IP in Hostinger's DNS panel before running
certbot, otherwise the ACME challenge fails.

## 7. GitHub secrets

Repo → **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `VPS_HOST` | VPS IP or hostname |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | private half of an SSH key whose public half is in `/home/deploy/.ssh/authorized_keys` |
| `VPS_PORT` | optional, only if SSH is not on 22 |

Generate the key pair locally with `ssh-keygen -t ed25519 -C "gh-actions-deploy"`, paste
the private key into `VPS_SSH_KEY`, and append the public key to the deploy user's
`authorized_keys`.

## Notes

- The workflow runs `git reset --hard origin/main`, so any manual edit made directly on
  the server is discarded on the next deploy. `.env` is untracked and survives.
- Migrations run before the build. `drizzle-kit generate` is deliberately *not* run on
  the server — migrations are generated locally with `npm run db:push` and committed.
- Rollback: `git checkout <sha> && npm ci && npm run build && pm2 reload hub` on the
  server, or revert the commit on `main` and let the pipeline redeploy.
- Logs: `pm2 logs hub`. Status: `pm2 status`.
