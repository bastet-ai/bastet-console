# Majin backend and local debug console

## Architecture

Both UI instances use one API and database:

- Public: `console.bastet.ai` serves vinext on Cloudflare; `/api/*` proxies to Majin.
- Local: `npm run dev:debug` serves `http://127.0.0.1:5173` and proxies to Majin.
- API: `https://majin.x43.io/bastet-console/api/*`, routed by the existing Caddy.
- Storage: `/home/pierce/bastet-console-data/console.sqlite` on Majin. SQLite WAL,
  foreign keys, transactional batches, and parameterized SQL preserve D1 semantics.
  This is separate from Buzz PostgreSQL and the scan-data PostgreSQL database.

The console is single-node, not highly available. Majin availability and backups
are now operational dependencies. Do not place the SQLite file on network storage
or scale this container across hosts without changing the storage architecture.

## Authentication and local trust boundary

Google login stays enabled on the public console. Majin retains the existing
Google client and JWT signing secrets, preserving user IDs and existing sessions.
The API requires `CONSOLE_SERVICE_KEY` in addition to user JWT authentication.
Cloudflare strips untrusted internal headers and supplies its own service key.

Local debug is an explicit Vite development mode, bound only to loopback. Its
server validates Host, peer address, Origin and Fetch Metadata. Login requires a
custom header; the browser receives only an opaque eight-hour local session.
The local server holds a separate `CONSOLE_DEBUG_KEY`. This key never goes to the
browser or Cloudflare and cannot be supplied through the public Worker proxy.
Logout invalidates the local session; restarting Vite clears all local sessions.

There is no global admin role in the existing schema. The default debug admin is
the configured existing console owner (`CONSOLE_DEBUG_USER_ID`), retaining the
same ownership/membership permissions. Anyone who can use this local server can
edit that owner's **live production data**. Do not expose it through a tunnel,
LAN address, remote port forward, or reverse proxy. Debug is disabled for builds.

## Run locally

Use Node 24, `npm ci`, and provision `.env.debug.local` from `.env.debug.example`
through a private channel. Restrict the file to mode 600. Then:

```sh
npm run dev:debug
```

Choose **Sign in as local admin**. A persistent banner identifies live data.
The production console never exposes `/api/auth/debug`.

## Deploy the API

Bundle `scripts/serve-api.ts` with esbuild (Node 24, CJS, bundled dependencies).
Build `deploy/Dockerfile.api` with only the resulting `api.cjs` in the context.
Use an immutable release tag, recorded commit, and compiled bundle SHA-256.
The Compose template runs as UID 1000, with no published ports, dropped Linux
capabilities, a read-only root filesystem, resource limits and a health check.
Caddy reaches the `bastet-console-api` alias on `buzz-prod_buzz-net`.

Runtime secrets live in `/home/pierce/gitops-secrets/console/api.env`, mode 600:
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `NEXTAUTH_URL`,
`CONSOLE_SERVICE_KEY`, `CONSOLE_DEBUG_KEY`, `CONSOLE_DEBUG_USER_ID`.
Compose's release tag lives in the adjacent `.env` as `CONSOLE_RELEASE`.
No secret files belong in Git or Docker image layers.

Cloudflare needs `CONSOLE_SERVICE_KEY` as a secret and `CONSOLE_API_ORIGIN` as
`https://majin.x43.io/bastet-console`. Production preview URLs are disabled.
`CONSOLE_STORAGE=d1` is an explicit migration/rollback mode, never an automatic
fallback on a Majin error. Do not enable it after Majin accepts writes without
first reconciling the databases. Keep old D1 resources for recovery, not dual writes.

## Migration and recovery

1. Validate existing OAuth/JWT credentials privately. Check deployment settings
   for an active Git build before any manual Cloudflare deployment.
2. Stage and validate the API against a private preliminary export.
3. Deploy the Worker with `MIGRATION_READ_ONLY=1`, no Majin origin, explicit D1
   mode. Verify mutation requests return 503. Allow in-flight requests to finish.
4. Export D1 to a mode-600 SQL file. Never publish Wrangler's signed export URL.
5. Run `node scripts/import-sqlite.mjs export.sql NEW_DATABASE_PATH`.
   The importer refuses an existing destination and checks integrity/FKs. Compare
   full-row SHA-256 manifests and counts for every table before switching traffic.
6. Stop the staged API, preserve its preliminary DB, install the verified final
   database, and restart. Validate health and authenticated reads.
7. Activate the Majin Worker proxy and remove the write freeze. Verify a local
   write through production, then delete only the disposable verification record.
8. Keep the frozen D1 snapshot and private exports. Before Majin has accepted
   writes, rollback can use the prior D1 Worker. After new writes, take a fresh
   Majin backup and reconcile it; blindly reverting would lose those writes.

Use SQLite's online backup API for a running database, not `cp` of its main file
while WAL writes are active. Keep an off-host backup and test restoration. Never
overwrite the live file during restore: stop the API, preserve the current file
and WAL, restore into a fresh directory, verify integrity, then change the mount.

## Validation

`npm run typecheck`, `npm test`, `npm run test:sqlite`, `npm run test:migration`,
`CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npm run build`, `npm run test:worker`.
Tests use disposable local data. The D1 import-specific test is deliberately
skipped in SQLite mode; the SQLite backend runs the shared ACL/transaction suite.
