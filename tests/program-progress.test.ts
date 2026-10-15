import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { NextApiRequest, NextApiResponse } from 'next'
import { ConsoleDatabase, type SqlDatabase, type SqlStatement } from '../src/server/database'
import { SQLiteDatabase } from '../src/server/sqlite'
import { requestContext } from '../src/server/runtime'
import progress from '../pages/api/campaigns/[id]/progress'
import control from '../pages/api/campaigns/[id]/control'
import review from '../pages/api/campaigns/[id]/candidates/[candidateId]/review'
import attest from '../pages/api/campaigns/[id]/live-tests/[jobId]/attest'
import pilotReview from '../pages/api/campaigns/[id]/live-tests/[jobId]/pilot-review'
import { ProgramControlActions, ProgramProgressView } from '../src/components/ProgramProgress'
import type { ProgramProgress } from '../src/lib/programProgress'

test('progress checks membership before querying the orchestration projection and distinguishes missing/no-run', async () => {
  const queries: string[] = []
  let member = false, available = 0, controlAvailable = 0, funnelAvailable = 0
  let result: string | null = null, funnelResult: string | null = null
  const db: SqlDatabase = {
    dialect: 'postgres', batch: async () => [],
    prepare(sql) {
      queries.push(sql)
      const statement: SqlStatement = {
        bind: () => statement, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }),
        first: async <T>() => (sql.includes('AS role') ? member ? { role: 'watcher' } : null
          : sql.includes('AS available') ? { available: sql.includes('console_control') ? controlAvailable
            : sql.includes('console_research_funnel') ? funnelAvailable : available }
            : sql.includes('console_research_funnel(?, ?)') ? { funnel: funnelResult } : { progress: result }) as T | null,
      }
      return statement
    },
  }
  const repository = new ConsoleDatabase(db)
  assert.equal(await repository.campaignProgress('outsider', 'private-campaign'), null)
  assert.equal(queries.length, 1)
  assert.equal(queries.some(query => query.includes('bastet')), false)
  member = true
  assert.deepEqual(await repository.campaignProgress('owner', 'private-campaign'), { configured: false, control_available: false, progress: null })
  available = 1
  assert.deepEqual(await repository.campaignProgress('owner', 'private-campaign'), { configured: true, control_available: false, progress: null })
  result = JSON.stringify({ run_id: 'synthetic-run', status: 'paused', agents: [], tasks: [], reports: [] })
  assert.equal((await repository.campaignProgress('owner', 'private-campaign'))?.progress?.run_id, 'synthetic-run')
  assert.ok(queries.some(query => /SELECT bastet\.console_progress\(\?\)/.test(query)))
  assert.equal((await repository.campaignProgress('owner', 'private-campaign'))?.progress?.research_funnel, undefined)
  funnelAvailable = 1
  funnelResult = JSON.stringify({ hypotheses: { total: 2 } })
  assert.equal((await repository.campaignProgress('owner', 'private-campaign'))?.progress?.research_funnel?.hypotheses.total, 2)
  controlAvailable = 1
  assert.equal((await repository.campaignProgress('owner', 'private-campaign'))?.control_available, true)
  assert.match(queries.at(-1)!, /has_function_privilege/)
})

