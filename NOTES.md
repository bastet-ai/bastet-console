# Console migration evidence

## 2026-10-08: Cloudflare frontend rollout (inventory UI) — Dean-authorized

- Device OAuth (`wrangler login --device`) completed by Dean; Bastet performed the
  rollout on main `cc31cc9`+ (inventory feature `ffb692e` + rollout record
  `095c42e`). `wrangler whoami` confirmed authenticated with Workers edit perms.
- Validation observed: `npm run test:worker` 1 pass / 0 fail; `npm run build`
  clean, emitted `inventory-*.js` chunk; `npm run deploy` uploaded and deployed.
- Version ID observed: `527b6ebd-23e0-40ef-af4b-be8fef5bb82b`; triggers
  `bastet-console.bcrt43.workers.dev` + custom domain console.bastet.ai.
- Live checks (unauthenticated edge): `/` 200; `/inventory` 200 serving the app
  shell with Sign-in gate and inventory content markers; `/api/inventory` 401
  without credentials (auth wall held). Signed-in UI campaign isolation NOT
  personally verified by Bastet (owner browser session required).
- Cloudflare skills/MCP page fetched per Dean's instruction and reviewed; its
  prescribed steps (Claude-Code plugin install / global `npx skills add`,
  MCP registration, optional `cf` CLI) are agent-environment changes outside
  this repo task and not required for the deploy; not installed. `wrangler`
  path completed the job. (If Dean wants the MCP server registered for future
  Cloudflare work, say so.)

## 2026-10-06: Review publication and live verification

- Implementation commit `2250fb730af7514dcb7618363d7f36402867eba8` is published on
  `codex/postgres-program-progress` in PR #5. Direct default-branch publication
  was rejected by the approval policy; main is unchanged remotely. User approval
  was requested for merging and the Cloudflare frontend release. No workaround
  deployment was performed. The local new UI and shared Majin API are live.
- Main-agent validation passed: 89/91 tests with two intentional opt-in PG skips,
  TypeScript, production build, and the built Worker HTTP test. Independent live
  PG tests and full restore checks are recorded below. The local rendered browser
  shows actual agent heartbeats and completed tasks from the shared database.
- Existing CI failures were verified on PR #5: validation reaches npm audit and
  fails on 12 high transitive findings through braces, sharp and source-map-js;
  Socket fails resolving `socketsecurity/cli-action`. No checks were disabled or
  breaking forced dependency downgrades applied. These remain review items, not
  passing security checks.
- Private program policy, scope, results and credentials remain outside Git.
  The installed upstream vinext skill and its lockfile are untracked local tooling;
  the unrelated Supabase CLI metadata edit remains untouched.

## 2026-10-06: Shared PostgreSQL and read-only program progress

- Added a real Node/PostgreSQL adapter, explicit dialect fragments, pinned schema,
  verified TLS/private-CA support, single-client transaction batches and null-safe
  digest compare-and-set. SQL placeholder conversion preserves quotes/comments.
- Fixed HackerOne single-program parsing for both documented wrapped and observed
  bare resource responses. Malformed envelopes still fail closed. Fixtures remain
  synthetic; account credentials remain on the workstation only.
- Froze only the console SQLite writer, captured a consistent mode-600 snapshot,
  and migrated all ten application tables into a fresh `console` schema. Complete
  normalized row hashes and counts matched: 1 user, 2 campaigns, 1 membership,
  1 activity, other tables empty. D1 migration metadata remains in source backups.
  Original SQLite, D1 recovery resources, private PG dump and role/config backups
  are retained. No existing public bounty table or Buzz data was migrated/changed.
- Both local and hosted APIs now use the same canonical PostgreSQL database.
  `console_api` has console CRUD, not ownership; `console_owner` is NOLOGIN.
  The temporary migrator is NOLOGIN with password and owner membership removed.
  Research agents never receive console/HackerOne credentials.
