# Majin backend and local debug console

## Architecture

Both UI instances share one PostgreSQL database through two Node APIs:

- Public: `console.bastet.ai` serves vinext on Cloudflare; `/api/*` proxies to Majin.
- Local: `npm run dev:debug` serves `http://127.0.0.1:5173` and proxies to the
  workstation API on `http://127.0.0.1:3000`.
- API: `https://majin.x43.io/bastet-console/api/*`, routed by the existing Caddy.
- Storage: the additive `console` schema in Majin's existing bounty PostgreSQL
  database. Existing public bounty tables and Buzz's separate database are unchanged.
  `console_api` has console CRUD, not schema ownership or research-agent credentials.
  The optional read-only orchestration function is separately granted.

The database is single-node, not highly available. Majin availability and backups
remain dependencies. See [PostgreSQL operations](postgres-backend.md). The old
SQLite file and D1 snapshot are frozen recovery sources, not alternative live stores.

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

Run `npm ci` under Node 24, then `npm run build:api`. The helper prints a fresh
ignored Docker context and content-derived `release` tag, records Git revision/
dirty state and SHA-256 hashes, and copies only the API bundle, Dockerfile and
strict allowlist into that context. Commit reviewed source before a production
package; record any deliberately preserved unrelated dirty files separately.

The locked esbuild build is exactly `bundle:true`, `platform:'node'`,
`target:'node24'`, `format:'cjs'`, `external:['pg-native']`. `pg`'s normal JavaScript
implementation is bundled; the unused optional native addon is not installed.
Node builtins including `node:sqlite` remain runtime builtins. Dockerfile's
portable `RUN chmod 0444 /app/api.cjs` ensures root-owned build artifacts remain
readable by the non-root runtime, including with the existing legacy Docker builder.

Use the exact context and release printed by the helper:

```sh
docker build -t bastet-console-api:RELEASE /absolute/printed/context
```

Do not use the repository or a backup directory as Docker context. Retain the
`release.json` manifest, whose bundle hash must match `/app/api.cjs` in the image.
Before changing the current release, launch an isolated no-published-port copy
against the same PG/TLS configuration and verify health plus authenticated reads.
Compose env files use quote parsing; raw `docker run --env-file` does not, so use
a protected correctly parsed preflight env file or a Compose preflight. Never
put credentials directly in shell arguments. Use an immutable release tag and
preserve the prior PG image for rollback; never revert the live database.

The Compose template runs as UID 1000, with no published ports, dropped Linux
capabilities, a read-only root filesystem, resource limits and a health check.
Caddy reaches the `bastet-console-api` alias on `buzz-prod_buzz-net`.

Runtime secrets live in `/home/pierce/gitops-secrets/console/api.env`, mode 600:
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `NEXTAUTH_URL`,
`CONSOLE_SERVICE_KEY`, `CONSOLE_DEBUG_KEY`, `CONSOLE_DEBUG_USER_ID`.
Compose's release tag lives in the adjacent `.env` as `CONSOLE_RELEASE`.
No secret files belong in Git or Docker image layers.

Both Node APIs now explicitly set `CONSOLE_STORAGE=postgres`. Majin uses a
verified-TLS `CONSOLE_DATABASE_URL` plus read-only `CONSOLE_POSTGRES_CA_FILE`.
The dedicated internal Docker network is recorded in both console and bounty
Compose templates; existing database port publication remains loopback-only.
Nightly PostgreSQL backups and local user-unit operation are documented in the
[current PG runbook](postgres-backend.md).

### Private HackerOne onboarding

The optional integration uses the official Hacker API, not anonymous GraphQL.
Configure `HACKERONE_API_USERNAME`, `HACKERONE_API_TOKEN`, and
`HACKERONE_API_OWNER_ID` only in the workstation's protected `.env.postgres.local`.
Do not copy these credentials to Majin, Cloudflare or research agents. The hosted
API can read saved snapshots but its HackerOne setup gate remains unconfigured.
The owner ID is an existing **console user ID**, not the
HackerOne username. Only that signed-in user may use this account credential.
Do not put these values in Cloudflare, Vite variables, browser storage, Git,
images, logs, or campaign metadata. A local ignored `.env.hackerone.local` can
be used for private provisioning; it is not loaded by the frontend.

