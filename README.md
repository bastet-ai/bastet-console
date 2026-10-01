# Bastet Console

The Bastet management console runs on Cloudflare Workers with vinext (Pages Router)
and D1. Google OAuth is exchanged by the Worker; it does not use Supabase Auth.

## Development

Use Node.js 24 and the checked-in npm lockfile.

```sh
npm ci
cp .env.example .env.local
npm run db:migrate:local
npm run dev
```

Set the example values for your own Google OAuth development client. Register the
exact local URL with Google. Never commit `.env.local` or `.dev.vars`.

```sh
npm test
npm run typecheck
npm run build
npm run test:worker
npm start
```

`npm test` exercises D1 SQL, transaction rollback, tenant isolation, membership
permissions, and JWT compatibility against a local Workers runtime. Additional
HTTP validation is documented in [the migration runbook](docs/cloudflare-migration.md).

## Deployment

Worker: `bastet-console`. D1 binding: `DB`. Configuration: `wrangler.jsonc`.
Set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` during the build. Set runtime credentials with
`wrangler secret put`, never in source or command-line arguments:

| Setting | Location |
| --- | --- |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Build environment, public OAuth client ID |
| `GOOGLE_CLIENT_ID` | Worker environment; same OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Worker secret |
| `JWT_SECRET` | Worker secret; preserve it to keep existing sessions valid |
| `NEXTAUTH_URL` | Worker variable, `https://console.bastet.ai` |
| `DB` | D1 database binding |

```sh
npm run db:migrate:remote
npm run build
npm run deploy
```

Do not apply a production data import to a database receiving writes. See the
runbook for migration, verification, rollback, and automatic Git deployment setup.

The legacy WebSocket endpoint was never a functioning socket server. It now
returns an explicit 501. Persistent node connections require a separately designed
Durable Object implementation; they are not simulated by per-isolate memory.