test('progress route enforces authentication, membership, read-only methods, no-store and legacy fallback', async () => {
  const storage = new SQLiteDatabase(':memory:')
  storage.connection.exec(readFileSync('migrations/0001_console.sql', 'utf8'))
  storage.connection.exec("INSERT INTO users(id,google_id,email,name) VALUES ('owner','owner','owner@example.test','Owner'),('outsider','outsider','outsider@example.test','Other');")
  const repository = new ConsoleDatabase(storage)
  const campaign = await repository.createCampaign('owner', { name: 'Synthetic', scope: 'example.test' })
  const invoke = async (user?: string, method = 'GET') => {
    let status = 200, data: any
    const headers: Record<string, string> = {}
    const req = { method, headers: {}, query: { id: campaign!.id } } as NextApiRequest
    const res = { status(code: number) { status = code; return this }, json(value: unknown) { data = value; return this }, setHeader(name: string, value: string) { headers[name] = value; return this } } as unknown as NextApiResponse
    await requestContext.run({ database: repository, ...(user ? { debugUserId: user } : {}) }, () => progress(req, res))
    return { status, data, headers }
  }
  try {
    assert.equal((await invoke()).status, 401)
    assert.equal((await invoke('outsider')).status, 403)
    assert.equal((await invoke('owner', 'POST')).status, 405)
    const allowed = await invoke('owner')
    assert.equal(allowed.status, 200)
    assert.equal(allowed.headers['Cache-Control'], 'no-store')
    assert.deepEqual(allowed.data, { success: true, configured: false, control_available: false, progress: null })
  } finally { storage.close() }
})

test('program control route authorizes managers, never toggles metadata locally, and explains blocked/unavailable states', async () => {
  const storage = new SQLiteDatabase(':memory:')
  storage.connection.exec(readFileSync('migrations/0001_console.sql', 'utf8'))
  storage.connection.exec("INSERT INTO users(id,google_id,email,name) VALUES ('owner','owner','owner@example.test','Owner'),('manager','manager','manager@example.test','Manager'),('watcher','watcher','watcher@example.test','Watcher'),('outsider','outsider','outsider@example.test','Other');")
  const repository = new ConsoleDatabase(storage)
  const campaign = (await repository.createCampaign('owner', { name: 'Synthetic', scope: 'example.test', status: 'active' }))!
  await repository.addMember('owner', campaign.id, 'manager', 'manager')
  await repository.addMember('owner', campaign.id, 'watcher', 'watcher')
  let calls = 0, actor = ''
  const originalAvailable = repository.programControlAvailable
  const originalProgress = repository.campaignProgress
  const originalControl = repository.controlProgram
  const invoke = async (user?: string, method = 'POST', body: unknown = { action: 'pause' }) => {
    let status = 200, data: any
    const headers: Record<string, string> = {}
    const req = { method, headers: {}, body, query: { id: campaign.id } } as NextApiRequest
    const res = { status(code: number) { status = code; return this }, json(value: unknown) { data = value; return this }, setHeader(name: string, value: string) { headers[name] = value; return this } } as unknown as NextApiResponse
    await requestContext.run({ database: repository, ...(user ? { debugUserId: user } : {}) }, () => control(req, res))
    return { status, data, headers }
  }
  try {
    assert.equal((await invoke()).status, 401)
    assert.equal((await invoke('owner', 'GET')).status, 405)
    assert.equal((await invoke('owner', 'POST', { action: 'launch' })).status, 400)
    assert.equal((await invoke('outsider')).status, 403)
    assert.equal((await invoke('watcher')).status, 403)
    const unavailable = await invoke('owner')
    assert.equal(unavailable.status, 503)
    assert.equal(unavailable.headers['Cache-Control'], 'no-store')
    repository.programControlAvailable = async () => true
    repository.campaignProgress = async () => ({ configured: true, control_available: true, progress: null })
    assert.equal((await invoke('owner')).status, 409)
    repository.campaignProgress = async () => ({ configured: true, control_available: true, progress: { run_id: 'synthetic-run' } as ProgramProgress })
    repository.controlProgram = async (userId, _campaignId, action) => { calls++; actor = userId; return { ok: action === 'pause', action, status: 'paused', ...(action === 'pause' ? { changed: true } : { reason: 'eligibility_refresh_required' }) } }
    const paused = await invoke('manager')
    assert.equal(paused.status, 200)
    assert.equal(paused.data.control.status, 'paused')
    assert.equal(actor, 'manager')
    const blocked = await invoke('owner', 'POST', { action: 'resume' })
    assert.equal(blocked.status, 409)
    assert.equal(blocked.data.reason, 'eligibility_refresh_required')
    assert.equal(calls, 2)
    assert.equal((await repository.campaign('owner', campaign.id))?.status, 'active', 'run control must not silently change campaign metadata')
  } finally {
    repository.programControlAvailable = originalAvailable
    repository.campaignProgress = originalProgress
    repository.controlProgram = originalControl
    storage.close()
  }
})

