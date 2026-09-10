# Local Environment Setup

The project deliberately does not include a live **`.env`** file. Local environment files normally contain database credentials, a session-signing secret, and provider API credentials. They are excluded from version control by `.gitignore`; copying a live deployment file into the repository would create a material credential-exposure risk.

## Create a Local Configuration File

Copy the contents of `docs/local-environment.template.txt` into a new `.env.local` file and replace every `replace-with-…` value with credentials issued for a development environment. Do not reuse the production database, session secret, or provider key for local work. The template identifies whether a variable is **server-only** or deliberately browser-visible.

```bash
cp docs/local-environment.template.txt .env.local
```

| Variable group | Used by | Handling requirement |
|---|---|---|
| `DATABASE_URL`, `JWT_SECRET`, `BUILT_IN_FORGE_API_KEY` | Server only | Treat as secrets; never prefix them with `VITE_`, commit them, or paste them into tickets/chat. |
| `OAUTH_SERVER_URL`, `OWNER_OPEN_ID` | Server only | Obtain from the authorised identity/deployment administrator. |
| `VITE_APP_ID`, `VITE_OAUTH_PORTAL_URL` | Browser and server sign-in flow | These are public configuration identifiers/endpoints, not password or token values. |
| `VITE_APP_TITLE`, `VITE_APP_LOGO` | Browser presentation | Optional application branding values. |

## Development and Deployment

The managed Hub deployment receives its environment securely and does not load `.env.example`. Do not add a real `.env` to source control or change deployment secrets by editing files. When a real credential must be added or rotated, use the secure project configuration flow so development and production retain the same typed environment contract.

> A successful local sign-in also requires the identity provider to permit the local callback origin. Preserve the existing nonce-bound callback flow; do not create a second callback or add a password-based fallback in the Hub.
