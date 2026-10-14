import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConsoleDatabase, ProgramSyncBlockedError, type SqlDatabase, type SqlStatement, type SqlValue } from '../src/server/database'

// Synthetic transaction adapter: only a successful callback commits its run
// and campaign state. This covers the ordering without a live DB or program.
function fixture(options: {
  hasRun?: boolean; runStatus?: string; progressAvailable?: boolean; controlAvailable?: boolean
  pauseOk?: boolean; updateSucceeds?: boolean; malformedProgress?: boolean
} = {}) {
  const id = 'campaign-fixture', handle = 'synthetic', digest = 'a'.repeat(64)
  const runId = '11111111-1111-4111-8111-111111111111'
  const events: string[] = []
  let committed = { runStatus: options.runStatus ?? 'active', campaignStatus: 'active' }
  const root: SqlDatabase = {
    dialect: 'postgres',
    prepare: () => { throw new Error('Transaction required') },
    batch: async () => { throw new Error('Not used') },
    async transaction<T>(callback: (transaction: SqlDatabase) => Promise<T>) {
      events.push('begin')
      const pending = { ...committed }
      const transaction: SqlDatabase = {
        dialect: 'postgres',
        batch: async () => { throw new Error('Not used') },
        prepare(sql) {
          let values: SqlValue[] = []
          const statement: SqlStatement = {
            bind(...next) { values = next; return statement },
            async first<T>() {
              if (sql.includes('FOR UPDATE')) {
                events.push('campaign-lock')
                return (values[0] === id && values[1] === handle && values[2] === 'owner' && values[4] === digest
                  ? { id } : null) as T | null
              }
              if (sql.includes('AS role')) return { role: 'owner' } as T
              if (sql.includes('AS available')) {
                const available = sql.includes('console_control') ? options.controlAvailable !== false : options.progressAvailable !== false
                return { available: available ? 1 : 0 } as T
              }
              if (sql.includes('bastet.console_progress')) {
                events.push('progress')
                const progress = options.hasRun === false ? null : options.malformedProgress
                  ? { run_id: 'invalid', handle } : { run_id: runId, handle, status: pending.runStatus }
                return { progress: progress === null ? null : JSON.stringify(progress) } as T
              }
              if (sql.includes('bastet.console_control')) {
                events.push('pause')
                const ok = options.pauseOk !== false && ['active', 'paused'].includes(pending.runStatus)
                if (ok) pending.runStatus = 'paused'
                return { result: JSON.stringify({ ok, action: 'pause', status: pending.runStatus }) } as T
              }
              if (sql.startsWith('UPDATE campaigns SET')) {
                events.push('campaign-update')
                if (options.updateSucceeds === false) return null
                pending.campaignStatus = 'paused'
                return { id, name: 'Synthetic', description: null, hackerone_handle: handle,
                  hackerone_metadata: JSON.stringify({ scope_snapshot: { sha256: 'b'.repeat(64) } }),
                  status: pending.campaignStatus } as T
              }
              throw new Error(`Unexpected synthetic SQL: ${sql}`)
            },
            all: async () => ({ results: [] }),
            run: async () => ({ meta: { changes: 0 } }),
          }
          return statement
        },
      }
      try {
        const result = await callback(transaction)
        committed = pending
        events.push('commit')
        return result
      } catch (error) {
        events.push('rollback')
        throw error
      }
    },
  }
  const accept = (actor = 'owner', expectedHandle = handle) => new ConsoleDatabase(root)
    .acceptChangedHackerOneSnapshot(actor, id, expectedHandle, { status: 'paused', scope: 'synthetic.test' }, digest)
  return { accept, events, state: () => committed }
}

test('changed snapshot atomically pauses the linked run before saving campaign metadata', async () => {
  const run = fixture()
  const updated = await run.accept()
  assert.equal(updated?.status, 'paused')
  assert.deepEqual(run.state(), { runStatus: 'paused', campaignStatus: 'paused' })
  assert.ok(run.events.indexOf('campaign-lock') < run.events.indexOf('pause'))
  assert.ok(run.events.indexOf('pause') < run.events.indexOf('campaign-update'))
  assert.equal(run.events.at(-1), 'commit')
})

test('already-paused linked run stays paused; campaign without a run can still accept', async () => {
  for (const options of [{ runStatus: 'paused' }, { hasRun: false }]) {
    const run = fixture(options)
    assert.equal((await run.accept())?.status, 'paused')
    assert.equal(run.state().campaignStatus, 'paused')
    assert.equal(run.state().runStatus, options.runStatus ?? 'active')
    assert.equal(run.events.includes('pause'), options.hasRun !== false)
  }
})

test('changed snapshot acceptance fails closed when run state or control is unavailable', async () => {
  for (const options of [
    { progressAvailable: false }, { controlAvailable: false }, { malformedProgress: true },
    { pauseOk: false }, { runStatus: 'completed' }, { updateSucceeds: false },
  ]) {
    const run = fixture(options)
    await assert.rejects(run.accept(), error => error instanceof ProgramSyncBlockedError)
    assert.deepEqual(run.state(), { runStatus: options.runStatus ?? 'active', campaignStatus: 'active' })
    assert.equal(run.events.at(-1), 'rollback')
  }
})

test('wrong actor or changed program handle cannot pause or update the canonical run', async () => {
  for (const [actor, handle] of [['outsider', 'synthetic'], ['owner', 'other']]) {
    const run = fixture()
    assert.equal(await run.accept(actor, handle), null)
    assert.deepEqual(run.state(), { runStatus: 'active', campaignStatus: 'active' })
    assert.equal(run.events.includes('pause'), false)
    assert.equal(run.events.includes('campaign-update'), false)
  }
})
