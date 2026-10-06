# Bastet Console

The Bastet management console serves its frontend from Cloudflare Workers with
vinext (Pages Router). Local and hosted Node APIs share the `console` schema in
Majin's PostgreSQL database. The hosted API remains on Majin as a transitional
Worker proxy target; the local API runs on this workstation. HackerOne account
credentials stay only on the workstation. Both consoles see the same live data.

See [PostgreSQL and local development](docs/postgres-backend.md) and
[Majin deployment](docs/majin-backend.md) for security, backup and rollback
instructions. The older D1 and SQLite migration sections are historical.

## Development

Use Node.js 24 and the checked-in npm lockfile.

```sh
npm ci
node --env-file=.env.postgres.local --import tsx scripts/serve-api.ts
# In another terminal, with the protected SSH database tunnel running:
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
| `GOOGLE_CLIENT_ID` | Local and Majin API environments; same OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Local and Majin API secrets |
| `JWT_SECRET` | Both APIs; preserve it to keep existing sessions valid |
| `NEXTAUTH_URL` | Both APIs, `https://console.bastet.ai` |
| `CONSOLE_API_ORIGIN` | Worker variable and local server configuration |
| `CONSOLE_SERVICE_KEY` | Worker, local server, and Majin secrets |
| `CONSOLE_DEBUG_KEY` | Local server and Majin only, never the browser |
| `CONSOLE_DEBUG_USER_ID` | Both APIs; existing console owner |
| `CONSOLE_STORAGE` | Both Node APIs, explicitly `postgres` |
| `CONSOLE_DATABASE_URL` | Each API's protected environment, limited console service login |
| `CONSOLE_POSTGRES_CA_FILE` | Server-only CA path for verified PostgreSQL TLS |
| `HACKERONE_API_USERNAME`, `HACKERONE_API_TOKEN`, `HACKERONE_API_OWNER_ID` | Local API only; never Majin, Worker, browser, or agents |
| `DB` | Retained D1 recovery binding, not the live database after cutover |

```sh
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npm run build
npm run deploy
```

Do not import into a live database or switch to stale SQLite/D1 after PG accepts writes.
Check for an active Git build before manual deployment. See the Majin runbook.

The legacy WebSocket endpoint was never a functioning socket server. It now
returns an explicit 501. Persistent node connections require a separately designed
Durable Object implementation; they are not simulated by per-isolate memory.
