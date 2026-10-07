# Local console with shared PostgreSQL

The local Node 24 API and transitional Majin Node API share PostgreSQL. HackerOne
credentials remain only on the local host; Google/JWT credentials remain aligned
between both APIs. The browser has no database or upstream integration credentials.
The Cloudflare frontend still proxies to Majin; direct Cloudflare/Hyperdrive DB
connectivity is a separate stage. Buzz and existing public bounty tables are unchanged.

## Prepare the database

`migrations/postgres/0001_console.sql` is a transactional, fresh-schema migration.
Apply it once using a dedicated migration role. It refuses an existing `console`
schema; it never drops data or modifies `public` tables. It creates the current
10 console tables, using TEXT IDs, JSONB data, TIMESTAMPTZ timestamps and the
existing 0/1 WebSocket flag. Do not replay historical Supabase SQL.

Provision a separate non-owner, non-superuser console service login with USAGE
on `console` and SELECT/INSERT/UPDATE/DELETE on its tables, no CREATE or role
administration privileges. Do not give research agents this login. Direct-agent
access and mapping console campaign IDs to existing public program IDs belong
to the separately reviewed orchestration schema. API tenancy checks remain
mandatory; this migration does not claim to implement agent RLS.

Use verified TLS for direct PostgreSQL connections. An explicitly configured SSH
tunnel may terminate on literal `127.0.0.1` or `::1`; only those addresses allow
`sslmode=disable`. URL-supplied session options and search paths are rejected.
The adapter pins `pg_catalog,console,pg_temp`, caps its pool and sets statement timeouts.
No automatic SQLite fallback or dual writes are performed.

For a private CA, set `CONSOLE_POSTGRES_CA_FILE` to its PEM certificate path.
Certificate and hostname verification remain enabled; never use a global TLS
verification bypass. Majin uses the internal `bastet-console-db` Docker network,
PG alias `bounty-console-postgres`, and a read-only CA mount into the API. No
database port was published beyond the existing host-loopback listener. PostgreSQL
TLS was enabled through config reload without changing other clients' auth policy.

## Start the API and frontend

Provision protected environment files privately, never through browser-visible
Vite settings. The API needs these existing settings: `CONSOLE_SERVICE_KEY`,
`CONSOLE_DEBUG_KEY`, `CONSOLE_DEBUG_USER_ID`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `NEXTAUTH_URL`. Add:

```dotenv
CONSOLE_STORAGE=postgres
CONSOLE_DATABASE_URL=postgresql://SERVICE_USER:PASSWORD@127.0.0.1:TUNNEL_PORT/DATABASE?sslmode=verify-full
CONSOLE_POSTGRES_CA_FILE=/absolute/protected/postgres-ca.crt
HOST=127.0.0.1
PORT=3000
```

The optional HackerOne settings are `HACKERONE_API_USERNAME`,
`HACKERONE_API_TOKEN`, `HACKERONE_API_OWNER_ID`. They stay on the local API host.
Seed/import the existing console owner ID into `console.users` before login.
Preserve IDs and the JWT secret when migrating existing users and sessions.

Run `node --env-file=/absolute/protected/api.env --import tsx scripts/serve-api.ts`.
In the existing protected `.env.debug.local`, point `CONSOLE_API_ORIGIN` to
`http://127.0.0.1:3000`, retaining the matching service/debug keys. Then run
`npm run dev:debug`. Both listeners must remain loopback-only; do not tunnel the
frontend. The debug account has the configured owner's real data access.

The API checks the database schema before listening. It does not create schema,
seed identities, migrate existing data or run PostgreSQL backups automatically.
Schedule database-native, off-host backups and test restores before production
cutover. Freeze every writer, preserve the previous database, verify normalized
row counts/digests, and reconcile before rollback after new writes.

## Protected migration and current operation

