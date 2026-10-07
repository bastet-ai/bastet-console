# Mission: deploy bastet-console stack-inventory (commit ffb692e) to Majin production

You are the deployment engineer. The repo is /home/user/clawd/bastet-console at main (already pulled; HEAD ffb692e "Add versioned stack inventory, advisory matching, and release research"). Production host: `ssh pierce@majin.x43.io`. Your binding contract is docs/inventory.md section "Deployment and rollback" plus docs/majin-backend.md — read both fully before touching anything. Also read NOTES.md (latest entry) and postgres-backend.md if present.

## Non-negotiables
1. BACKUP FIRST: take and verify the existing native PostgreSQL backup procedure for bounty-data-postgres on Majin BEFORE any migration (docs step 1). Do not proceed if the backup cannot be verified.
2. The migration runs ONLY via `npm run inventory:migrate` with INVENTORY_MIGRATION_DATABASE_URL as documented (step 2): SET ROLE console_owner procedure, temporary membership provisioned and REVOKED after success, additive schema only, refuses partial/existing schema. Never modify public bounty tables or Buzz's database. Never drop anything.
3. Secrets stay on-host: gitops-secrets under /home/pierce (discover the existing console env files; inventory.env goes mode 600 per docs step 5). Do not print, copy into repo, or commit any credential or DSN. Never put credentials in shell arguments (files only; compose quote parsing).
4. Build image ONLY from the protected context printed by `npm run build:api` (Node 24 — check which node is active; use nvm/corepack if needed). Immutable content-derived tag. Keep the prior image bastet-console-api:pg-f0dfc425387b available for rollback.
5. Preflight BEFORE switching traffic: run the new image as an isolated no-published-port container against the same PG/TLS config, verify health + authenticated reads per docs/majin-backend.md preflight procedure. Only then update the live compose service.
6. Cloudflare/Wrangler frontend: attempt only if wrangler auth exists on this box (`npx wrangler whoami`). If unauthenticated, STOP at that step, report it — do not fake or force a frontend deploy. The API is backward-safe: before frontend rollout, inventory simply reports unavailable.
7. Every verification you claim must be an observed command output. Record image tags, migration result, container status, health checks into NOTES.md (append, dated) — production identifiers ONLY after observing them. Commit+push NOTES.md + any genuinely required config changes (git add only your own files).

## Procedure (docs/inventory.md steps 1-7, adapted)
- Explore first: on Majin, `docker inspect bastet-console-api-1` to find its compose project path, env-file locations, and how the API reaches bounty-data-postgres (host/port/TLS). Mirror that pattern for the inventory profile service.
- Run validation suite locally before building: `npm ci` (Node 24), `npm run typecheck`, `npm test`, `npm run test:migration`, `npm run build:api`. If a suite fails, fix is NOT in scope — stop and report precisely which check fails and why.
- Migration on Majin via the documented owner procedure (step 2). Verify schema.inventory exists, console_api grants are as the migration prints, and existing console/bounty schemas untouched (compare table lists pre/post for the public schema).
- Deploy API image with preflight (step 4), activate `docker compose --profile inventory up -d api inventory-sync` with the step-5 env (verify api.osv.dev egress + first sync).
- Step 7 synthetic verification: create a synthetic campaign/fingerprint via the API (worker token or debug path per docs — no live targets, no real program data), verify event replay idempotency and a research token revocation responds 401. Keep all fixtures synthetic.
- Rollback plan ready before touching live: keep prior tag; if health fails after switch, restore prior tag immediately and report.

## Definition of done
NOTES.md updated with observed evidence; containers healthy; inventory schema live; inventory-sync first pass done; your final report lists: what is live (image tags, container states, migration verification), what was NOT deployed (e.g. Cloudflare if no auth) and why, and anything you could not verify. Work autonomously; do not ask questions — if genuinely blocked, stop cleanly and report the exact blocker.
