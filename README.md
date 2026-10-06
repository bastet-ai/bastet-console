# Bastet Console

The Bastet management console serves its frontend from Cloudflare Workers with
vinext (Pages Router). The API, Google OAuth exchange, and SQLite database run on
Majin. The local debug console uses that same backend and live data.

See [Majin and local development](docs/majin-backend.md) for deployment, security,
backup and rollback instructions. The older D1 migration runbook is historical.

## Development

Use Node.js 24 and the checked-in npm lockfile.

```sh
npm ci
npm run dev:debug
```

Provision `.env.debug.local` from `.env.debug.example` through a private channel
first (mode 600). Open `http://127.0.0.1:5173` and choose **Sign in as local admin**.
Anyone on this computer can access the existing owner's live account while the
debug server runs. Never expose or tunnel this port. Google login remains required
on the public console. Never commit local environment files or service keys.

```sh
npm test
npm run typecheck
npm run test:sqlite
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npm run build
npm run test:worker
npm start
```

Tests exercise SQL, transaction rollback, tenant isolation, membership permissions,
JWT compatibility, the Majin HTTP adapter, and local-debug trust boundaries.

## Deployment

Worker: `bastet-console`. Configuration: `wrangler.jsonc`.
Set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` during the build. Set runtime credentials with
`wrangler secret put`, never in source or command-line arguments:

| Setting | Location |
| --- | --- |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Build environment, public OAuth client ID |
| `GOOGLE_CLIENT_ID` | Majin environment; same OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Majin secret |
| `JWT_SECRET` | Majin secret; preserve it to keep existing sessions valid |
| `NEXTAUTH_URL` | Majin environment, `https://console.bastet.ai` |
| `CONSOLE_API_ORIGIN` | Worker variable and local server configuration |
| `CONSOLE_SERVICE_KEY` | Worker, local server, and Majin secrets |
| `CONSOLE_DEBUG_KEY` | Local server and Majin only, never the browser |
| `CONSOLE_DEBUG_USER_ID` | Majin environment; existing console owner |
| `DB` | Retained D1 recovery binding, not the live database after cutover |

```sh
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npm run build
npm run deploy
```

Do not import into a live database or switch to stale D1 after Majin accepts writes.
Check for an active Git build before manual deployment. See the Majin runbook.

The legacy WebSocket endpoint was never a functioning socket server. It now
returns an explicit 501. Persistent node connections require a separately designed
Durable Object implementation; they are not simulated by per-isolate memory.
