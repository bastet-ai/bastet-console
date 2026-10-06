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