test('candidate review route accepts only explicit owner decisions and never changes campaign or run control', async () => {
  const storage = new SQLiteDatabase(':memory:')
  storage.connection.exec(readFileSync('migrations/0001_console.sql', 'utf8'))
  storage.connection.exec("INSERT INTO users(id,google_id,email,name) VALUES ('owner','owner','owner@example.test','Owner'),('manager','manager','manager@example.test','Manager'),('outsider','outsider','outsider@example.test','Other');")
  const repository = new ConsoleDatabase(storage)
  const campaign = (await repository.createCampaign('owner', { name: 'Synthetic', scope: 'example.test', status: 'paused' }))!
  await repository.addMember('owner', campaign.id, 'manager', 'manager')
  const candidateId = '11111111-1111-4111-8111-111111111111'
  const resultId = '22222222-2222-4222-8222-222222222222'
  const digest = 'd'.repeat(64)
  let calls = 0, actor = '', decision = ''
  const originalAvailable = repository.candidateReviewAvailable
  const originalReview = repository.reviewCandidate
  const invoke = async (user?: string, method = 'POST', body: unknown = { decision: 'rejected', note: 'A human reviewed this synthetic negative case.' }) => {
    let status = 200, data: any
    const headers: Record<string, string> = {}
    const req = { method, headers: {}, body, query: { id: campaign.id, candidateId } } as NextApiRequest
    const res = { status(code: number) { status = code; return this }, json(value: unknown) { data = value; return this }, setHeader(name: string, value: string) { headers[name] = value; return this } } as unknown as NextApiResponse
    await requestContext.run({ database: repository, ...(user ? { debugUserId: user } : {}) }, () => review(req, res))
    return { status, data, headers }
  }
  try {
    assert.equal((await invoke()).status, 401)
    assert.equal((await invoke('owner', 'GET')).status, 405)
    assert.equal((await invoke('owner', 'POST', { decision: 'reportable', note: 'Too short' })).status, 400)
    assert.equal((await invoke('owner', 'POST', { decision: 'rejected', note: 'A human reviewed this case.', unexpected: true })).status, 400)
    assert.equal((await invoke('outsider')).status, 403)
    assert.equal((await invoke('manager')).status, 403)
    assert.equal((await invoke('owner')).status, 503)
    repository.candidateReviewAvailable = async () => true
    repository.reviewCandidate = async (userId, _campaignId, _candidateId, kind) => {
      calls++; actor = userId; decision = kind
      return { ok: true, candidate_id: candidateId, status: kind, reviewed_at: new Date().toISOString() }
    }
    const rejected = await invoke('owner')
    assert.equal(rejected.status, 200)
    assert.equal(rejected.headers['Cache-Control'], 'no-store')
    assert.equal(actor, 'owner')
    assert.equal(decision, 'rejected')
    const reportable = await invoke('owner', 'POST', { decision: 'reportable',
      note: 'I independently reproduced this synthetic result with an owned account and recorded the negative control.',
      result_id: resultId, reproduction_sha256: digest })
    assert.equal(reportable.status, 200)
    assert.equal(decision, 'reportable')
    assert.equal(calls, 2)
    assert.equal((await repository.campaign('owner', campaign.id))?.status, 'paused')
  } finally {
    repository.candidateReviewAvailable = originalAvailable
    repository.reviewCandidate = originalReview
    storage.close()
  }
})

