# Stack inventory and release research

The console's `/inventory` page groups observed software by component and release
across accessible campaigns. Its additive PostgreSQL `inventory` schema keeps
private deployment evidence separate from public package/advisory identities.
Existing bounty tables, scope snapshots, and the external swarm controller remain
unchanged. The inventory records evidence; scope membership is not inferred from
an asset being present here and does not authorize probing it.

## Data and events

| Record | Producer | Consumer |
| --- | --- | --- |
| Deployment + assets | Campaign contributor or ingest worker; grouping is explicit | Recon importer, inventory UI, matcher |
| Fingerprint | Recon importer, package manifest/SBOM adapter, investigator | Current projection, history, matcher |
| Component + release | Normalized fingerprint ingestion | Cohort counts, advisory matching, research |
| Advisory revision | Trusted OSV synchronizer | Matcher and retained audit history |
| Assessment + history | Matcher on fingerprint or advisory change; periodic freshness pass | Triage UI and event consumers |
| Exploitability review | Campaign owner/manager with supporting evidence | UI; valid only while effective inputs remain unchanged |
| Research task/attempt/result | Owner/manager queues; scoped worker claims and completes | Release research UI and future campaign investigations |
| Event | Same transaction as each state transition | UI alerts and campaign event feed |

URLs include HTTP, HTTPS, WS and WSS; WebSocket URLs have `subtype=websocket`.
An app's related endpoints can share a deployment, but matching IP, domain, CDN,
or technology never automatically merges deployments. Asset URLs omit credentials,
queries and fragments. Put essential sensitive request details in private evidence.

Fingerprints preserve exact version **or** estimated range **or** unknown, method,
source key, confidence, configuration, observation/receipt times, server-recorded
user and worker identity, and evidence. Supply artifact hashes, source revisions,
request references, detector version and relevant feature flags in evidence or
configuration. Every refresh is append-only. The current projection selects the
latest observation time independently for each source; late delivery cannot roll
it back. A missed detection does not remove software. Explicit negative evidence
requires `presence=absent` and `explicit_absence=true`.

`event_key` is idempotent within a campaign: identical input replays successfully;
different input using the same key returns 409. `component.changed` records the
last old and first new observation boundaries, not a fabricated exact change time.
Repeated unchanged observations preserve reviews, while changes to version,
configuration, source, confidence, freshness, conflicts or advisory revision
invalidate them. Retained evidence also prevents deleting its campaign; archive it.

## Advisory coverage and freshness

The trusted synchronizer queries OSV for supported package ecosystems only when
the current fingerprint explicitly has `allow_advisory_lookup=true`. Set this
only for public package identities. Private names and generic product labels must
leave it false. No deployment IDs, assets, scope, credentials or evidence go to OSV.
The httpx importer enables lookup only for its explicit Next.js → npm/next,
React → npm/react and Express → npm/express mappings. Other labels remain Product
fingerprints. Unsupported ecosystems remain visible without a coverage claim.

The worker runs immediately, then waits five minutes between completed passes.
This is near-real-time polling, not an instantaneous upstream notification. New
fingerprints match stored advisories in their ingestion transaction. New/corrected
advisories re-evaluate all linked deployments, including previously linked packages
removed by a correction. Known IDs refresh independently to detect withdrawals.
Failed fetches retain previous knowledge and mark sync health degraded. The UI
refreshes every 15 seconds and shows stale sync health after 15 minutes.

The matcher handles explicit affected versions and OSV SEMVER intervals, including
multiple branches, fixed/last-affected/limit endpoints and prereleases. npm
ECOSYSTEM ranges use SemVer; other range schemes remain `possible` unless an exact
version is explicitly listed. Unknown/estimated, conflicting, low-confidence
(below 0.9), or observations older than seven days require investigation.
`affected_version` means a version match, **not confirmed application exploitability**.
Backports, configuration, reachability and prerequisites need a separate review.
Aliases remain on the source advisory; counts are not deduplicated CVE counts.
No automatic EOL policy or “latest version” claim is inferred from OSV.

## API and worker access

