# Local Environment Setup

The project deliberately does not include a live **`.env`** file. Local environment files normally contain database credentials, a session-signing secret, and provider API credentials. They are excluded from version control by `.gitignore`; copying a live deployment file into the repository would create a material credential-exposure risk.

## Create a Local Configuration File

Copy the contents of `docs/local-environment.template.txt` into a new `.env.local` file and replace every `replace-with-…` value with credentials issued for a development environment. Do not reuse the production database, session secret, or provider key for local work. The template identifies whether a variable is **server-only** or deliberately browser-visible.

```bash
cp docs/local-environment.template.txt .env.local
```

| Variable group | Used by | Handling requirement |
|---|---|---|
| `TIDB_DATABASE_URL`, `JWT_SECRET`, `LOCAL_AUTH_BOOTSTRAP_TOKEN`, `BUILT_IN_FORGE_API_KEY` | Server only | Treat as secrets; never prefix them with `VITE_`, commit them, or paste them into tickets/chat. |
| `LOCAL_AUTH_BOOTSTRAP_TOKEN` | Server only | A one-time, high-entropy setup token used only to establish the first local owner email/password account. Rotate or remove it after that account is confirmed. |
| `BUILT_IN_FORGE_API_URL` | Server only | Development endpoint for enabled managed platform services such as object storage. |
| `VITE_APP_TITLE`, `VITE_APP_LOGO` | Browser presentation | Optional application branding values. |

## Development and Deployment

The managed Hub deployment receives its environment securely and does not load the sanitised text template. Do not add a real `.env` to source control or change deployment secrets by editing files. When a real credential must be added or rotated, use the secure project configuration flow so development and production retain the same typed environment contract.

> Local sign-in uses the MySQL credential store. The first owner must use the one-time bootstrap token with their approved email and a strong password. Never place a bootstrap token or a password in source control, a ticket, email or chat.