test('runtime attestation route accepts only owner-submitted, digest-only proof', async () => {
  const storage = new SQLiteDatabase(':memory:')
  storage.connection.exec(readFileSync('migrations/0001_console.sql', 'utf8'))
  storage.connection.exec("INSERT INTO users(id,google_id,email,name) VALUES ('owner','owner','owner@example.test','Owner'),('manager','manager','manager@example.test','Manager'),('outsider','outsider','outsider@example.test','Other');")
  const repository = new ConsoleDatabase(storage)
  const campaign = (await repository.createCampaign('owner', { name: 'Synthetic', scope: 'example.test', status: 'paused' }))!
  await repository.addMember('owner', campaign.id, 'manager', 'manager')
  const jobId = '33333333-3333-4333-8333-333333333333'
  const proof = {
    impact_kind: 'unauthorized_read' as const, cleanup_status: 'not_applicable' as const,
    fixture_ownership_sha256: 'a'.repeat(64), before_state_sha256: 'b'.repeat(64),
    after_state_sha256: 'c'.repeat(64), impact_evidence_sha256: 'd'.repeat(64),
    negative_control_sha256: 'e'.repeat(64), cleanup_sha256: 'f'.repeat(64),
    independent_reproduction_sha256: '1'.repeat(64),
  }
  let calls = 0, actor = ''
  const originalAvailable = repository.runtimeAttestationAvailable
  const originalAttest = repository.attestLiveTest
  const invoke = async (user?: string, method = 'POST', body: unknown = proof) => {
    let status = 200, data: any
    const headers: Record<string, string> = {}
    const req = { method, headers: {}, body, query: { id: campaign.id, jobId } } as NextApiRequest
    const res = { status(code: number) { status = code; return this }, json(value: unknown) { data = value; return this }, setHeader(name: string, value: string) { headers[name] = value; return this } } as unknown as NextApiResponse
    await requestContext.run({ database: repository, ...(user ? { debugUserId: user } : {}) }, () => attest(req, res))
    return { status, data, headers }
  }
  try {
    assert.equal((await invoke()).status, 401)
    assert.equal((await invoke('owner', 'GET')).status, 405)
    assert.equal((await invoke('owner', 'POST', { ...proof, token: 'secret' })).status, 400)
    assert.equal((await invoke('owner', 'POST', { ...proof, before_state_sha256: 'bad' })).status, 400)
    assert.equal((await invoke('owner', 'POST', { ...proof, after_state_sha256: proof.before_state_sha256 })).status, 400)
    assert.equal((await invoke('outsider')).status, 403)
    assert.equal((await invoke('manager')).status, 403)
    assert.equal((await invoke('owner')).status, 503)
    repository.runtimeAttestationAvailable = async () => true
    repository.attestLiveTest = async (userId, _campaignId, _jobId, body) => {
      calls++; actor = userId
      assert.deepEqual(body, proof)
      return { ok: true, attestation_id: jobId, result_id: jobId, job_id: jobId,
        hypothesis_id: jobId, classification: 'verified_runtime', candidate_created: false }
    }
    const response = await invoke('owner')
    assert.equal(response.status, 200)
    assert.equal(response.headers['Cache-Control'], 'no-store')
    assert.equal(response.data.attestation.candidate_created, false)
    assert.equal(calls, 1)
    assert.equal(actor, 'owner')
    assert.equal((await repository.campaign('owner', campaign.id))?.status, 'paused')
  } finally {
    repository.runtimeAttestationAvailable = originalAvailable
    repository.attestLiveTest = originalAttest
    storage.close()
  }
})