`scripts/import-postgres.ts PRIVATE_SQLITE_SNAPSHOT` uses a protected environment
containing `CONSOLE_DATABASE_URL` and optional `CONSOLE_POSTGRES_CA_FILE`. It refuses
group/world-readable snapshots, foreign-key/integrity failures, unexpected tables,
schema/column mismatches and populated destination tables. One serializable
transaction creates a fresh schema (or uses an exact empty schema), locks it, copies
all ten tables, and compares complete normalized row hashes before committing.
JSON precision is preserved by casting raw source text on PostgreSQL, not through
JavaScript numbers. D1 migration-history metadata remains in the source backup.

Current application identity: `console_api`, CRUD only on console tables. The
`console_owner` schema/table owner is NOLOGIN; the temporary `console_migrator`
was locked to NOLOGIN with password removed and owner membership revoked after copy.
Never give these roles or environment files to research workers.

The October 6 cutover preserved a full PG dump, role dump, prior configuration
and frozen SQLite snapshot on Majin and this workstation. All ten table counts and
complete-row hashes matched before activation. The original SQLite file remains
untouched for recovery. `bastet-postgres-backup.timer` now runs nightly at 03:15 UTC
with up to 15 minutes jitter on Majin's persistent user manager. Its service invokes
`deploy/backup-postgres.sh`: full database plus globals/role dump, owner-only files,
archive-list validation, hashes and private diagnostics. Snapshots go into
`/home/pierce/bastet-console-data/postgres-backups` (700, files 600), with no automatic
deletion. Failed partials are retained for diagnosis; failure journal events omit data.

A fresh backup passed a complete restore in an offline, no-published-port PG17
container, including all 10 console, 7 public and 8 orchestration tables. That
verification container was removed afterward; the protected off-host dump remains.
**Ongoing automatic off-host replication is not configured.** The old SQLite daily
routine is no longer the live backup. Keep periodic restore drills and off-host
copies as operational requirements; a local disk backup does not cover host loss.

Local services are `bastet-console-api.service`, `bastet-console-debug.service`, and
`bastet-console-db-tunnel.service` in the user's systemd manager. The SSH tunnel
is manual-only: it has no install target or restart loop, and the API unit does not
start it as a dependency. On this workstation the tunnel unit is normally masked;
unmask and start it only for an explicitly requested Majin session, then stop and
mask it again. No Bastet unit may request the user's SSH key during login or boot.
The tunnel is 127.0.0.1:6544 to Majin's 127.0.0.1:5434. Restarting the
debug service invalidates local sessions; sign in again. Keep all listeners on
loopback. The private CA/certificate require renewal before certificate expiry.

## Read-only program progress

`GET /api/campaigns/:id/progress` checks campaign membership before calling the
allowlisted `bastet.console_progress(text)` function. Console does not read agent
credential, lease or control tables directly. Missing orchestration or a legacy
SQLite backend returns `configured: false`; no linked run returns `progress: null`.
The UI refreshes every 30 seconds and shows observed versus desired worker states,
recent tasks and saved reports. Agent Markdown is escaped text, never executable
HTML. This endpoint cannot launch, resume or reconfigure agents.

## Validation

Run `node --import tsx tests/postgres.test.ts` for configuration and SQL tests.
For real database tests, set `CONSOLE_TEST_POSTGRES_URL` to a disposable,
loopback-only database named exactly `console_test`, with no existing `console`
schema. The suite creates and removes only its own test schema. Never use a live
application database. It tests repository ACLs, transaction rollback, concurrent
digest guards, JSON/timestamps and the real local HTTP adapter.

For a read-only live check, run:

```sh
node --env-file=.env.postgres.local scripts/verify-live-console.mjs CAMPAIGN_UUID
```

This authenticates GETs through local API, hosted Worker, and service-authenticated
Majin API; it compares campaign status, saved scope digest and linked run ID. It
prints only status/count metadata, never credentials, policy or report bodies.

Cloudflare/Hyperdrive support is a separate deployment stage. Do not change the
existing Worker origin or enable stale D1 as part of starting this local path.
