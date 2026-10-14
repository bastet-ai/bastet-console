// Records unresolved curated wiki entries without inventing verified H1 linkage.
import assert from 'node:assert/strict'
import { open } from 'node:fs/promises'
const entries = ['akamai', 'airlock', 'atlassian']
assert.ok(process.env.CONSOLE_SERVICE_KEY && process.env.CONSOLE_DEBUG_KEY)
const receipt = await open(process.argv[2], 'wx', 0o600)
const request = async (path, body) => {
  const response = await fetch('http://127.0.0.1:3000' + path, {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', 'x-console-service-key': process.env.CONSOLE_SERVICE_KEY,
      'x-console-debug-key': process.env.CONSOLE_DEBUG_KEY },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  assert.ok(response.ok, 'Local API request failed')
  return response.json()
}
const records = []
try {
  for (const handle of entries) {
    const name = `${handle} (scope import pending)`
    const inventory = (await request('/api/campaigns')).campaigns
    const found = inventory.filter(c => c.name === name || c.hackerone_handle === handle)
    assert.ok(found.length <= 1, 'Duplicate campaigns require review')
    const campaign = found[0] ?? (await request('/api/campaigns', {
      name, privacy: 'private', status: 'paused',
      description: `Curated targets wiki entry: https://hackerone.com/${handle}. Onboarding is held because the API did not provide a usable policy and scope. No wiki worker or testing is enabled.`,
      scope: 'UNVERIFIED: No executable scope is approved. Import a complete, current HackerOne policy and structured scope before activating research or public wiki publication.',
    })).campaign
    assert.equal(campaign.privacy, 'private'); assert.equal(campaign.status, 'paused')
    assert.ok(!campaign.hackerone_metadata?.scope_snapshot, 'Existing imported campaign requires review')
    records.push({ handle, campaignId: campaign.id, status: 'paused', importStatus: 'pending', verified: false })
    await receipt.truncate(0); await receipt.write(JSON.stringify({ schema: 1, campaigns: records }, null, 2), 0, 'utf8'); await receipt.sync()
    console.log(JSON.stringify({ handle, campaign: 'registered', scope: 'unverified', status: 'paused' }))
  }
} finally { await receipt.close() }
