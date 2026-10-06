import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { assertHackerOneAccess, fetchHackerOneProgram, hackerOneMetadata, hackerOneScope, hackerOneStatus, normalizeHackerOneHandle, resolveHackerOneProgram, HackerOneError } from '../src/server/hackerone'

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
    assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'manual'); assert.equal(init?.cache, 'no-store')
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

test('bare and wrapped single-program responses preserve snapshots and require candidate confirmation', async () => {
  mockApi(); const wrapped = await fetchHackerOneProgram('example')
  mockApi({ programData: program.data }); const bare = await fetchHackerOneProgram('example')
  assert.equal(bare.sha256, wrapped.sha256)
  for (const programData of [program, program.data]) {
    calls.length = 0; mockApi({ programData })
    assert.deepEqual(await resolveHackerOneProgram('example'), { candidates: [{ handle: 'example', name: 'Example', url: 'https://hackerone.com/example' }] })
    assert.equal(calls.length, 1)
  }
})

test('single-program compatibility never accepts malformed envelopes or identities', async () => {
  for (const programData of [
    { ...program.data, data: null }, { data: [] }, { data: {} }, [],
    { ...program.data, type: 'user' },
    { ...program.data, attributes: { ...program.data.attributes, handle: 'other' } },
  ]) {
    mockApi({ programData }); await assert.rejects(fetchHackerOneProgram('example'), { status: 502 })
    mockApi({ programData }); await assert.rejects(resolveHackerOneProgram('example'), { status: 502 })
  }
})

const listedProgram = (id: string, handle: string, name: string) => ({ id, type: 'program', attributes: {
  handle, name, policy: 'Synthetic policy not returned in candidate lists.', private_note: 'Synthetic extra field not returned.',
} })
function mockPrograms(pages: { data: unknown[]; links?: unknown }[], direct?: { program?: unknown; status?: number }) {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url.href)
    assert.equal(url.origin, 'https://api.hackerone.com')
    assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'manual'); assert.equal(init?.cache, 'no-store')
    assert.equal(new Headers(init?.headers).get('Authorization'), `Basic ${Buffer.from('test-user:test-token').toString('base64')}`)
    if (url.pathname !== '/v1/hackers/programs') {
      assert.match(url.pathname, /^\/v1\/hackers\/programs\/[a-z0-9_-]+$/)
      assert.equal(url.search, '')
      return Response.json(direct?.program ?? { errors: [{ detail: 'Synthetic missing handle' }] }, { status: direct?.status ?? 404 })
    }
    assert.deepEqual([...url.searchParams.keys()].filter(key => !['page[number]', 'page[size]'].includes(key)), [])
    return Response.json(pages[Number(url.searchParams.get('page[number]') ?? '1') - 1])
  }
}
test('catalog lookup resolves exact case-insensitive names or handles and accepts explicit HTTPS URLs', async () => {
  mockPrograms([{ data: [listedProgram('1', 'synthetic-example', 'Synthetic Example')] }])
  assert.deepEqual(await resolveHackerOneProgram(' SYNTHETIC EXAMPLE '), { programHandle: 'synthetic-example' })
  assert.deepEqual(await resolveHackerOneProgram('Synthetic-Example'), { programHandle: 'synthetic-example' })
  calls.length = 0
  assert.deepEqual(await resolveHackerOneProgram('https://hackerone.com/synthetic-example/policy_scopes'), { programHandle: 'synthetic-example' })
  assert.equal(calls.length, 0)
})
test('partial matches always require selection, even one candidate, and do not expose extra program fields', async () => {
  mockPrograms([{ data: [listedProgram('1', 'synthetic-example', 'Synthetic Example')] }])
  assert.deepEqual(await resolveHackerOneProgram('synthetic'), { candidates: [{
    handle: 'synthetic-example', name: 'Synthetic Example', url: 'https://hackerone.com/synthetic-example',
  }] })
  assert.deepEqual(await resolveHackerOneProgram('no matching fixture'), { candidates: [] })
})
test('lookup consumes every page before resolving an exact name and preserves ambiguous choices', async () => {
  mockPrograms([
    { data: [listedProgram('1', 'example-one', 'Synthetic Example')], links: { next: 'https://api.hackerone.com/v1/hackers/programs?page[number]=2&page[size]=100' } },
    { data: [listedProgram('2', 'example-two', 'synthetic example')], links: {} },
  ])
  const result = await resolveHackerOneProgram('SYNTHETIC EXAMPLE')
  assert.equal(calls.length, 2)
  assert.equal(result.programHandle, undefined)
  assert.deepEqual(result.candidates?.map(candidate => candidate.handle).sort(), ['example-one', 'example-two'])
})
test('a handle and a different exact program name cannot silently select the wrong program', async () => {
  mockPrograms([{ data: [listedProgram('1', 'example', 'First fixture'), listedProgram('2', 'second', 'Example')] }])
  const result = await resolveHackerOneProgram('example')
  assert.equal(result.programHandle, undefined)
  assert.equal(result.candidates?.length, 2)
})
test('duplicate program IDs or normalized handles fail rather than hiding inconsistent pagination', async () => {
  for (const duplicate of [listedProgram('1', 'second', 'Second fixture'), listedProgram('2', 'EXAMPLE', 'Second fixture')]) {
    mockPrograms([{ data: [listedProgram('1', 'example', 'First fixture'), duplicate] }])
    await assert.rejects(resolveHackerOneProgram('fixture'), { status: 502 })
  }
})
test('program lookup rejects malformed queries before network access', async () => {
  mockPrograms([{ data: [] }])
  for (const input of [undefined, null, {}, [], 7, '', '   ', '*', 'a'.repeat(256), 'Example\nProgram', 'Example\u0000', 'Example\u202E', '<script>alert(1)</script>', '../example', 'https://evil.test/example', 'http://hackerone.com/example', 'https://user:pass@hackerone.com/example', 'javascript:alert(1)', 'file:///tmp/example']) {
    await assert.rejects(resolveHackerOneProgram(input), { status: 400 })
  }
  assert.equal(calls.length, 0)
})
test('program lookup rejects unsafe pagination, cycles, malformed resources and oversized collections', async () => {
  for (const next of ['https://evil.test/collect', 'https://api.hackerone.com/v1/hackers/programs/other', 'https://api.hackerone.com/v1/hackers/programs?query=secret', 'https://user:pass@api.hackerone.com/v1/hackers/programs', 'https://api.hackerone.com/v1/hackers/programs?page[size]=100']) {
    calls.length = 0
    mockPrograms([{ data: [listedProgram('1', 'example', 'Example')], links: { next } }])
    await assert.rejects(resolveHackerOneProgram('Example fixture'), { status: 502 })
    assert.equal(calls.length, 1)
  }
  for (const record of [listedProgram('1', '../example', 'Example'), listedProgram('1', 'example', ''), { id: '1', type: 'user', attributes: { handle: 'example', name: 'Example' } }]) {
    mockPrograms([{ data: [record] }]); await assert.rejects(resolveHackerOneProgram('Example fixture'), { status: 502 })
  }
  globalThis.fetch = async () => new Response('x'.repeat(4 * 1024 * 1024 + 1))
  await assert.rejects(resolveHackerOneProgram('Example'), /size limit/)
})