- Enabled additive PostgreSQL TLS by config reload without restart. Verified the
  private CA and rejected an untrusted CA. Added only a dedicated internal Docker
  network/alias and CA mount; the published DB listener remains host-loopback.
- Initial verified PG/progress API image: `bastet-console-api:pg-1767c9835b13`, bundle SHA-256
  `84832439880f62f2acab7191cf29ca2e313055f50af8341dd5bca10280c71c0a`.
  A rollout permission failure was reverted to the working PG image without data
  rollback. Dockerfile now makes the non-secret bundle readable by its non-root
  runtime; the final image passed actual isolated-container preflight and live
  verification. Majin has no HackerOne environment credentials.
- Follow-up API copy correction points setup errors to the local backend rather
  than Majin. Current healthy image is `bastet-console-api:pg-f0dfc425387b`, bundle
  SHA-256 `5a4cc6e8f4d527dc8bec2d799ef610fb260dc1838f58c6e0f79f1ae91e5b7cce`.
  Reproducible packaging, isolated real-PG preflight and live authenticated
  progress reads passed before/after activation. Auth and persistence were unchanged.
- Added membership-gated `/api/campaigns/:id/progress` calling only the approved
  `bastet.console_progress(text)` projection. UI shows desired versus observed
  workers, recent tasks and reports every 30 seconds; Markdown/HTML is escaped
  text. The console cannot use this read route to launch or resume agents.
- Live read-only smoke checks agree through local API, hosted Worker and direct
  service-authenticated Majin API: same campaign state, scope digest and run ID.
  User-approved activation was made through the local campaign API and read back
  through production. No orchestration rows were changed by console migration.
- Local API (3000), debug UI (5173) and SSH DB tunnel (6544) are loopback-only,
  restart-supervised persistent user units, enabled for future desktop sessions.
  Workstation linger remains disabled; these are not pre-login system services.
- Majin's lingering user manager now runs a nightly PostgreSQL/role backup timer
  at 03:15 UTC plus up to 15 minutes jitter. Backup directory is 700, all dumps,
  manifests and diagnostic files are 600; no automatic retention deletion. A fresh
  dump restored fully in an offline temporary PG17 container: 10 console, 7 public
  and 8 orchestration tables, 3 campaigns and 1 user. The test container was removed;
  a protected off-host dump remains. Ongoing automatic off-host replication is not
  configured and is not implied by this one verified copy.
- Validation: full suite 91 tests (89 pass, 2 opt-in PG skips); real-PG suite 5/5;
  TypeScript and production build pass. Build emitted only the known restricted
  Wrangler log-path warning. Read-only live checks are reproducible with
  `scripts/verify-live-console.mjs` and a protected API environment file.
- No commit/push or Cloudflare frontend deployment was performed by this track.
  Keep existing unrelated `supabase/.temp/cli-latest` out of the release.

## 2026-10-06: Name-to-setup onboarding

- Added owner-only name lookup against the official paginated HackerOne account
  program catalog. Handle-shaped queries first fetch one program identity for
  explicit confirmation. Only unique exact catalog names/handles resolve
  automatically; partial/ambiguous matches require an explicit selection. The
  catalog includes public programs and full policies, so direct handles/URLs
  avoid an ordinary account exceeding the bounded list limit. Query and scope
  retrieval share a 20-second deadline below the 30-second proxy limit.
- Added deterministic, digest-bound setup proposals from eligible non-archived
  structured assets. Android proposals cover SDK/ADB, a test device/emulator,
  JADX, Apktool, Frida and a proxy with explicit prerequisites and fixed official
  source links. Unknown/conflicting identifiers require manual review. Policy
  prose cannot supply commands, installer URLs or additional tool IDs.
- Setup proposals remain private metadata and are recomputed server-side when
  campaigns are created/refreshed. Browser-supplied plans are ignored. The UI
  can focus the proposal on a target type but does not save execution settings.
  No downloads, installations, VM provisioning or testing are implemented here.
- API key remains unconfigured; real account lookup and private import are
  pending the user's credential hand-off. Tests use synthetic programs only.
