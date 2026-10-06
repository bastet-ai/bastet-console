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
import { ProgramProgressView } from '../src/components/ProgramProgress'
import type { ProgramProgress } from '../src/lib/programProgress'

test('progress checks membership before querying the orchestration projection and distinguishes missing/no-run', async () => {
  const queries: string[] = []
  let member = false, available = 0, result: string | null = null
  const db: SqlDatabase = {
    dialect: 'postgres', batch: async () => [],
    prepare(sql) {
      queries.push(sql)
      const statement: SqlStatement = {
        bind: () => statement, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }),
        first: async <T>() => (sql.includes('AS role') ? member ? { role: 'watcher' } : null : sql.includes('AS available') ? { available } : { progress: result }) as T | null,
      }
      return statement
    },
  }
  const repository = new ConsoleDatabase(db)
  assert.equal(await repository.campaignProgress('outsider', 'private-campaign'), null)
  assert.equal(queries.length, 1)
  assert.equal(queries.some(query => query.includes('bastet')), false)
  member = true
  assert.deepEqual(await repository.campaignProgress('owner', 'private-campaign'), { configured: false, progress: null })
  available = 1
  assert.deepEqual(await repository.campaignProgress('owner', 'private-campaign'), { configured: true, progress: null })
  result = JSON.stringify({ run_id: 'synthetic-run', status: 'paused', agents: [], tasks: [], reports: [] })
  assert.equal((await repository.campaignProgress('owner', 'private-campaign'))?.progress?.run_id, 'synthetic-run')
  assert.match(queries.at(-1)!, /SELECT bastet\.console_progress\(\?\)/)
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
    assert.deepEqual(allowed.data, { success: true, configured: false, progress: null })
  } finally { storage.close() }
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
