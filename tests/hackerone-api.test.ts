import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, test } from 'node:test'
import type { NextApiRequest, NextApiResponse } from 'next'
import jwt from 'jsonwebtoken'
import importProgram from '../pages/api/integrations/hackerone'
import campaigns from '../pages/api/campaigns/index'
import campaign from '../pages/api/campaigns/[id]'
import sync from '../pages/api/campaigns/sync'
import { ConsoleDatabase } from '../src/server/database'
import { requestContext } from '../src/server/runtime'
import { SQLiteDatabase } from '../src/server/sqlite'
import { campaignInput, hackerOneSnapshotDigest } from '../src/server/campaign-validation'

// All programs, accounts, policies and credentials in this file are synthetic.
const environment = ['JWT_SECRET', 'HACKERONE_API_OWNER_ID', 'HACKERONE_API_USERNAME', 'HACKERONE_API_TOKEN'] as const
const originalFetch = globalThis.fetch
let originalEnvironment: Partial<Record<typeof environment[number], string | undefined>>
let storage: SQLiteDatabase
let database: ConsoleDatabase
let upstreamRequests: string[]
let upstreamSignals: AbortSignal[]
let policy: string
let upstreamStatus: number
let programList: unknown[]
const instruction = 'Use only your own test accounts. '.repeat(12) + 'This final restriction must not be truncated.'

beforeEach(() => {
  originalEnvironment = Object.fromEntries(environment.map(name => [name, process.env[name]]))
  process.env.JWT_SECRET = 'synthetic-api-jwt-secret'
  process.env.HACKERONE_API_OWNER_ID = 'owner'
  process.env.HACKERONE_API_USERNAME = 'synthetic-hacker'
  process.env.HACKERONE_API_TOKEN = 'synthetic-upstream-token-not-a-real-credential'
  storage = new SQLiteDatabase(':memory:')
  storage.connection.exec(readFileSync('migrations/0001_console.sql', 'utf8'))
  database = new ConsoleDatabase(storage)
  for (const user of ['owner', 'manager', 'watcher', 'outsider']) {
    storage.connection.prepare('INSERT INTO users (id, google_id, name, email) VALUES (?, ?, ?, ?)')
      .run(user, `google-${user}`, user, `${user}@example.test`)
  }
  upstreamRequests = []
  upstreamSignals = []
  policy = 'Private synthetic policy. No testing of third-party systems. No automated testing is authorized by importing this policy.'
  upstreamStatus = 200
  programList = [{ id: 'program-fixture', type: 'program', attributes: {
    handle: 'synthetic-private', name: 'Synthetic Private Program', policy: 'Do not return full policy in a candidate list.',
  } }]
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
    assert.equal(url.origin, 'https://api.hackerone.com')
    upstreamRequests.push(url.pathname)
    if (init?.signal) upstreamSignals.push(init.signal)
    if (upstreamStatus !== 200) return Response.json({ errors: [{ detail: 'Synthetic provider failure' }] }, { status: upstreamStatus })
    if (url.pathname === '/v1/hackers/programs') return Response.json({ data: programList, links: {} })
    if (url.pathname === '/v1/hackers/programs/synthetic-private') {
      return Response.json({ data: { id: 'program-fixture', type: 'program', attributes: {
        handle: 'synthetic-private', name: 'Synthetic Private Program', about: 'Synthetic application assessment',
        policy, state: 'soft_launched', submission_state: 'open', offers_bounties: true,
      } } })
    }
    if (url.pathname === '/v1/hackers/programs/synthetic-private/structured_scopes') {
      return Response.json({ data: [
        { id: 'scope-allowed', type: 'structured-scope', attributes: {
          asset_identifier: '*.example.test', asset_type: 'WILDCARD', instruction,
          eligible_for_submission: true, eligible_for_bounty: true, max_severity: 'critical',
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', archived_at: null,
        } },
        { id: 'scope-excluded', type: 'structured-scope', attributes: {
          asset_identifier: 'excluded.example.test', asset_type: 'URL', instruction: 'Explicitly excluded from testing.',
          eligible_for_submission: false, eligible_for_bounty: false, max_severity: 'none',
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', archived_at: null,
        } },
      ], links: { next: null } })
    }
    if (url.pathname === '/v1/hackers/programs/synthetic-private/scope_exclusions') {
      return Response.json({ data: [{ id: 'weakness-excluded', type: 'scope-exclusion', attributes: {
        category: 'Availability', details: 'Denial-of-service testing is prohibited.',
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
      } }], links: { next: null } })
    }
    if (/^\/v1\/hackers\/programs\/[a-z0-9_-]+$/.test(url.pathname)) return Response.json({ errors: [{ detail: 'Synthetic handle not found' }] }, { status: 404 })
    throw new Error('Unexpected synthetic upstream request')
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  storage.close()
  for (const name of environment) {
    if (originalEnvironment[name] === undefined) delete process.env[name]
    else process.env[name] = originalEnvironment[name]
  }
})

