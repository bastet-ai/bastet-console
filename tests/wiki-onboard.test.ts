import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-ignore Operator script intentionally has no browser/runtime dependency.
import { onboard, validateEntries } from '../scripts/onboard-wiki-programs.mjs'

const entry = { handle: 'example', wikiSlug: 'example' }
const digest = 'a'.repeat(64)
const campaign = { id: 'synthetic-id', hackerone_handle: 'example', privacy: 'private', status: 'paused',
  hackerone_metadata: { state: 'public_mode', scope_snapshot: { sha256: digest, assets: [], fetched_at: '2026-10-06T00:00:00Z' } } }
test('wiki onboarding rejects ambiguous duplicate and unsafe entry mappings', () => {
  assert.throws(() => validateEntries([entry, entry]))
  assert.throws(() => validateEntries([{ ...entry, wikiSlug: '../private' }]))
})
test('wiki onboarding previews, pins digest, creates private paused and reads back', async () => {
  const calls: string[] = []
  const request = async (path: string, body?: any) => {
    calls.push(path)
    if (path === '/api/campaigns' && !body) return { campaigns: [] }
    if (path === '/api/campaigns' && body) assert.deepEqual(body, {
      hackerone_handle: 'example', hackerone_metadata: { scope_snapshot: { sha256: digest } },
    })
    return { campaign }
  }
  const results = await onboard([entry], request)
  assert.equal(results[0].result, 'created')
  assert.equal(calls.length, 4)
})
test('wiki onboarding reuses an existing campaign without any writes', async () => {
  const result = await onboard([entry], async (path: string, body?: any) => {
    assert.equal(body, undefined)
    return path === '/api/campaigns' ? { campaigns: [campaign] } : { campaign }
  })
  assert.equal(result[0].result, 'existing')
})
test('wiki onboarding holds ambiguous post outcomes instead of retrying creation', async () => {
  let creates = 0
  const result = await onboard([entry], async (path: string, body?: any) => {
    if (path === '/api/campaigns' && !body) return { campaigns: [] }
    if (path === '/api/campaigns' && body) { creates++; throw new Error('transport failed') }
    return { campaign }
  })
  assert.equal(creates, 1)
  assert.equal(result[0].result, 'held')
})
