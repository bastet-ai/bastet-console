// Owner-operated, idempotent imports through the local credential-holding API.
// The receipt is private operational metadata, never a wiki publication input.
import assert from 'node:assert/strict'
import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function validateEntries(entries) {
  assert.ok(Array.isArray(entries) && entries.length > 0 && entries.length <= 30, 'Invalid entry count')
  const handles = new Set()
  return entries.map(entry => {
    assert.match(entry.handle, /^[a-z0-9][a-z0-9_-]{0,63}$/)
    assert.match(entry.wikiSlug, /^[a-z0-9][a-z0-9_-]{0,63}$/)
    assert.ok(!handles.has(entry.handle), 'Duplicate program handle')
    handles.add(entry.handle)
    return { handle: entry.handle, wikiSlug: entry.wikiSlug }
  })
}

export async function onboard(entries, request, record = async () => {}) {
  const results = []
  for (const entry of validateEntries(entries)) {
    try {
      const inventory = await request('/api/campaigns')
      const existing = inventory.campaigns.filter(c => c.hackerone_handle === entry.handle)
      assert.ok(existing.length <= 1, 'Duplicate existing campaigns require review')
      let campaign, created = false
      if (existing.length) {
        campaign = (await request(`/api/campaigns/${existing[0].id}`)).campaign
        assert.ok(campaign.hackerone_metadata?.scope_snapshot?.sha256, 'Existing campaign lacks a verified snapshot')
      } else {
        const preview = await request('/api/integrations/hackerone', { programHandle: entry.handle })
        assert.equal(preview.campaign?.hackerone_handle, entry.handle)
        const digest = preview.campaign.hackerone_metadata?.scope_snapshot?.sha256
        assert.match(digest, /^[a-f0-9]{64}$/)
        const response = await request('/api/campaigns', {
          hackerone_handle: entry.handle,
          hackerone_metadata: { scope_snapshot: { sha256: digest } },
        })
        campaign = response.campaign
        assert.equal(campaign.hackerone_handle, entry.handle)
        assert.equal(campaign.hackerone_metadata?.scope_snapshot?.sha256, digest)
        assert.equal(campaign.privacy, 'private')
        assert.equal(campaign.status, 'paused')
        campaign = (await request(`/api/campaigns/${campaign.id}`)).campaign
        assert.equal(campaign.hackerone_metadata?.scope_snapshot?.sha256, digest)
        created = true
      }
      const metadata = campaign.hackerone_metadata
      const result = { ...entry, campaignId: campaign.id, result: created ? 'created' : 'existing',
        privacy: campaign.privacy, status: campaign.status, programState: metadata.state,
        scopeHash: metadata.scope_snapshot.sha256, scopeCount: metadata.scope_snapshot.assets.length,
        fetchedAt: metadata.scope_snapshot.fetched_at,
        // This is only a preliminary gate. Anonymous publication proof is separate.
        publicStateCandidate: metadata.state === 'public_mode' }
      results.push(result)
      await record(results)
    } catch {
      // A timeout after create may have committed. Never retry the POST blindly:
      // a new invocation inventories exact handles before attempting creation.
      results.push({ ...entry, result: 'held', reason: 'Import incomplete; inspect exact handle before retrying' })
      await record(results)
    }
  }
  return results
}

async function main() {
  const [entriesPath, receiptPath] = process.argv.slice(2)
  assert.ok(entriesPath && receiptPath && process.argv.length === 4, 'Pass entry-list and private receipt paths')
  const entries = JSON.parse(await readFile(entriesPath, 'utf8'))
  const target = resolve(receiptPath)
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  const receipt = await open(target, 'wx', 0o600)
  try {
    assert.ok(process.env.CONSOLE_SERVICE_KEY && process.env.CONSOLE_DEBUG_KEY, 'Protected local API environment required')
    const request = async (path, body) => {
      assert.ok(path.startsWith('/api/'))
      const response = await fetch('http://127.0.0.1:3000' + path, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(35000),
        headers: { 'Content-Type': 'application/json', 'x-console-service-key': process.env.CONSOLE_SERVICE_KEY,
          'x-console-debug-key': process.env.CONSOLE_DEBUG_KEY },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      assert.ok(response.ok, 'Local API request failed')
      return response.json()
    }
    const results = await onboard(entries, request, async results => {
      const data = JSON.stringify({ schema: 1, checkedAt: new Date().toISOString(), campaigns: results }, null, 2)
      await receipt.truncate(0); await receipt.write(data, 0, 'utf8'); await receipt.sync()
      const latest = results.at(-1)
      console.log(JSON.stringify({ handle: latest.handle, result: latest.result, programState: latest.programState,
        scopeCount: latest.scopeCount, privacy: latest.privacy, status: latest.status }))
    })
    if (results.some(r => r.result === 'held')) process.exitCode = 2
  } finally { await receipt.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Wiki campaign onboarding failed; no private response logged'); process.exitCode = 1 })
}