HackerOne personal tokens are account credentials, not a program-specific
read-only grant. Bastet calls only three documented GET resources: program,
structured scopes, and scope exclusions. It never submits reports, accepts
invitations, or launches tests. Generating a personal token revokes the previous
one; confirm existing consumers before rotating it. See the
[official token guide](https://docs.hackerone.com/en/articles/8410331-api-token)
and [Hacker API reference](https://api.hackerone.com/hacker-resources/).

Onboarding accepts a program handle or HackerOne program URL. Review the full
policy, included and excluded assets, bounty eligibility, full asset notes,
and linked private rules/announcements. API access alone does not verify all
separate web pages, personal eligibility, or testing authorization. Resolve
conflicts with the program before testing. Private data must not be shared
with uninvited collaborators or copied into public repository fixtures.

Imports remain private and start paused. The server re-fetches and verifies
the preview SHA-256 at creation; client-supplied policy and metadata are not
trusted. The snapshot stores complete returned text, source URLs, fetch time,
and a digest excluding fetch time. Pagination is bounded to 100 pages per
collection and 4 MiB total upstream data. Any incomplete/failed fetch leaves
existing data unchanged. Large snapshots beyond these limits require a
separate reviewed import, not silent truncation. Large-snapshot D1 recovery
compatibility is not established; production uses shared PostgreSQL.

### Name-to-setup onboarding

The import field accepts a program name, handle, or HackerOne URL. Name lookup
uses the configured owner's authenticated `GET /v1/hackers/programs` catalog,
not public search. A handle-shaped name first tries the documented single-program
resource and offers its identity for explicit confirmation without reading the
catalog. A 404 falls back to catalog lookup; other errors fail closed. Only a
unique exact catalog name/handle resolves automatically; partial and ambiguous
matches require a selection. The entire bounded catalog must be read before
resolving a catalog match, so truncation cannot silently choose the wrong program.
HackerOne includes public programs and full policies in that catalog, which may
exceed the import limits. A direct program URL bypasses catalog lookup.

The verified scope also generates a setup proposal bound to its SHA-256 digest.
Eligible, non-archived assets are grouped into Android, iOS, web, and manual
review. Android proposals include Android SDK/ADB, an owned device or emulator,
JADX, Apktool, Frida and an intercepting proxy. The proposal records reasons,
official tool references, and prerequisites such as an approved app source,
test accounts, runtime/ABI compatibility, and any device modifications.

This is a fixed, versioned planning catalog, not an LLM interpreting policy as
commands. Program prose cannot add tools, execute commands, or authorize a
download. Selecting a target group changes the review view only. The full plan
is saved with new/refreshed imports; the UI derives its current proposal from
the verified snapshot, including for earlier imports. No tool installer,
environment inspection, VM provisioner or execution runner is invoked. APK
acquisition, installation, license acceptance, device changes, paid resources,
policy/announcement conflicts and testing all need separate review/approval.

Refresh is preview then explicit acceptance. The server verifies both the
new digest and the previous saved digest; an atomic database condition rejects
concurrent changes. Changed snapshots pause the campaign. The prior digest is
retained as one-hop provenance, not full version history. Existing legacy
imports have no full verified snapshot until refreshed. Snapshot acceptance
is not runner authorization; automated target enforcement is outside this
onboarding feature. An upstream program pause or new restriction discovered
by preview must be respected immediately, even before saving the update.

Cloudflare needs `CONSOLE_SERVICE_KEY` as a secret and `CONSOLE_API_ORIGIN` as
`https://majin.x43.io/bastet-console`. Production preview URLs are disabled.
`CONSOLE_STORAGE=d1` is an explicit migration/rollback mode, never an automatic
fallback on a Majin error. Do not enable it after Majin accepts writes without
first reconciling the databases. Keep old D1 resources for recovery, not dual writes.

## Historical D1-to-SQLite migration and recovery

The following records the earlier migration. PostgreSQL is now authoritative;
do not follow these steps as a current rollback without reconciling new PG writes.

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

The API makes a verified SQLite online backup on startup and every 24 hours in
`/home/pierce/bastet-console-data/backups` (mode 600 files, mode 700 directory).
These snapshots are retained without automatic deletion. Failure logs use
`sqlite_backup_failed`; successful verified snapshots log `sqlite_backup_verified`.
They protect against logical mistakes, not loss of Majin's disk. An off-host
copy is still needed. Use SQLite's online backup API for a running database, not
`cp` of its main file while WAL writes are active. Test restoration. Never
overwrite the live file during restore: stop the API, preserve the current file
and WAL, restore into a fresh directory, verify integrity, then change the mount.

## Validation

`npm run typecheck`, `npm test`, `npm run test:sqlite`, `npm run test:migration`,
`CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npm run build`, `npm run test:worker`.
Tests use disposable local data. The D1 import-specific test is deliberately
skipped in SQLite mode; the SQLite backend runs the shared ACL/transaction suite.
