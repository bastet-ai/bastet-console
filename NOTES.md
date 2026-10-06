# Console migration evidence

## 2026-10-05: Majin API and local debug implementation

- User selected moving the API/database to Majin, shared by Cloudflare and local UI.
- Starting console commit: `1f21e0d87ec6838a63c16151e9f5d373f40aa6a3`.
- Starting Worker version: `fe4c49f4-e22a-4f5a-8353-665f153d4811`.
- D1 export baseline: 1 user, 2 campaigns, 1 membership, 1 activity, remaining
  application tables empty; integrity and foreign keys verified after SQLite import.
- Existing local JWT secret validated against production; Google accepted the
  client credentials and rejected an intentionally invalid authorization code.
  No credential values or user records logged.
- Cloudflare Builds API permission is unavailable to Wrangler OAuth (403).
  Authenticated dashboard Settings > Builds shows Git repository **Connect**:
  no automatic Git connection. GitHub shows only successful validation checks.
- Majin Caddy and GitOps Caddy configurations match before migration, SHA-256
  `a36fc583f23bc7fb9beb2ec845e7f6747b64c7b27fad7a4a5c176a2f4af1e59d`.
- Node API container uses the verified Node 24.19.0 image pinned by digest.
- Passed: typecheck, all 15 unit/D1/HTTP/security tests, 6 shared SQLite tests
  (D1-specific importer skipped), 12 migration tests; built D1 Worker HTTP suite.
- Production cutover, final manifest verification and real browser checks pending
  at this implementation milestone. Private material stays under ignored `tmp/`.

## Cutover preparation

- Implementation milestone `43402ad487900707fabc5aca41e41f8dc6a1162c` pushed.
- Majin image `bastet-console-api:43402ad` healthy; direct unauthenticated access
  and service-only access to user routes return 401. Debug owner verifies with
  both private server credentials. Buzz NIP-11 still responds normally.
- Freeze Worker `d207054e-3ab4-4718-9c44-b4a83f508315`: verified POST /api/campaigns
  returns 503 on the custom domain and workers.dev.
- Final export imported into a fresh SQLite database; all 11 table counts and
  full-row hashes compared successfully against fresh queries to frozen D1.
- Preliminary Majin DB directory preserved at
  `/home/pierce/bastet-console-preflight-20261005`; original D1 unchanged.
- CI functional steps passed. Audit currently fails on existing transitive
  `braces` advisory GHSA-vfj7-8cjw-p6xm (via vinext build plugins; audit proposes
  a breaking vinext downgrade). The existing Socket workflow also fails because
  `socketsecurity/cli-action@v1` cannot resolve. Neither check was disabled.

## Completed live verification

- Cloudflare frontend/routing commit `79484c2`; deployed Worker version
  `3358d660-8d50-412d-851c-50435654af63`. Production uses Majin, write freeze removed,
  preview URLs disabled, D1 preserved as a recovery snapshot.
- Final API commit `f89aef6f00da9cadfcd4892ef57f9631103baa82`, image
  `bastet-console-api:f89aef6`, container `bastet-console-api-1` **healthy**.
  `/app/api.cjs` SHA-256 matches the local bundle:
  `409d51c56ac196c34257758981831caf324a0936300c15af9b600facc7517d83`.
- Infrastructure commit `9d2e732b385e069f9bf92b95b80204a11b9d4464` pushed and synced.
  Majin's deploy key is intentionally read-only; transported the exact commit as
  a Git bundle and pushed via the local authorized HTTPS identity. No deploy-key
  permissions were changed. GitOps checkout is clean.
- Browser verified: local passwordless login displays the two original campaigns
  and live-data banner. Existing production Google session loads the same two
  campaigns without reauthentication. A fresh Google consent/code flow was not
  replayed; existing credentials and production session verification passed.
- Live round-trip tested twice: create one disposable campaign locally, read it
  through production, update through production, read the update locally. Deleted
  only those test campaigns, with their test memberships/activities cascading.
- Verified production debug endpoint 404, local token rejected by production,
  injected private headers rejected through the Worker, direct Majin access 401,
  and local cross-origin login 403. Socket listener is **127.0.0.1:5173**, not LAN.
- Online backup created and integrity/FK checked on Majin. Downloaded portable
  snapshot `console-2026-10-06T00-49-33.308Z-35d12988-b7c2-4c04-a680-5e26ba2e54ab.sqlite`
  into private local `tmp/majin-migration-20261005/majin-online-backup.sqlite`.
  Independent restore passed, including all counts and every full-row hash against
  the frozen D1 manifest. Startup/daily backups retain snapshots on Majin; ongoing
  automated off-host backup is not yet configured.
- Final functional checks: 16 unit/D1/API/security/backup tests, 6 shared SQLite
  tests (D1-only import test skipped), 12 migration tests, TypeScript, production
  build, and built Worker HTTP checks pass. CI audit/Socket caveats above remain.
- Buzz NIP-11 and all existing healthy containers remain healthy; no Buzz or
  scan-data database was altered. Caddy reload did not restart Buzz services.
- Local server left running via `npm run dev:debug`; browser left signed in on
  the dashboard. Restarting Vite invalidates local debug sessions (sign in again).
- Existing unrelated `supabase/.temp/cli-latest` edit remains untouched/uncommitted.