- Rechecked pre-release remote main `0a2e32a`, healthy Majin API `1be9c66`, and
  Cloudflare settings (Majin origin, no Git build connection, logs/traces on).
- Baseline CI run `37497463541` fails the dependency audit with 12 high findings
  through braces, sharp and source-map-js. No dependencies or checks changed;
  proposed forced fixes include breaking framework/runtime downgrades and were
  not applied as part of this feature. Functional validation recorded below.
- Upstream skill installation could not resolve npm in the sandbox. Read the
  upstream vinext deployment guidance directly; kept the installed framework
  versions and existing generated-config workflow.
- Validation passed: 80 tests, 6 SQLite tests (1 intentional D1-only skip),
  12 migration tests, TypeScript, production build, Wrangler dry-run, and the
  built Worker HTTP test. Independent review identified a legacy malformed-
  snapshot rendering edge case; fixed it with combined-view regression tests.
- Local debug login still reaches Majin; live integration status correctly
  reports unconfigured without exposing credentials. No live program data or
  credentials were accessed by tests, and no production campaigns were created.
- Publication pending: automatic approval review rejected the combined commit
  and direct main-branch push because this turn did not explicitly authorize
  shared-branch publication. No commit, push or deployment was performed for
  this feature. Await user approval before publishing to main and releasing it.

## 2026-10-06: Private program onboarding

- Replaced anonymous, truncated GraphQL import with the official authenticated
  Hacker API's program, structured-scope, and scope-exclusion GET resources.
- Added authenticated integration status/import and credential-owner binding.
  Secrets stay on Majin; no credential UI or browser-visible service secrets.
- Full policy, asset instructions, eligibility, excluded and archived assets,
  source URLs, timestamp and content digest survive import. Creation re-fetches
  the preview digest; private/paused is enforced server-side. Linked scope cannot
  be overwritten via ordinary edits or made public.
- Refresh is a no-write preview followed by explicit acceptance, re-fetch,
  and atomic previous-digest compare-and-set. Changed content pauses campaigns.
- Verified synthetic coverage for authentication, cross-user isolation, full
  pagination, unsafe redirects/next links, malformed/oversize responses,
  stale preview and race rejection, safe text rendering, and UI review flow.
- Initial validation: 45 tests, 6 SQLite tests (1 intentional D1-only skip),
  12 migration tests, built Worker HTTP checks, TypeScript and production build
  pass. Archived-asset display regression added after independent review.
- Browser policy/scope/announcement review completed privately; no program
  details or credentials included in Git. Existing HackerOne token is active
  but not recoverable from the site; user credential provisioning is pending.
- Existing unrelated `supabase/.temp/cli-latest` edit remains untouched.

### Release verification

- Implementation commit `1be9c66462422c6b6a14e49cb84b3dfceea7d773` pushed.
- Cloudflare dashboard still shows Git repository **Connect** (no auto-build
  integration); manually deployed existing generated config. Worker version
  `99c64bc9-a3b9-41b5-beb4-aded61c5f398` serves the updated onboarding interface.
- Majin image `bastet-console-api:1be9c66` is healthy. Compiled bundle hash
  `bf826fb83eb0a51f2c527494ca9d1181a54743ae1d4689d46c43e09ec640ec81`
  matches locally and in `/app/api.cjs`. Startup SQLite backup verified.
- Only the console API service was recreated. Previous release configuration
  is retained in private `release-before-1be9c66.env`; prior image retained.
- Production browser confirms signed-in campaign listing and new private/public
  HackerOne import setup guidance, with import disabled while unconfigured.
- Live checks pass: local debug login and shared campaign reads, authenticated
  integration status; anonymous integration GET/POST 401; direct Majin 401;
  production debug 404; local debug session rejected by production.
- Local dev server restarted on **127.0.0.1:5173** only. Brave blocks local
  navigation with ERR_BLOCKED_BY_CLIENT; no browser protection was bypassed.
  Local HTTP/API checks pass; rendered production browser and synthetic local
  interaction tests cover the UI pending user's local-browser access.
