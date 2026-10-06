// Read-only release smoke check. Load credentials through a protected env file;
// never print tokens, user records, scope/policy text, reports or raw responses.
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'

const [campaignId] = process.argv.slice(2)
try {
  assert.match(campaignId || '', /^[a-f0-9-]{36}$/i, 'Pass a campaign UUID')
  for (const key of ['CONSOLE_SERVICE_KEY', 'CONSOLE_DEBUG_KEY', 'CONSOLE_DEBUG_USER_ID', 'JWT_SECRET']) assert.ok(process.env[key], 'Protected API environment required')
  const bearer = `Bearer ${jwt.sign({ userId: process.env.CONSOLE_DEBUG_USER_ID }, process.env.JWT_SECRET, { expiresIn: '2m' })}`
  const sources = [
    { name: 'local', origin: 'http://127.0.0.1:3000', headers: { 'x-console-service-key': process.env.CONSOLE_SERVICE_KEY, 'x-console-debug-key': process.env.CONSOLE_DEBUG_KEY } },
    { name: 'hosted', origin: 'https://console.bastet.ai', headers: { Authorization: bearer } },
    { name: 'majin', origin: 'https://majin.x43.io/bastet-console', headers: { Authorization: bearer, 'x-console-service-key': process.env.CONSOLE_SERVICE_KEY } },
  ]
  const checked = await Promise.all(sources.map(async source => {
    const request = async path => {
      const response = await fetch(source.origin + path, { headers: source.headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) })
      assert.equal(response.status, 200, `${source.name} request failed`)
      return response.json()
    }
    const [{ campaign }, progress] = await Promise.all([
      request(`/api/campaigns/${campaignId}`), request(`/api/campaigns/${campaignId}/progress`),
    ])
    assert.equal(campaign.id, campaignId)
    return {
      source: source.name, campaignId: campaign.id, status: campaign.status, privacy: campaign.privacy,
      snapshotDigest: campaign.hackerone_metadata?.scope_snapshot?.sha256 ?? null,
      configured: progress.configured, runId: progress.progress?.run_id ?? null,
      runStatus: progress.progress?.status ?? null, agents: progress.progress?.agents?.length ?? 0,
      tasks: progress.progress?.tasks?.length ?? 0, reports: progress.progress?.reports?.length ?? 0,
    }
  }))
  const first = checked[0]
  for (const result of checked) {
    assert.equal(result.snapshotDigest, first.snapshotDigest, 'Saved snapshot differs between endpoints')
    assert.equal(result.status, first.status, 'Campaign status differs between endpoints')
    assert.equal(result.runId, first.runId, 'Linked run differs between endpoints')
  }
  console.log(JSON.stringify({ verified: true, checked }))
} catch {
  console.error(JSON.stringify({ event: 'console_live_read_check_failed', noPrivateDataLogged: true }))
  process.exitCode = 1
}
