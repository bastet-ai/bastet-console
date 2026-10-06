// Operator-only bridge: private import receipts identify campaigns, but only a
// new anonymous HackerOne read supplies content to the public wiki pipeline.
import assert from 'node:assert/strict'
import { readFile, open } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [modulePath, outputPath, ...receiptPaths] = process.argv.slice(2)
assert.ok(modulePath && outputPath && receiptPaths.length, 'Pass public-source module, private output, and receipts')
const { fetchPublicSource, validatePublicSource } = await import(pathToFileURL(resolve(modulePath)))
const entries = []
for (const path of receiptPaths) {
  const receipt = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(receipt.schema, 1)
  entries.push(...receipt.campaigns.filter(c => ['created', 'existing'].includes(c.result) && c.publicStateCandidate))
}
assert.ok(entries.length && entries.length <= 21)
assert.equal(new Set(entries.map(e => e.campaignId)).size, entries.length)
const campaigns = []
for (const entry of entries) {
  assert.match(entry.campaignId, /^[a-f0-9-]{36}$/)
  assert.match(entry.wikiSlug, /^[a-z0-9][a-z0-9_-]{0,63}$/)
  const source = await fetchPublicSource(entry.handle)
  validatePublicSource(source, { expectedHandle: entry.handle })
  campaigns.push({ consoleCampaignId: entry.campaignId, handle: entry.handle,
    wikiPath: `docs/programs/${entry.wikiSlug}/public-scope.md`, source })
  console.log(JSON.stringify({ handle: entry.handle, publicAssets: source.assets.length }))
}
const file = await open(resolve(outputPath), 'wx', 0o600)
try { await file.writeFile(JSON.stringify({ version: 1, campaigns })); await file.sync() }
finally { await file.close() }
console.log(JSON.stringify({ prepared: campaigns.length }))