test('pilot review route accepts owner-reviewed digests without classifying a bug', async () => {
  const storage = new SQLiteDatabase(':memory:')
  storage.connection.exec(readFileSync('migrations/0001_console.sql', 'utf8'))
  storage.connection.exec("INSERT INTO users(id,google_id,email,name) VALUES ('owner','owner','owner@example.test','Owner'),('manager','manager','manager@example.test','Manager'),('outsider','outsider','outsider@example.test','Other');")
  const repository = new ConsoleDatabase(storage)
  const campaign = (await repository.createCampaign('owner', { name: 'Synthetic', scope: 'example.test', status: 'paused' }))!
  await repository.addMember('owner', campaign.id, 'manager', 'manager')
  const jobId = '44444444-4444-4444-8444-444444444444'
  const proof = {
    cleanup_status: 'not_applicable' as const,
    fixture_ownership_sha256: 'a'.repeat(64), request_trace_sha256: 'b'.repeat(64),
    negative_control_sha256: 'c'.repeat(64), before_state_sha256: 'd'.repeat(64),
    after_cleanup_state_sha256: 'd'.repeat(64), cleanup_sha256: 'e'.repeat(64),
    independent_replay_sha256: 'f'.repeat(64),
  }
  let calls = 0, actor = ''
  const originalAvailable = repository.pilotReviewAvailable
  const originalReview = repository.reviewLiveTestPilot
  const invoke = async (user?: string, method = 'POST', body: unknown = proof) => {
    let status = 200, data: any
    const headers: Record<string, string> = {}
    const req = { method, headers: {}, body, query: { id: campaign.id, jobId } } as NextApiRequest
    const res = { status(code: number) { status = code; return this }, json(value: unknown) { data = value; return this }, setHeader(name: string, value: string) { headers[name] = value; return this } } as unknown as NextApiResponse
    await requestContext.run({ database: repository, ...(user ? { debugUserId: user } : {}) }, () => pilotReview(req, res))
    return { status, data, headers }
  }
  try {
    assert.equal((await invoke()).status, 401)
    assert.equal((await invoke('owner', 'GET')).status, 405)
    assert.equal((await invoke('owner', 'POST', { ...proof, token: 'secret' })).status, 400)
    assert.equal((await invoke('owner', 'POST', { ...proof, request_trace_sha256: 'bad' })).status, 400)
    assert.equal((await invoke('owner', 'POST', { ...proof, after_cleanup_state_sha256: '1'.repeat(64) })).status, 400)
    assert.equal((await invoke('owner', 'POST', { ...proof, request_trace_sha256: proof.fixture_ownership_sha256 })).status, 400)
    assert.equal((await invoke('outsider')).status, 403)
    assert.equal((await invoke('manager')).status, 403)
    assert.equal((await invoke('owner')).status, 503)
    repository.pilotReviewAvailable = async () => true
    repository.reviewLiveTestPilot = async (userId, _campaignId, _jobId, body) => {
      calls++; actor = userId
      assert.deepEqual(body, proof)
      return { ok: true, review_id: jobId, job_id: jobId, manifest_id: jobId,
        hypothesis_id: jobId, classification: 'controlled_pilot', candidate_created: false }
    }
    const response = await invoke('owner')
    assert.equal(response.status, 200)
    assert.equal(response.headers['Cache-Control'], 'no-store')
    assert.equal(response.data.review.candidate_created, false)
    assert.equal(calls, 1)
    assert.equal(actor, 'owner')
    assert.equal((await repository.campaign('owner', campaign.id))?.status, 'paused')
  } finally {
    repository.pilotReviewAvailable = originalAvailable
    repository.reviewLiveTestPilot = originalReview
    storage.close()
  }
})

