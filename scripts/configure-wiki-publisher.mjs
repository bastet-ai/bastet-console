// Trusted workstation setup. Never prints credential-bearing configuration.
import assert from 'node:assert/strict'
import { readFile, mkdir, open, lstat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const receipt = JSON.parse(await readFile(process.argv[2], 'utf8'))
assert.equal(receipt.version, 1)
assert.equal(receipt.campaigns.length, 16)
const directory = '/home/pierce/.config/bastet-wiki'
await mkdir(directory, { recursive: true, mode: 0o700 })
const stat = await lstat(directory)
assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077))
const raw = execFileSync('ssh', ['-o', 'BatchMode=yes', 'majin.x43.io',
  'cat /home/pierce/gitops-secrets/bastet-wiki/publisher-credentials.json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 })
const credential = JSON.parse(raw)
assert.equal(credential.username, 'bastet_wiki_publisher_local')
assert.match(credential.password, /^[A-Za-z0-9_-]{40,}$/)
assert.equal(credential.database, 'bounty')
const config = {
  repositoryPath: '/home/pierce/projects/bastet-targets',
  stateDirectory: '/home/pierce/.local/state/bastet-wiki',
  databaseTransport: 'ssh-loopback',
  databaseUrl: `postgresql://${credential.username}:${credential.password}@127.0.0.1:6544/bounty?sslmode=disable`,
  campaigns: receipt.campaigns.map(({ campaignId, handle }) => ({ campaignId, handle })),
}
const file = await open(directory + '/publisher.json', 'wx', 0o600)
try { await file.writeFile(JSON.stringify(config, null, 2)); await file.sync() }
finally { await file.close() }
console.log(JSON.stringify({ configured: config.campaigns.length, credentialExpires: credential.deadline }))