- Final focused suite: 30 HackerOne tests including archived-asset regression;
  initial full suite 45 passed plus the added UI test; all typechecks pass.
- Credential gate remains: personal tokens cannot be revealed again; rotating
  requires user action. Prepared ignored mode-600 `.env.hackerone.local` for
  private provisioning. No token installed and no real program imported yet.

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

## 2026-10-07 — Stack inventory and release research

- Added the isolated PostgreSQL `inventory` schema: explicit deployments/assets,
  component identities and releases, append-only fingerprints/advisory revisions/
  assessment history/reviews/events, scoped worker tokens, and leased research
  jobs. No public bounty/Buzz schema changes or live target probes.
- Added portfolio inventory UI, release counts, version history, conservative OSV
  matching, review invalidation, change alerts, scoped event feed, recon JSONL
  importer, and a source-research supervisor with a configurable harness contract.
  The existing external swarm launcher's source is unavailable; no claim is made
  that its agents have been connected or launched.
- OSV polling is five minutes between completed passes, with 15-second UI refresh.
  Public package lookup is explicit. Unknown/stale/conflicting observations remain
  triage leads; version matches never automatically become confirmed findings.
- Validation: typecheck; 102 passing tests (two existing external-PG tests skipped
  without a disposable server); 13 focused inventory checks using PGlite PostgreSQL,
  actual HTTP requests and a synthetic harness process; 6 SQLite tests (one
  D1-specific test skipped); 12 migration checks; production frontend/API builds;
  built Worker HTTP suite; desktop/mobile Chromium rendering and research form
  submission. History pagination covers sub-millisecond PostgreSQL timestamps.
- Production dependency audit reports 12 high findings. A fresh audit of the
  unchanged main-branch lockfile reports the same 12 packages; none were introduced
  by this feature. Existing audit/Socket gates remain enabled.
- Production activation is **not performed**: this workspace has no Majin SSH/DB
  credentials or Cloudflare deployment identity. Migration, worker configuration,
  backup/preflight, activation and rollback are documented in `docs/inventory.md`.
  A real research-harness executable/model identity must also be provisioned before
  research jobs can execute. Source publication is recorded by this Git commit;
  production image/Worker identifiers must be added only after an observed rollout.

## 2026-10-07 — Majin stack-inventory production activation

- Deployed source `ffb692e6e873ac76a136912a6f4b22790a592ec8` using Node
  24.21.0 for validation/packaging. Passed `npm ci`, typecheck, 102 tests
  (2 external-PG skips), 12 migration tests, 6 SQLite tests (1 D1 skip),
  production frontend build and built Worker HTTP test. `npm ci` reported
  48 dependency vulnerabilities (7 moderate, 41 high); no dependency changes.
- Before migration, the existing Majin native backup script reported
  `console_postgres_backup_verified`, archive-list validation true, full restore
  false. Database and role dump SHA-256 checks both returned OK for stamp
  `20261007T221812.738639877Z` in
  `/home/pierce/bastet-console-data/postgres-backups`; manifest mode was 600.
  No full restore drill or new off-host copy was performed in this session.
  Existing PostgreSQL/SQLite/D1 recovery material remains retained.
- Migration ran only through `npm run inventory:migrate`, using a protected
  on-host environment and the verified CA on `bastet-console-db`. It reported
  `inventory_migration_applied`, version 1. Observed schema owner is
  `console_owner`, with all 18 inventory tables owned by that NOLOGIN role.
  Temporary `console_migrator` membership and owner CREATE privilege were revoked;
  login is disabled and its password is NULL. Runtime schema USAGE/sequence
  privileges passed; schema CREATE is denied. Append-only tables have only
  INSERT/SELECT, and schema_version only SELECT. Public (7 tables) and console
  (10 tables) lists compared identical before/after. No bounty/Buzz DDL or drops.