test('progress rendering preserves report text without activating HTML, links or agent instructions', () => {
  const fixture: ProgramProgress = {
    run_id: 'synthetic-run', handle: 'synthetic', status: 'paused', scope_hash: 'a'.repeat(64), deadline: null,
    buzz_channel_id: null, max_workers: 2,
    agents: [{ id: 'a', name: '<script>alert(1)</script>', template: 'recon', role: 'worker', desired_state: 'running', observed_state: 'pending', last_seen: null, model_calls: 0, model_call_limit: 5 }],
    tasks: [{ id: 't', kind: 'passive-recon', state: 'completed', attempt: 1, result: { note: '<img src=x onerror=alert(1)>' }, error: null, created_at: '2026-01-01T00:00:00Z', completed_at: null }],
    reports: [{ id: 'r', title: 'Synthetic report', markdown: '# Report\n<script>alert(1)</script>\n[link](javascript:alert(1))', scope_hash: 'b'.repeat(64), created_at: '2026-01-01T00:00:00Z' }],
    candidate_count: 1, pending_candidate_count: 1,
    candidates: [{ id: 'c', generation: 2, task_id: 't', task_kind: 'source-analysis', task_scope_hash: 'a'.repeat(64),
      title: '<img src=x onerror=alert(2)>', summary: 'A hypothesis for independent review', severity: 'unknown',
      evidence: { result_pointer: '/repositories/0/signals/0', hypothesis: '<script>alert(3)</script>' },
      status: 'needs_review', created_at: '2026-01-01T00:00:00Z', reviewed_at: null, review_note: null }],
  }
  const html = renderToStaticMarkup(createElement(ProgramProgressView, { progress: fixture }))
  assert.match(html, /running<!-- --> \/ <!-- -->pending|running \/ pending/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /\[link\]\(javascript:alert\(1\)\)/)
  assert.doesNotMatch(html, /<script|<img|href=|onerror="/)
  assert.match(html, /not proof of a running worker/)
  assert.match(html, /Research candidates/)
  assert.match(html, /1 shown of 1; 1 awaiting review/)
  assert.match(html, /needs_review/)
  assert.match(html, /not a verified or reportable bug/)
  assert.match(html, /&lt;script&gt;alert\(3\)&lt;\/script&gt;/)
  const withoutCandidateProjection = renderToStaticMarkup(createElement(ProgramProgressView,
    { progress: { ...fixture, candidates: undefined } }))
  assert.match(withoutCandidateProjection, /Candidate review data is not available/)
  assert.doesNotMatch(withoutCandidateProjection, /No candidate proposals have been recorded/)
  const funnel = {
    approved_asset_entries: 2, eligible_asset_count: 0, policy_refresh_at: null,
    hypotheses: { total: 1, untested: 0, negative: 0, inconclusive: 0, verified_runtime: 1 },
    test_jobs: { total: 1, pending: 0, running: 0, complete: 1, inconclusive: 0, failed: 0, cleanup_failed: 0, cancelled: 0 },
    test_requests: 3, candidate_decisions: { pending: 1, human_reviewed: 0, reportable: 0, rejected: 0, duplicate: 0 },
    task_failures: 0, task_failures_by_kind: [], model_calls: 5, completed_cycles: 1, completed_cycle_seconds: 120,
    last_task_created_at: null, last_test_result_at: null,
    candidate_review_options: [{ candidate_id: 'c', result_id: 'synthetic-result', recorded_at: '2026-01-01T00:00:00Z' }],
  }
  const watcher = renderToStaticMarkup(createElement(ProgramProgressView, { progress: { ...fixture, research_funnel: funnel } }))
  assert.match(watcher, /Fresh-eligible approved asset entries/)
  assert.match(watcher, /verified runtime/)
  assert.match(watcher, /not a human-reviewed, reportable bug/)
  assert.doesNotMatch(watcher, /Save owner decision/)
  const owner = renderToStaticMarkup(createElement(ProgramProgressView,
    { progress: { ...fixture, research_funnel: funnel }, canReview: true, onReview: async () => {} }))
  assert.match(owner, /Save owner decision/)
  assert.match(owner, /Reportable after independent reproduction/)
})

test('per-program controls reflect observed run status and fail closed when backend control is unavailable', () => {
  const render = (status: string, available: boolean) => renderToStaticMarkup(createElement(ProgramControlActions,
    { status, available, busy: false, campaignName: 'Synthetic', onControl: () => {} }))
  assert.match(render('active', true), /Pause Synthetic program run/)
  assert.match(render('paused', true), /Resume Synthetic program run/)
  assert.match(render('paused', false), /disabled=""/)
  assert.match(render('paused', false), /Run control is not available/)
  assert.equal(render('failed', true), '')
})
