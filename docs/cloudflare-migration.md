# Cloudflare migration runbook

## Architecture

- Worker `bastet-console` serves the existing Pages Router UI and APIs using vinext.
- D1 database `bastet-console`, binding `DB`, replaces the public Supabase tables.
- Google OAuth and existing HS256 sessions keep the original client and JWT secret.
- JSON is stored as JSON text; booleans as integers. Original UUIDs and timestamps
  are retained. Parameterized queries enforce per-user and campaign permissions.
- No browser Supabase client, service-role key, debug credential endpoints, or
  OAuth token logging remains. The browser receives public user profile fields only.

## Data migration

1. Recover the inactive source project if required; do not create an empty replacement.
2. Export all public tables, schema, and storage inventory to a private directory.
   Keep credentials, OAuth tokens, email addresses, and row contents out of logs.
3. Verify schema coverage before applying `migrations/0001_console.sql` to new D1.
4. Import once into the empty target, preserving IDs and relationships. Compare all
   row counts, normalized row hashes, and foreign-key integrity against the export.
5. Recheck the source immediately before cutover. If writes changed it, stop and
   repeat a consistent export/import while source writes are paused.
6. Verify Worker APIs and browser rendering before attaching `console.bastet.ai`.

Never run destructive resets on either provider. Retain the source database and
private export for rollback until the user explicitly approves their removal.

## Git deployment

Connect `bastet-ai/bastet-console` under Worker Settings → Builds. Use branch
`main`, root `/`, build `npm run build`, deploy `npm run deploy`, and preview
deploy `npm run deploy:preview`. Configure Node 24 and the public build-time
`NEXT_PUBLIC_GOOGLE_CLIENT_ID`. Keep runtime secrets on the Worker.

The initial migration uses CLI deployment. Automatic Builds is not active until
the GitHub app authorization and repository connection have been completed.
Do not overlap a manual production deploy with an active automatic build.
`vercel.json` disables future Vercel Git deployments; existing deployments and
the source database remain available for controlled rollback.

## Export and import commands

The exporter requires a Supabase management token plus the original service-role
key in the environment. Never paste them into shell arguments or checked-in files.

```sh
node scripts/export-supabase.mjs --project-ref xmqbjjdtmtebatkygxum --output-dir /private/fresh-backup
node scripts/import-d1.mjs --export /private/fresh-backup --validate-only
node scripts/import-d1.mjs --export /private/fresh-backup --wrangler-auth /path/to/wrangler/default.toml
# Only after preflight passes and the target is confirmed empty:
node scripts/import-d1.mjs --export /private/fresh-backup --wrangler-auth /path/to/wrangler/default.toml --import
node scripts/import-d1.mjs --export /private/fresh-backup --wrangler-auth /path/to/wrangler/default.toml --verify-only
```

Exporter snapshots all public base tables in one statement. The importer checks
snapshot hashes and schema, refuses a populated database, uses a parameterized
atomic batch, and compares normalized full rows and foreign keys afterward.

## Migration verification (2026-09-30)

The original inactive Supabase project was recovered on its existing free plan.
Its 10-table/102-column schema matched D1. The import and a second verification
matched complete normalized row hashes and passed foreign-key checks. A fresh
source snapshot showed no data or schema drift before cutover. Auth and object
storage inventories were empty, so no R2 bucket or Supabase Auth migration was needed.
The original data remains intact; a private, Git-ignored backup was also retained.

Local validation covers D1 behavior, export/import integrity, and the built Worker
HTTP routes. Authenticated preview reads returned the migrated user and campaigns,
without exposing OAuth tokens. Public debug credential endpoints return 404.
Google interactive sign-in remains a user/browser check, not a synthetic test claim.

## Rollback and limitations

Keep the previous Vercel project and Supabase data intact. A routing rollback alone
is unsafe after D1 receives writes: export/reconcile those new records first.
Google interactive consent/sign-in needs a real account/browser verification.
The old WebSocket handler was a placeholder; its replacement returns 501 rather
than claiming a persistent connection exists. This migration does not provision
new scanning infrastructure for the operator or swarm starter.