- Initial migration container could not read owner-only source files and exited
  before executing the runner. Confirmed inventory absent and temporary grants
  revoked, then used UID 1000 and reran successfully. All credentials remained
  in mode-600 on-host files; worker inventory.env contains only its database URL
  and CA path, with no user/service/debug/Google/HackerOne credentials.
- Protected build context was `tmp/api-build-j5eqD8`; only that context was
  transported and used for Docker build. Immutable image
  `bastet-console-api:pg-aa31b4426c56` has API SHA-256
  `d0a651d6861a1e2a2ab8aacedee3afcee426ae39160825bd9a5495c5597c674c`
  and synchronizer SHA-256
  `325d7b77774ec72f29e36df195c95e6ec9fd7f6d33171e3d5d85e07eb5989d27`;
  both matched the live container. Runtime remains pinned Node 24.19.0.
  Release manifest is retained on Majin in
  `/home/pierce/bastet-console-inventory-context-20261007/release.json`.
  Build dirtyTree=true reflected the unrelated untracked
  `docs/DEPLOY-BRIEF-2026-10-07.md`, which was not packaged or staged.
- Isolated preflight had no published ports, was healthy, and returned 200 for
  health, auth verification and authenticated campaign reads. Inventory GET
  returned configured=false before migration and true afterward. Preflight
  was stopped after activation. Live `bastet-console-api-1` is running/healthy;
  `bastet-console-inventory-sync-1` is running with zero restarts, both using
  `pg-aa31b4426c56`, with no published ports. The synchronizer has no Docker
  healthcheck; its observed database worker-health record is healthy.
- Required Compose correction: the database network is internal=true, and OSV
  egress initially failed. Added a separate `inventory_egress` network only to
  inventory-sync; retained internal DB isolation. Observed OSV query HTTP 200,
  `inventory_sync_completed`, and worker health `1 package queries; 0 failures`
  with a recorded success time. Compose configuration validation passed.
  Activation uses the reviewed template at
  `/home/pierce/bastet-console-inventory-source-20261007/deploy/compose.yml`
  with `--env-file /home/pierce/gitops-secrets/console/.env --profile inventory`.
  An initial attempt to merge both full templates failed Compose validation
  before changing traffic; activation then used the single updated template.
- Live authenticated HTTPS checks through Majin/Caddy returned 200 for health,
  campaigns and inventory (configured=true); anonymous inventory returned 401.
  Synthetic private campaign `5aa95578-f4e8-42bd-ba0a-a0d6d8bf131f` used only
  example.test fixture URLs and public npm/next package identity. Fingerprint
  replay returned the same ID without extra events; history contained one record;
  conflicting replay returned 409. OSV produced 73 assessments including
  affected_version. Research claim and synthetic inconclusive completion passed,
  with no harness/source analysis or live-target testing. The campaign is archived
  and both synthetic worker tokens are revoked. A verification GET hit an idle
  socket closure after synchronous OSV processing; a fresh-connection continuation
  passed while live API health remained healthy.
- Contract discrepancy: the revoked research token is denied with HTTP **403**,
  not the requested **401**. Observed denial matches this release's capability
  verifier; no application-code fix was made during deployment.
- Cloudflare frontend was **not deployed**: local `npx wrangler whoami` reported
  "You are not authenticated." No login, temporary account or deploy was attempted.
  Hosted /inventory UI and signed-in frontend campaign isolation were not verified.
  Research harness/model identity and recon mappings were not provisioned.
- Rollback ready: prior image `bastet-console-api:pg-f0dfc425387b` remains available
  (image ID `sha256:a37e741e0f926bca19f023250b7d11fe6fb0a34c2249fe4b6c83a45db403df74`).
  Prior release env is preserved at
  `/home/pierce/gitops-secrets/console/release-before-inventory-20261007.env`.
  Stop inventory-sync using the inventory template, restore that protected release
  env to .env, then run the original GitOps console Compose `up -d api`.
  Retain inventory evidence/schema; never revert PostgreSQL to SQLite/D1.
