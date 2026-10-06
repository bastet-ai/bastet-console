import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { assertHackerOneAccess, fetchHackerOneProgram, hackerOneMetadata, hackerOneScope, hackerOneStatus, normalizeHackerOneHandle, HackerOneError } from '../src/server/hackerone'

const originalFetch = globalThis.fetch
const originalEnv = { ...process.env }
const program = { data: { id: '1', type: 'program', attributes: { handle: 'example', name: 'Example', policy: 'Use only your own test accounts.\nFull private policy.', state: 'soft_launched', offers_bounties: true, submission_state: 'open' } } }
const asset = (id: number, eligible = true) => ({ id: String(id), type: 'structured-scope', attributes: {
  asset_identifier: eligible ? `app${id}.example.test` : '*.staging.example.test', asset_type: 'URL', instruction: 'Full instruction. '.repeat(30), eligible_for_submission: eligible, eligible_for_bounty: eligible, max_severity: eligible ? 'critical' : 'none', updated_at: '2026-10-01T00:00:00Z'
} })
const exclusion = { id: 'x1', type: 'scope-exclusion', attributes: { category: 'Availability', details: 'No denial of service testing.', updated_at: '2026-10-01T00:00:00Z' } }
const calls: string[] = []
function mockApi(options: { scopes?: unknown[]; scopeLinks?: unknown; scopeStatus?: number; programData?: unknown; reverse?: boolean } = {}) {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url.href)
    assert.equal(url.origin, 'https://api.hackerone.com')
    assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'manual')
    assert.equal(new Headers(init?.headers).get('Authorization'), `Basic ${Buffer.from('test-user:test-token').toString('base64')}`)
    if (url.pathname.endsWith('/structured_scopes')) return Response.json({ data: options.scopes ?? [asset(1), asset(2, false)], ...(options.scopeLinks === undefined ? {} : { links: options.scopeLinks }) }, { status: options.scopeStatus ?? 200 })
    if (url.pathname.endsWith('/scope_exclusions')) return Response.json({ data: [exclusion] })
    return Response.json(options.programData ?? program)
  }
}
beforeEach(() => { calls.length = 0; process.env.HACKERONE_API_USERNAME = 'test-user'; process.env.HACKERONE_API_TOKEN = 'test-token'; process.env.HACKERONE_API_OWNER_ID = 'owner' })
afterEach(() => { globalThis.fetch = originalFetch; for (const key of ['HACKERONE_API_USERNAME', 'HACKERONE_API_TOKEN', 'HACKERONE_API_OWNER_ID']) { if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key] } })