Use the existing public console endpoint `https://console.bastet.ai/api/inventory`.
The proxy supplies the service key. Agents receive only `Authorization: Bearer
binv_…`, scoped to one campaign and selected capabilities, with 1–90 day expiry.
They never receive a database login, console service/debug key, user JWT, or
HackerOne credential. Token authority is rechecked against its creator's current
owner/manager membership. Revocation takes effect on the next request.

All POST bodies include `action` and `campaign_id`:

| Action | Required authority | Additional fields |
| --- | --- | --- |
| deployment | contributor / ingest | name, environment, assets: [{kind,value}] |
| fingerprint | contributor / ingest | deployment_id, ecosystem, name, version or version_range, observed_at, source_key, method, confidence, evidence, event_key; optional configuration, presence, explicit_absence, allow_advisory_lookup |
| research | owner/manager session | release_id, hypothesis, HTTPS source_url, full immutable source_revision, budget_minutes |
| claim | research worker | none; returns a leased task or null |
| heartbeat / complete / fail | research worker | task_id, attempt, lease_token; result for completion/failure |
| cancel | owner/manager session | task_id |
| review | owner/manager session | assessment_id, current input_hash, verdict, reason, evidence |
| issue_token / revoke_token | owner/manager session | name/capabilities/expires_in_days, or token_id |
| acknowledge | campaign user session | event_id |

GET views: default portfolio overview (user session); `view=events&campaign_id=…`
with `after` cursor; `view=history&campaign_id=…&deployment_id=…` with optional
`kind=assessments` and opaque `before` cursor; `view=tokens&campaign_id=…` for
owners/managers. Event consumers durably store `next_cursor` only after processing
the returned events, and handle repeated delivery idempotently. Drain pages while
`has_more` is true. Writes serialize on a transaction advisory lock so event IDs
cannot be skipped due to out-of-order commits. This trades write throughput for
correct cursors on the initial single-host deployment.

Events: `deployment.created`, `fingerprint.recorded`, `component.changed`,
`assessment.changed`, `assessment.reviewed`, `research.ready`, `research.started`,
`research.completed`, `research.failed`, `research.cancelled`. All are campaign-scoped.
Overview collections are capped at 2,000 with explicit truncation indicators;
research jobs show the latest 200 and alerts the latest 100. Fingerprint/assessment
history has full keyset pagination. There is no external email/Slack notification.

## Import existing recon

The importer reads the durable JSONL emitted by `bastet-bounty-plan/workers/run_recon.py`.
It does not run probes or alter the existing runner's scope gates. Create deployments
using the ingest API, then create a protected map of canonical endpoint URL →
deployment ID. A synthetic example:

```json
{"https://app.example.test/":"DEPLOYMENT_ID"}
```

Provision `INVENTORY_API_URL`, `INVENTORY_CAMPAIGN_ID`, and an ingest-only
`INVENTORY_WORKER_TOKEN` in an owner-only environment file, then run:

```sh
npm run inventory:import-recon -- /private/run.jsonl /private/deployment-map.json
```

Non-httpx records are skipped. Missing mappings or malformed input stop with the
line number. Replay the retained file after correction: event hashes prevent
duplicates. Preserve each run's JSONL in protected storage. Technology labels with
no version stay unknown; httpx confidence is 0.7, so version guesses are triage
leads. The importer retains tool version, exact observation hash and the runner's
scope proof (a Git **blob hash**, not a scope approval or repository commit).

## Research worker and harness contract

Research targets a component release and pinned repository commit. Tasks do not
contain private asset URLs. No available repository exposes the existing swarm
launcher's source/API; this release supplies a separate HTTP worker adapter rather
than claiming those controller agents are already integrated.

Configure a trusted executable in a mode-600 JSON file:

```json
{"command":"/opt/bastet/bin/appsec-harness","args":[],"env":{"HOME":"/var/lib/bastet-research"}}
```

The supervisor appends absolute `task.json` and `result.json` paths to that fixed
argv and launches with `shell:false`. It supplies only the configured environment,
not its control token/lease or ambient service credentials. The executable is the
adapter for your chosen standard harness (for example your existing code-review
agent); it must fetch and verify the exact source commit, run source-only analysis
in its sandbox, and write a JSON result with `summary`, `source_revision`, and
`outcome` (`candidate`, `negative`, `inconclusive`), plus evidence/artifact references.
The supervisor requires the source attestation to match before publishing.

