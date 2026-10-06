// Reproducible Node API packaging. No environment/credential files are read or
// included. The resulting Docker context contains only explicitly copied assets.
import { build, version as esbuildVersion } from 'esbuild'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

process.umask(0o077)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const temporary = join(root, 'tmp')
mkdirSync(temporary, { recursive: true, mode: 0o700 })
const context = mkdtempSync(join(temporary, 'api-build-'))
await build({
  absWorkingDir: root, entryPoints: ['scripts/serve-api.ts'], outfile: join(context, 'api.cjs'),
  bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['pg-native'], logLevel: 'warning',
})
copyFileSync(join(root, 'deploy/Dockerfile.api'), join(context, 'Dockerfile'))
copyFileSync(join(root, 'deploy/.dockerignore.api'), join(context, '.dockerignore'))
for (const name of ['api.cjs', 'Dockerfile', '.dockerignore']) chmodSync(join(context, name), 0o444)
const bundle = readFileSync(join(context, 'api.cjs')), dockerfile = readFileSync(join(context, 'Dockerfile'))
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const manifest = {
  schema: 1, release: `pg-${createHash('sha256').update(bundle).update(dockerfile).digest('hex').slice(0, 12)}`,
  bundleSha256: sha256(bundle), dockerfileSha256: sha256(dockerfile), sourceCommit: git(['rev-parse', 'HEAD']),
  dirtyTree: Boolean(git(['status', '--porcelain'])), esbuildVersion, runtime: 'node24', format: 'cjs',
}
writeFileSync(join(context, 'release.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 })
console.log(JSON.stringify({ context, ...manifest }))