test('handle-shaped lookup suggests one validated candidate without reading catalog or scope', async () => {
  mockPrograms([], { program: { data: listedProgram('1', 'example', 'Example Program') }, status: 200 })
  assert.deepEqual(await resolveHackerOneProgram(' EXAMPLE '), { candidates: [{
    handle: 'example', name: 'Example Program', url: 'https://hackerone.com/example',
  }] })
  assert.deepEqual(calls, ['https://api.hackerone.com/v1/hackers/programs/example'])
})
test('handle suggestion requires explicit choice even when another program display name may collide', async () => {
  mockPrograms([{ data: [listedProgram('1', 'example', 'First fixture'), listedProgram('2', 'second', 'Example')] }], {
    program: { data: listedProgram('1', 'example', 'First fixture') }, status: 200,
  })
  const result = await resolveHackerOneProgram('example')
  assert.equal(result.programHandle, undefined)
  assert.deepEqual(result.candidates, [{ handle: 'example', name: 'First fixture', url: 'https://hackerone.com/example' }])
  assert.equal(calls.length, 1)
})
test('only genuine upstream 404 falls back to complete catalog lookup with the same signal', async () => {
  mockPrograms([{ data: [listedProgram('1', 'other-handle', 'Example')] }])
  const fallback = globalThis.fetch
  const signals: AbortSignal[] = []
  globalThis.fetch = async (input, init) => { signals.push(init!.signal!); return fallback(input, init) }
  assert.deepEqual(await resolveHackerOneProgram('example'), { programHandle: 'other-handle' })
  assert.deepEqual(calls.map(value => new URL(value).pathname), ['/v1/hackers/programs/example', '/v1/hackers/programs'])
  assert.equal(new Set(signals).size, 1)
  for (const [upstream, expected] of [[401, 502], [403, 404], [429, 429], [302, 502], [500, 502]]) {
    calls.length = 0
    mockPrograms([{ data: [listedProgram('1', 'other-handle', 'Example')] }], { status: upstream })
    await assert.rejects(resolveHackerOneProgram('example'), { status: expected })
    assert.equal(calls.length, 1)
  }
})
test('malformed or mismatched direct program identities fail without catalog fallback', async () => {
  for (const data of [listedProgram('1', 'wrong', 'Example'), listedProgram('1', 'example', ''), listedProgram('1', '../example', 'Example'),
    { id: '1', type: 'user', attributes: { handle: 'example', name: 'Example' } }]) {
    calls.length = 0
    mockPrograms([], { program: { data }, status: 200 })
    await assert.rejects(resolveHackerOneProgram('example'), { status: 502 })
    assert.equal(calls.length, 1)
  }
})