Provision a research-only token plus `INVENTORY_API_URL`, `INVENTORY_CAMPAIGN_ID`,
`INVENTORY_HARNESS_CONFIG`, and `INVENTORY_RESEARCH_DIR` in a protected environment,
then run `npm run inventory:research -- --watch`. Run under a dedicated OS identity
and a sandbox appropriate for untrusted source; this supervisor is not a security
sandbox. Do not give the harness access to the supervisor's environment file.
No harness/model credential is installed automatically.

Jobs show queued until claimed. Leases last five minutes, renew every minute,
and fence old attempts from publishing after reassignment. Lost heartbeats or
cancelled tasks stop the local process group; cancellation is observed on the next
heartbeat. A wall-time budget (1–240 minutes **per attempt**) kills the process group.
Three attempts are permitted after lease loss; explicit failure is terminal.
Execution is at-least-once, not exactly-once. Run artifacts remain in the protected
research directory for recovery; operators must manage retention. Completed
research is a release-level lead and requires app-specific validation before a
target finding. Workers neither submit bounty reports nor receive live-target tasks.

## Deployment and rollback

1. Take and verify the existing native PostgreSQL backup; include both `console`
   and `inventory` plus roles in subsequent restores. Existing backup scripts dump
   the full database. Keep off-host backups and existing recovery snapshots.
2. Use the established migration-owner procedure from `postgres-backend.md`.
   Run `npm run inventory:migrate` with `INVENTORY_MIGRATION_DATABASE_URL` and
   optional `INVENTORY_POSTGRES_CA_FILE` in a protected environment. The migration
   is transactional, refuses existing/partial schema, changes no public bounty
   tables, and grants the existing `console_api` role access only to the additive
   schema. It never runs automatically during API startup. Ensure ownership stays
   with the established NOLOGIN schema owner, not the API or a temporary login.
   The runner uses SET ROLE console_owner; temporarily provision the migration
   login membership and schema-creation privilege, then revoke them after success.
3. Run the validation commands below, commit source, and run `npm run build:api`.
   Its protected context includes API + synchronizer bundles, exact hashes and a
   content-derived release tag. Build the Docker image using that context only.
4. Deploy the API using the existing isolated health/auth preflight and Compose
   procedure. Preserve the previous PG image. Before migration, the new UI/API
   reports inventory unavailable without affecting existing console operations.
5. Provision `/home/pierce/gitops-secrets/console/inventory.env` mode 600 with
   `INVENTORY_DATABASE_URL` (trusted host `console_api` identity) and verified
   `INVENTORY_POSTGRES_CA_FILE=/run/console-postgres/ca.crt`. Do not copy user,
   Google, HackerOne, service or debug secrets into this worker. Activate the
   optional service with `docker compose --profile inventory up -d api inventory-sync`.
   Verify outbound access to api.osv.dev, worker health and a successful sync.
6. Build and deploy the Cloudflare frontend through the existing Wrangler setup;
   verify signed-in campaign isolation and `/inventory`. Provision recon mappings
   and the research harness/token separately. The research worker can run on an
   isolated workstation/node without Majin database credentials.
7. Verify one synthetic campaign end to end: fingerprint, history, advisory match,
   event replay, research claim/complete and token revocation. Archive retained
   evidence instead of deleting it. Record production image/Worker IDs and checks
   in `NOTES.md` only after observing them.

Rollback: stop the inventory synchronizer/research workers and restore the prior
PostgreSQL-capable API/Worker release. Retain the additive schema and all new
evidence; do not drop it or fall back to frozen SQLite/D1. No automated destructive
down migration exists. A prior API may return an error when deleting an inventory
campaign because the evidence foreign key still protects it.

Validation: `npm run typecheck`, `npm test`, `npm run test:sqlite`,
`npm run test:migration`, `npm run build`, `npm run test:worker`,
`npm run build:api`. With Playwright Chromium installed,
`npm run test:inventory-ui` verifies desktop/mobile rendering and research submission
against a synthetic API fixture. Inventory tests run PostgreSQL SQL in PGlite and exercise
the actual HTTP handler, tenant boundaries, immutable evidence, conservative
matching, advisory corrections/withdrawals, leases, recon replay and a synthetic
harness subprocess. They do not probe live targets or require private fixtures.
