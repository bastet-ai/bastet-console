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
import { ProgramControlActions, ProgramProgressView } from '../src/components/ProgramProgress'
import type { ProgramProgress } from '../src/lib/programProgress'

test('progress checks membership before querying the orchestration projection and distinguishes missing/no-run', async () => {
  const queries: string[] = []
  let member = false, available = 0, controlAvailable = 0, result: string | null = null
  const db: SqlDatabase = {
    dialect: 'postgres', batch: async () => [],
    prepare(sql) {
      queries.push(sql)
      const statement: SqlStatement = {
        bind: () => statement, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }),
        first: async <T>() => (sql.includes('AS role') ? member ? { role: 'watcher' } : null : sql.includes('AS available') ? { available: sql.includes('console_control') ? controlAvailable : available } : { progress: result }) as T | null,
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

test('progress rendering preserves report text without activating HTML, links or agent instructions', () => {
  const fixture: ProgramProgress = {
    run_id: 'synthetic-run', handle: 'synthetic', status: 'paused', scope_hash: 'a'.repeat(64), deadline: null,
    buzz_channel_id: null, max_workers: 2,
    agents: [{ id: 'a', name: '<script>alert(1)</script>', template: 'recon', role: 'worker', desired_state: 'running', observed_state: 'pending', last_seen: null, model_calls: 0, model_call_limit: 5 }],
    tasks: [{ id: 't', kind: 'passive-recon', state: 'completed', attempt: 1, result: { note: '<img src=x onerror=alert(1)>' }, error: null, created_at: '2026-01-01T00:00:00Z', completed_at: null }],
    reports: [{ id: 'r', title: 'Synthetic report', markdown: '# Report\n<script>alert(1)</script>\n[link](javascript:alert(1))', scope_hash: 'b'.repeat(64), created_at: '2026-01-01T00:00:00Z' }],
  }
  const html = renderToStaticMarkup(createElement(ProgramProgressView, { progress: fixture }))
  assert.match(html, /running<!-- --> \/ <!-- -->pending|running \/ pending/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /\[link\]\(javascript:alert\(1\)\)/)
  assert.doesNotMatch(html, /<script|<img|href=|onerror="/)
  assert.match(html, /not proof of a running worker/)
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