test('only valid handles and HTTPS HackerOne program URLs normalize', () => {
  for (const input of [' EXAMPLE ', 'https://hackerone.com/example', 'https://hackerone.com/example/policy_scopes?type=team', 'https://hackerone.com/example/invite_only']) assert.equal(normalizeHackerOneHandle(input), 'example')
  for (const input of ['', '../example', 'https://evil.test/example', 'https://hackerone.com.evil.test/example', 'http://hackerone.com/example', 'https://user:pass@hackerone.com/example', 'https://hackerone.com/example/reports/new', 'https://hackerone.com:444/example', 'https://hackerone.com/%2e%2e/example']) assert.throws(() => normalizeHackerOneHandle(input), HackerOneError)
})
test('integration access is owner-only and configuration contains no credential value', () => {
  assert.deepEqual(hackerOneStatus('owner'), { configured: true, authorized: true })
  assertHackerOneAccess('owner')
  assert.throws(() => assertHackerOneAccess('other'), { status: 403 })
  delete process.env.HACKERONE_API_TOKEN
  assert.deepEqual(hackerOneStatus('owner'), { configured: false, authorized: false })
  assert.throws(() => assertHackerOneAccess('owner'), { status: 503 })
})
test('full policy, excluded assets, complete instructions and bounty flags are preserved without API credentials', async () => {
  mockApi(); const team = await fetchHackerOneProgram('example'); const metadata = hackerOneMetadata(team)
  assert.equal(team.policy, program.data.attributes.policy)
  assert.equal(team.assets[0].instruction, asset(1).attributes.instruction)
  assert.equal(team.assets[1].eligible_for_submission, false)
  assert.equal(metadata.asset_count, 1); assert.equal(metadata.excluded_asset_count, 1)
  assert.match(hackerOneScope(team), /OUT OF SCOPE\n\*\.staging/)
  assert.equal(metadata.scope_snapshot.exclusions[0].details, exclusion.attributes.details)
  assert.equal(metadata.scope_snapshot.review_required, true)
  assert.doesNotMatch(JSON.stringify(metadata), /test-token|test-user|Authorization|Basic /)
  assert.equal(calls.length, 3)
})
test('all scope pages beyond 100 assets are fetched, without eligibility filters', async () => {
  mockApi(); const fallback = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    if (!url.pathname.endsWith('/structured_scopes')) return fallback(input, init)
    assert.equal(url.searchParams.get('filter[eligible_for_submission]'), null)
    return url.searchParams.has('page[number]') ? Response.json({ data: [asset(101, false)], links: {} }) : Response.json({ data: Array.from({ length: 100 }, (_, i) => asset(i + 1)), links: { next: 'https://api.hackerone.com/v1/hackers/programs/example/structured_scopes?page[number]=2&page[size]=100' } })
  }
  const team = await fetchHackerOneProgram('example')
  assert.equal(team.assets.length, 101); assert.equal(team.assets.filter(a => !a.eligible_for_submission).length, 1)
})
test('canonical digest ignores pagination order and fetch time but changes for policy, flags and exclusions', async () => {
  mockApi(); const initial = await fetchHackerOneProgram('example')
  mockApi({ scopes: [asset(2, false), asset(1)] }); assert.equal((await fetchHackerOneProgram('example')).sha256, initial.sha256)
  mockApi({ programData: { data: { ...program.data, attributes: { ...program.data.attributes, policy: 'Changed policy' } } } }); assert.notEqual((await fetchHackerOneProgram('example')).sha256, initial.sha256)
  mockApi({ scopes: [asset(1), asset(2, true)] }); assert.notEqual((await fetchHackerOneProgram('example')).sha256, initial.sha256)
})
test('off-origin, cross-program, filtered, credential-bearing and malformed pagination fail closed', async () => {
  for (const next of ['https://evil.test/steal', 'http://api.hackerone.com/v1/hackers/programs/example/structured_scopes', 'https://api.hackerone.com/v1/hackers/programs/other/structured_scopes', 'https://api.hackerone.com/v1/hackers/programs/example/structured_scopes?filter[eligible_for_submission]=true', 'https://user:pass@api.hackerone.com/v1/hackers/programs/example/structured_scopes', { href: 'https://evil.test' }]) {
    calls.length = 0; mockApi({ scopeLinks: { next } })
    await assert.rejects(fetchHackerOneProgram('example'), { status: 502 }); assert.equal(calls.length, 2)
  }
})
test('cycles and duplicate assets fail rather than silently claiming a complete snapshot', async () => {
  mockApi({ scopeLinks: { next: 'https://api.hackerone.com/v1/hackers/programs/example/structured_scopes?page[size]=100' } }); await assert.rejects(fetchHackerOneProgram('example'), /pagination/)
  mockApi({ scopes: [asset(1), asset(1)] }); await assert.rejects(fetchHackerOneProgram('example'), /changed during pagination/)
})
test('upstream auth, missing access, rate limits and redirects produce safe actionable errors', async () => {
  for (const [upstream, expected] of [[401, 502], [403, 404], [404, 404], [429, 429], [302, 502], [500, 502]]) {
    globalThis.fetch = async () => new Response('private secret error body', { status: upstream })
    await assert.rejects(fetchHackerOneProgram('example'), (error: HackerOneError) => error.status === expected && !error.message.includes('secret'))
  }
})
test('missing eligibility, missing policy, wrong handle, malformed JSON and huge body fail closed', async () => {
  const malformed = asset(1); delete (malformed.attributes as Partial<typeof malformed.attributes>).eligible_for_submission
  mockApi({ scopes: [malformed] }); await assert.rejects(fetchHackerOneProgram('example'), /eligibility/)
  mockApi({ programData: { data: { ...program.data, attributes: { ...program.data.attributes, policy: '' } } } }); await assert.rejects(fetchHackerOneProgram('example'), { status: 502 })
  mockApi({ programData: { data: { ...program.data, attributes: { ...program.data.attributes, handle: 'different' } } } }); await assert.rejects(fetchHackerOneProgram('example'), /different program/)
  globalThis.fetch = async () => new Response('not JSON'); await assert.rejects(fetchHackerOneProgram('example'), /unreadable/)
  globalThis.fetch = async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)); await assert.rejects(fetchHackerOneProgram('example'), /size limit/)
})
test('timeouts and network errors are redacted', async () => {
  globalThis.fetch = async () => { throw new Error('test-token private downstream diagnostic') }
  await assert.rejects(fetchHackerOneProgram('example'), (error: HackerOneError) => error.status === 502 && !error.message.includes('test-token'))
})