type Handler = (req: NextApiRequest, res: NextApiResponse) => unknown
async function invoke(handler: Handler, method: string, body?: unknown, userId: string | null = 'owner', query: Record<string, string> = {}) {
  let status = 200
  let result: any
  const headers: Record<string, string> = {}
  const request = {
    method, body, query,
    headers: userId ? { authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET!)}` } : {},
  } as unknown as NextApiRequest
  const response = {
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; return this },
    status(code: number) { status = code; return this },
    json(value: unknown) { result = value; return this },
  } as unknown as NextApiResponse
  await requestContext.run({ database }, () => handler(request, response))
  return { status, body: result, headers }
}

async function preview() {
  const response = await invoke(importProgram, 'POST', { programHandle: 'synthetic-private' })
  assert.equal(response.status, 200)
  return response.body.campaign
}

async function createImported() {
  const imported = await preview()
  const response = await invoke(campaigns, 'POST', {
    hackerone_handle: imported.hackerone_handle,
    hackerone_metadata: { scope_snapshot: { sha256: imported.hackerone_metadata.scope_snapshot.sha256 } },
  })
  assert.equal(response.status, 201)
  return response.body.campaign
}

test('private import and status require user authentication before any upstream request', async () => {
  for (const method of ['GET', 'POST']) {
    const response = await invoke(importProgram, method, { programHandle: 'synthetic-private' }, null)
    assert.equal(response.status, 401)
    assert.equal(response.headers['cache-control'], 'no-store')
  }
  assert.equal(upstreamRequests.length, 0)
})

test('bare upstream program resource previews, saves and re-reads with authoritative private metadata', async () => {
  const wrappedFetch = globalThis.fetch
  globalThis.fetch = (async (input, init) => {
    const response = await wrappedFetch(input, init)
    const url = new URL(String(input))
    if (url.pathname !== '/v1/hackers/programs/synthetic-private') return response
    return Response.json((await response.json() as { data: unknown }).data)
  }) as typeof fetch
  const created = await createImported()
  const result = await invoke(campaign, 'GET', undefined, 'owner', { id: created.id })
  assert.equal(result.status, 200)
  assert.equal(result.body.campaign.privacy, 'private')
  assert.equal(result.body.campaign.status, 'paused')
  assert.equal(result.body.campaign.hackerone_metadata.scope_snapshot.policy, policy)
  assert.equal(result.body.campaign.hackerone_metadata.setup_plan.execution_enabled, false)
  assert.equal(result.body.campaign.hackerone_metadata.setup_plan.scope_sha256, created.hackerone_metadata.scope_snapshot.sha256)
})

test('integration status reveals no credentials and unrelated users cannot use the account credential', async () => {
  const status = await invoke(importProgram, 'GET', undefined, 'outsider')
  assert.deepEqual(status.body, { success: true, configured: true, authorized: false })
  assert.equal(JSON.stringify(status.body).includes(process.env.HACKERONE_API_TOKEN!), false)
  assert.equal((await invoke(importProgram, 'POST', { programHandle: 'synthetic-private' }, 'outsider')).status, 403)
  assert.equal(upstreamRequests.length, 0)
})

test('missing integration configuration fails closed without an upstream request', async () => {
  delete process.env.HACKERONE_API_TOKEN
  const status = await invoke(importProgram, 'GET')
  assert.equal(status.body.configured, false)
  const response = await invoke(importProgram, 'POST', { programHandle: 'synthetic-private' })
  assert.equal(response.status, 503)
  assert.equal(upstreamRequests.length, 0)
})

test('private import previews full policy, scope instructions and exclusions without creating a campaign', async () => {
  const imported = await preview()
  assert.equal(imported.privacy, 'private')
  assert.equal(imported.status, 'paused')
  assert.equal(imported.rulesOfEngagement, policy)
  assert.equal(imported.hackerone_metadata.scope_snapshot.assets.length, 2)
  assert.equal(imported.hackerone_metadata.scope_snapshot.assets[0].instruction, instruction)
  assert.equal(imported.hackerone_metadata.scope_snapshot.assets[1].eligible_for_submission, false)
  assert.equal(imported.hackerone_metadata.scope_snapshot.exclusions[0].details, 'Denial-of-service testing is prohibited.')
  assert.equal(JSON.stringify(imported).includes(process.env.HACKERONE_API_TOKEN!), false)
  assert.deepEqual(await database.campaigns('owner'), [])
})

test('creation re-fetches authoritative metadata and ignores tampered browser fields', async () => {
  const imported = await preview()
  const response = await invoke(campaigns, 'POST', {
    hackerone_handle: 'https://hackerone.com/synthetic-private/policy_scopes',
    name: 'Forged program name', description: 'Forged description', scope: 'out-of-scope.invalid',
    privacy: 'public', status: 'active', hackerone_last_synced: 'Forged timestamp',
    hackerone_metadata: {
      scope_snapshot: { sha256: imported.hackerone_metadata.scope_snapshot.sha256, policy: 'Forged policy', assets: [] },
      verified: true, credential: 'Do not persist client metadata',
      setup_plan: { scope_sha256: 'forged', execution_enabled: true, client_controlled: true },
    },
  })
  assert.equal(response.status, 201)
  const saved = await database.campaign('owner', response.body.campaign.id)
  assert.equal(saved?.name, 'Synthetic Private Program')
  assert.equal(saved?.privacy, 'private')
  assert.equal(saved?.status, 'paused')
  assert.notEqual(saved?.scope, 'out-of-scope.invalid')
  const metadata = saved?.hackerone_metadata
  assert.equal(metadata.scope_snapshot.policy, policy)
  assert.equal(metadata.scope_snapshot.assets.length, 2)
  assert.equal(metadata.verified, undefined)
  assert.equal(metadata.credential, undefined)
  assert.equal(metadata.setup_plan.scope_sha256, metadata.scope_snapshot.sha256)
  assert.equal(metadata.setup_plan.execution_enabled, false)
  assert.equal(metadata.setup_plan.client_controlled, undefined)
  assert.equal(saved?.hackerone_last_synced, metadata.scope_snapshot.fetched_at)
  assert.equal((await invoke(campaign, 'GET', undefined, 'outsider', { id: saved!.id })).status, 403)
})

test('small imported creation payload does not need to send full scope or policy back through the proxy', async () => {
  const created = await createImported()
  assert.equal(created.status, 'paused')
  assert.equal(created.privacy, 'private')
  assert.ok(created.scope.includes('example.test'))
  assert.equal(created.hackerone_metadata.scope_snapshot.policy, policy)
})

test('forged metadata on manual creation is discarded and requested paused state is honored', async () => {
  const response = await invoke(campaigns, 'POST', {
    name: 'Manual fixture', scope: 'example.test', status: 'paused',
    hackerone_metadata: { scope_snapshot: { sha256: 'a'.repeat(64) }, verified: true },
  })
  assert.equal(response.status, 201)
  assert.equal(response.body.campaign.status, 'paused')
  assert.equal(response.body.campaign.hackerone_metadata, null)
  assert.equal(response.body.campaign.hackerone_last_synced, null)
  assert.equal(upstreamRequests.length, 0)
})

test('missing or stale imported digest cannot create a supposedly verified campaign', async () => {
  assert.equal((await invoke(campaigns, 'POST', { hackerone_handle: 'synthetic-private' })).status, 400)
  const imported = await preview()
  policy += ' A newly introduced restriction.'
  const response = await invoke(campaigns, 'POST', {
    hackerone_handle: 'synthetic-private',
    hackerone_metadata: { scope_snapshot: { sha256: imported.hackerone_metadata.scope_snapshot.sha256 } },
  })
  assert.equal(response.status, 409)
  assert.deepEqual(await database.campaigns('owner'), [])
})

test('campaign updates cannot publish private program data or replace authoritative scope', async () => {
  const created = await createImported()
  const metadata = created.hackerone_metadata
  assert.equal((await invoke(campaign, 'PUT', { privacy: 'public' }, 'owner', { id: created.id })).status, 400)
  assert.equal((await invoke(campaign, 'PUT', { scope: 'attacker.invalid' }, 'owner', { id: created.id })).status, 400)
  const response = await invoke(campaign, 'PUT', {
    name: 'Owner label', hackerone_handle: 'attacker', hackerone_metadata: { scope_snapshot: { sha256: 'b'.repeat(64) } },
  }, 'owner', { id: created.id })
  assert.equal(response.status, 200)
  assert.equal(response.body.campaign.hackerone_handle, 'synthetic-private')
  assert.deepEqual(response.body.campaign.hackerone_metadata, metadata)
  assert.equal(response.body.campaign.privacy, 'private')
})

test('sync requires both campaign permissions and integration-owner identity before upstream access', async () => {
  const created = await createImported()
  await database.addMember('owner', created.id, 'manager', 'manager')
  await database.addMember('owner', created.id, 'watcher', 'watcher')
  upstreamRequests.length = 0
  for (const actor of ['manager', 'watcher', 'outsider']) {
    assert.equal((await invoke(sync, 'POST', { campaignId: created.id }, actor)).status, 403)
  }
  assert.equal((await invoke(sync, 'POST', { campaignId: created.id }, null)).status, 401)
  assert.equal(upstreamRequests.length, 0)
})

test('sync preview never mutates the saved campaign and acceptance pins both old and new digests', async () => {
  const created = await createImported()
  await database.updateCampaign('owner', created.id, { status: 'active' })
  const before = await database.campaign('owner', created.id)
  policy += ' New restriction requiring another review.'
  const response = await invoke(sync, 'POST', { campaignId: created.id })
  assert.equal(response.status, 200)
  const review = response.body.preview
  assert.equal(review.changed, true)
  assert.equal(review.policy, policy)
  assert.equal(review.scope_snapshot.assets.length, 2)
  assert.equal(review.previous_sha256, created.hackerone_metadata.scope_snapshot.sha256)
  assert.deepEqual(await database.campaign('owner', created.id), before)
  const accepted = await invoke(sync, 'POST', {
    campaignId: created.id, expectedSha256: review.sha256, previousSha256: review.previous_sha256,
  })
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.campaign.status, 'paused')
  assert.equal(accepted.body.campaign.privacy, 'private')
  assert.equal(accepted.body.campaign.hackerone_metadata.scope_snapshot.policy, policy)
  assert.equal(accepted.body.campaign.hackerone_metadata.previous_sha256, review.previous_sha256)
  assert.equal(accepted.body.campaign.hackerone_metadata.scope_snapshot.sha256, review.sha256)
  assert.equal(accepted.body.campaign.hackerone_metadata.setup_plan.scope_sha256, review.sha256)
  assert.equal(accepted.body.campaign.hackerone_metadata.setup_plan.execution_enabled, false)
  const stale = await invoke(sync, 'POST', {
    campaignId: created.id, expectedSha256: review.sha256, previousSha256: review.previous_sha256,
  })
  assert.equal(stale.status, 409)
})

test('upstream policy changes after preview or upstream failures leave the prior snapshot untouched', async () => {
  const created = await createImported()
  policy += ' First change.'
  const response = await invoke(sync, 'POST', { campaignId: created.id })
  const review = response.body.preview
  const before = await database.campaign('owner', created.id)
  policy += ' Second change.'
  assert.equal((await invoke(sync, 'POST', {
    campaignId: created.id, expectedSha256: review.sha256, previousSha256: review.previous_sha256,
  })).status, 409)
  assert.deepEqual(await database.campaign('owner', created.id), before)
  upstreamStatus = 403
  assert.ok((await invoke(sync, 'POST', { campaignId: created.id })).status >= 400)
  assert.deepEqual(await database.campaign('owner', created.id), before)
})

test('unchanged accepted snapshots refresh without implying new testing authorization', async () => {
  const created = await createImported()
  const response = await invoke(sync, 'POST', { campaignId: created.id })
  const review = response.body.preview
  assert.equal(review.changed, false)
  const accepted = await invoke(sync, 'POST', {
    campaignId: created.id, expectedSha256: review.sha256, previousSha256: review.previous_sha256,
  })
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.campaign.status, 'paused')
  assert.match(accepted.body.message, /no testing was started or authorized/)
})

test('atomic database compare-and-set rejects stale digests and handles legacy missing snapshots', async () => {
  const legacy = await database.createCampaign('owner', { name: 'Legacy fixture', scope: 'example.test', hackerone_handle: 'synthetic-private' })
  const firstDigest = 'a'.repeat(64)
  const secondDigest = 'b'.repeat(64)
  assert.ok(await database.updateCampaign('owner', legacy!.id, { hackerone_metadata: { scope_snapshot: { sha256: firstDigest } } }, null))
  assert.equal(await database.updateCampaign('owner', legacy!.id, { scope: 'stale.invalid' }, null), null)
  assert.ok(await database.updateCampaign('owner', legacy!.id, { hackerone_metadata: { scope_snapshot: { sha256: secondDigest } } }, firstDigest))
  assert.equal(await database.updateCampaign('owner', legacy!.id, { scope: 'stale.invalid' }, firstDigest), null)
  assert.equal((await database.campaign('owner', legacy!.id))?.scope, 'example.test')
  assert.equal(await database.updateCampaign('outsider', legacy!.id, { scope: 'outside.invalid' }, secondDigest), null)
})

test('validation treats a digest only as a claim and rejects malformed metadata shapes', () => {
  assert.equal(hackerOneSnapshotDigest(null), null)
  assert.equal(hackerOneSnapshotDigest({ scope_snapshot: [] }), null)
  assert.equal(hackerOneSnapshotDigest({ scope_snapshot: { sha256: 'not-a-digest' } }), null)
  assert.equal(hackerOneSnapshotDigest({ scope_snapshot: { sha256: 'a'.repeat(64) } }), 'a'.repeat(64))
  const input = campaignInput({ name: 'Manual', scope: 'example.test', hackerone_metadata: { verified: true } })
  assert.equal(input.value?.hackerone_metadata, undefined)
})

test('program query resolves an exact name into an authoritative paused private preview', async () => {
  const response = await invoke(importProgram, 'POST', { programQuery: 'SYNTHETIC PRIVATE PROGRAM' })
  assert.equal(response.status, 200)
  assert.equal(response.body.campaign.hackerone_handle, 'synthetic-private')
  assert.equal(response.body.campaign.status, 'paused')
  assert.equal(response.body.campaign.privacy, 'private')
  assert.equal(response.body.campaign.rulesOfEngagement, policy)
  assert.equal(upstreamRequests[0], '/v1/hackers/programs')
  assert.equal(upstreamRequests.length, 4)
  assert.equal(upstreamSignals.length, 4)
  assert.equal(new Set(upstreamSignals).size, 1, 'Lookup and scope fetch must share the same total timeout')
  assert.deepEqual(await database.campaigns('owner'), [])
})

test('partial and ambiguous queries return candidates only until an explicit handle is selected', async () => {
  const partial = await invoke(importProgram, 'POST', { programQuery: 'synthetic' })
  assert.equal(partial.status, 200)
  assert.deepEqual(partial.body, { success: true, candidates: [{
    handle: 'synthetic-private', name: 'Synthetic Private Program', url: 'https://hackerone.com/synthetic-private',
  }] })
  assert.deepEqual(upstreamRequests, ['/v1/hackers/programs/synthetic', '/v1/hackers/programs'])
  programList.push({ id: 'second-fixture', type: 'program', attributes: { handle: 'synthetic-two', name: 'Synthetic Private Program' } })
  const ambiguous = await invoke(importProgram, 'POST', { programQuery: 'Synthetic Private Program' })
  assert.equal(ambiguous.status, 200)
  assert.equal(ambiguous.body.campaign, undefined)
  assert.equal(ambiguous.body.candidates.length, 2)
  assert.equal(upstreamRequests.length, 3)
  const selected = await invoke(importProgram, 'POST', { programHandle: 'synthetic-private' })
  assert.equal(selected.status, 200)
  assert.equal(selected.body.campaign.hackerone_handle, 'synthetic-private')
  assert.deepEqual((await invoke(importProgram, 'POST', { programQuery: 'Unmatched synthetic fixture' })).body, { success: true, candidates: [] })
})

test('query lookup cannot bypass user authentication, owner authorization or the setup gate', async () => {
  assert.equal((await invoke(importProgram, 'POST', { programQuery: 'Synthetic Private Program' }, null)).status, 401)
  assert.equal((await invoke(importProgram, 'POST', { programQuery: 'Synthetic Private Program' }, 'outsider')).status, 403)
  delete process.env.HACKERONE_API_TOKEN
  assert.equal((await invoke(importProgram, 'POST', { programQuery: 'Synthetic Private Program' })).status, 503)
  assert.equal(upstreamRequests.length, 0)
})

test('invalid or conflicting lookup request forms fail without upstream requests', async () => {
  for (const body of [null, [], {}, { programQuery: null }, { programQuery: {} }, { programQuery: 'Example\nProgram' },
    { programQuery: 'https://evil.test/synthetic-private' }, { programQuery: 'Synthetic', programHandle: 'synthetic-private' }]) {
    const response = await invoke(importProgram, 'POST', body)
    assert.equal(response.status, 400)
    assert.equal(response.headers['cache-control'], 'no-store')
  }
  assert.equal(upstreamRequests.length, 0)
})

test('handle-shaped query requires candidate confirmation and skips the full catalog', async () => {
  programList.push({ id: 'collision-fixture', type: 'program', attributes: { handle: 'other-fixture', name: 'synthetic-private' } })
  const suggested = await invoke(importProgram, 'POST', { programQuery: 'SYNTHETIC-PRIVATE' })
  assert.equal(suggested.status, 200)
  assert.deepEqual(suggested.body, { success: true, candidates: [{
    handle: 'synthetic-private', name: 'Synthetic Private Program', url: 'https://hackerone.com/synthetic-private',
  }] })
  assert.deepEqual(upstreamRequests, ['/v1/hackers/programs/synthetic-private'])
  assert.deepEqual(await database.campaigns('owner'), [])
  const selected = await invoke(importProgram, 'POST', { programHandle: 'synthetic-private' })
  assert.equal(selected.status, 200)
  assert.equal(selected.body.campaign.hackerone_handle, 'synthetic-private')
  assert.equal(upstreamRequests.includes('/v1/hackers/programs'), false)
  assert.equal(upstreamRequests.length, 4)
})

test('credential rejection and rate limiting on the direct lookup do not trigger catalog fallback', async () => {
  for (const [status, expected] of [[401, 502], [403, 404], [429, 429]]) {
    upstreamRequests.length = 0
    upstreamStatus = status
    assert.equal((await invoke(importProgram, 'POST', { programQuery: 'synthetic-private' })).status, expected)
    assert.deepEqual(upstreamRequests, ['/v1/hackers/programs/synthetic-private'])
  }
})
