import assert from 'node:assert/strict'
import { readFile, mkdtemp, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { once } from 'node:events'
import { test } from 'node:test'
import jwt from 'jsonwebtoken'
import { PostgresDatabase, normalizePostgresRow, postgresPlaceholders, postgresPoolConfig } from '../src/server/postgres'
import { ConsoleDatabase } from '../src/server/database'
import { createApiServer } from '../src/server/api-server'
import { debugMiddleware } from '../scripts/local-debug'
import { importPostgres } from '../scripts/import-postgres'

const testUrl = process.env.CONSOLE_TEST_POSTGRES_URL

test('PostgreSQL placeholders preserve quoted strings, identifiers, dollar bodies and nested comments', () => {
  const sql = "SELECT ?, '?', 'it''s ?', \"why?\", $$?$$, $body$?$body$, E'escaped\\\'?x', ? -- ?\n/* ? /* nested? */ ? */ WHERE id = ?"
  assert.equal(postgresPlaceholders(sql), "SELECT $1, '?', 'it''s ?', \"why?\", $$?$$, $body$?$body$, E'escaped\\\'?x', $2 -- ?\n/* ? /* nested? */ ? */ WHERE id = $3")
  for (const malformed of ["SELECT 'oops", 'SELECT "oops', 'SELECT $$oops', 'SELECT /* nope']) assert.throws(() => postgresPlaceholders(malformed))
})

test('protected PostgreSQL importer preserves complete rows and refuses a populated target', { skip: !testUrl }, async () => {
  const config = postgresPoolConfig(testUrl!)
  assert.equal(config.database, 'console_test')
  assert.ok(['127.0.0.1', '::1'].includes(config.host!))
  const directory = await mkdtemp(join(tmpdir(), 'console-postgres-import-'))
  const sourcePath = join(directory, 'fixture.sqlite')
  const sqlite = new DatabaseSync(sourcePath)
  sqlite.exec(await readFile('migrations/0001_console.sql', 'utf8'))
  sqlite.exec("INSERT INTO users (id, google_id, email, name) VALUES ('fixture', 'google-fixture', 'fixture@example.test', 'Fixture'); CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT);")
  sqlite.prepare('INSERT INTO campaigns (id, name, scope, owner_id, hackerone_metadata) VALUES (?, ?, ?, ?, ?)')
    .run('fixture-campaign', 'Synthetic migration', 'example.test', 'fixture', '{"scope_snapshot":{"sha256":"synthetic"},"precise":9007199254740993}')
  sqlite.close(); await chmod(sourcePath, 0o600)
  const storage = new PostgresDatabase(testUrl!)
  const client = await storage.pool.connect()
  let imported = false
  try {
    const result = await importPostgres(sourcePath, client)
    imported = true
    assert.equal(result.verified, true)
    assert.equal(result.manifest.campaigns.count, 1)
    assert.deepEqual(result.preservedSourceMetadataTables, ['d1_migrations'])
    assert.equal((await client.query("SELECT hackerone_metadata->>'precise' AS precise FROM console.campaigns")).rows[0].precise, '9007199254740993')
    await assert.rejects(importPostgres(sourcePath, client), /not empty/)
    assert.equal((await client.query('SELECT count(*) FROM console.campaigns')).rows[0].count, '1')
  } finally {
    if (imported) await client.query('DROP SCHEMA console CASCADE')
    client.release(); await storage.close(); await rm(directory, { recursive: true, force: true })
  }
})

test('PostgreSQL config pins schema/options and only permits verified TLS or literal loopback plaintext', () => {
  const local = postgresPoolConfig('postgresql://example:synthetic%40password@127.0.0.1:55432/console_test?sslmode=disable')
  assert.equal(local.password, 'synthetic@password')
  assert.equal(local.ssl, false)
  assert.match(local.options!, /search_path=pg_catalog,console/)
  assert.deepEqual(postgresPoolConfig('postgres://example:synthetic@database.example.test/console_test').ssl, { rejectUnauthorized: true })
  assert.deepEqual(postgresPoolConfig('postgres://example:synthetic@database.example.test/console_test', 'synthetic-ca').ssl, { rejectUnauthorized: true, ca: 'synthetic-ca' })
  for (const url of ['postgres://example@database.example.test/db?sslmode=disable', 'postgres://example@localhost/db?sslmode=disable', 'postgres://example@127.0.0.1/db?options=-c%20search_path=public', 'postgres://example@127.0.0.1/db?sslmode=disable&sslmode=verify-full', 'https://example.test/db', 'not-a-url']) {
    assert.throws(() => postgresPoolConfig(url))
  }
  assert.deepEqual(normalizePostgresRow({ when: new Date('2026-10-01T00:00:00Z'), data: { allowed: false }, flag: true, nullable: null }), {
    when: '2026-10-01T00:00:00.000Z', data: '{"allowed":false}', flag: 1, nullable: null,
  })
  assert.deepEqual(normalizePostgresRow({ value: 'text' }, [{ name: 'value', dataTypeID: 3802 }]), { value: '"text"' })
})

test('local debug accepts a literal loopback API but rejects plaintext external backends', () => {
  const settings = { CONSOLE_SERVICE_KEY: 'synthetic-service', CONSOLE_DEBUG_KEY: 'synthetic-debug' }
  assert.doesNotThrow(() => debugMiddleware({ ...settings, CONSOLE_API_ORIGIN: 'http://127.0.0.1:3000' }, 5173))
  for (const origin of ['http://public.example.test', 'http://127.0.0.1.evil.test', 'http://localhost', 'http://user:pass@127.0.0.1', 'http://127.0.0.1#fragment']) {
    assert.throws(() => debugMiddleware({ ...settings, CONSOLE_API_ORIGIN: origin }, 5173))
  }
})

test('real PostgreSQL preserves tenant ACLs, rollback, null-safe CAS, JSON and local HTTP behavior', { skip: !testUrl }, async () => {
  // This suite creates a fresh schema. Never point it at an existing application DB.
  const config = postgresPoolConfig(testUrl!)
  assert.equal(config.database, 'console_test', 'Use only the disposable console_test database')
  assert.ok(['127.0.0.1', '::1'].includes(config.host!))
  const storage = new PostgresDatabase(testUrl!)
  let createdSchema = false
  let createdProgressSchema = false
  try {
    await storage.pool.query(await readFile('migrations/postgres/0001_console.sql', 'utf8'))
    createdSchema = true
    for (const user of ['owner', 'manager', 'watcher', 'outsider']) {
      await storage.prepare('INSERT INTO users (id, google_id, email, name, access_token) VALUES (?, ?, ?, ?, ?)')
        .bind(user, `google-${user}`, `${user}@example.test`, user, 'synthetic-private-token').run()
    }
    const db = new ConsoleDatabase(storage)
    assert.deepEqual(await storage.prepare("SELECT '\"scalar\"'::jsonb AS value, 'true'::jsonb AS flag").first(), { value: '"scalar"', flag: 'true' })
    assert.equal((await db.signInGoogle({ googleId: 'google-owner', email: 'owner@example.test', name: 'Owner', avatar: null }))?.id, 'owner')
    assert.equal('access_token' in (await db.userById('owner'))!, false)
    assert.match((await db.userById('owner'))!.created_at, /^\d{4}-.*Z$/)
    const initialDigest = 'a'.repeat(64)
    const campaign = (await db.createCampaign('owner', { name: 'Synthetic program', scope: '*.example.test', privacy: 'private', status: 'paused',
      hackerone_metadata: { scope_snapshot: { sha256: initialDigest, policy: 'Synthetic policy', assets: [], exclusions: [] } } }))!
    const id = campaign.id
    assert.equal(campaign.status, 'paused')
    assert.equal(campaign.hackerone_metadata.scope_snapshot.sha256, initialDigest)
    assert.equal(await db.campaign('outsider', id), null)
    assert.equal(await db.campaignProgress('outsider', id), null)
    assert.deepEqual(await db.campaignProgress('owner', id), { configured: false, progress: null })
    await storage.pool.query('CREATE SCHEMA bastet')
    createdProgressSchema = true
    await storage.pool.query("CREATE FUNCTION bastet.console_progress(text) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('run_id', 'synthetic-run', 'status', 'paused', 'campaign', $1, 'agents', '[]'::jsonb, 'tasks', '[]'::jsonb, 'reports', '[]'::jsonb) $$")
    assert.equal((await db.campaignProgress('owner', id))?.progress?.run_id, 'synthetic-run')
    assert.equal(await db.updateCampaign('outsider', id, { name: 'Denied' }), null)
    assert.deepEqual(await db.activities('outsider', null, 20, 0), [])
    assert.equal((await db.activities('owner', null, 20, 0)).length, 2)
    const manager = (await db.addMember('owner', id, 'manager', 'manager'))!
    const watcher = (await db.addMember('manager', id, 'watcher', 'watcher'))!
    assert.equal(await db.addMember('manager', id, 'outsider', 'owner'), null)
    assert.equal(await db.updateMember('manager', id, manager.id, 'owner'), null)
    assert.equal((await db.updateMember('manager', id, watcher.id, 'collaborator'))?.role, 'collaborator')
    assert.equal(await db.deleteCampaign('manager', id), false)
    assert.equal(await db.removeMember('manager', id, watcher.id), true)
    const results = await Promise.all(['b', 'c'].map(char => db.updateCampaign('owner', id, {
      hackerone_metadata: { scope_snapshot: { sha256: char.repeat(64) } }, status: 'paused',
    }, initialDigest)))
    assert.equal(results.filter(Boolean).length, 1, 'Only one concurrent scope refresh may commit')
    assert.equal(await db.updateCampaign('owner', id, { name: 'Stale' }, initialDigest), null)
    const legacy = (await db.createCampaign('owner', { name: 'Legacy', scope: 'example.test' }))!
    assert.equal((await db.updateCampaign('owner', legacy.id, { name: 'Legacy refreshed' }, null))?.name, 'Legacy refreshed')
    await storage.pool.query("ALTER TABLE console.campaign_members ADD CONSTRAINT reject_fixture_owner CHECK (role != 'owner') NOT VALID")
    try {
      await assert.rejects(db.createCampaign('owner', { name: 'Must roll back', scope: 'example.test' }))
      assert.equal(await storage.prepare("SELECT id FROM campaigns WHERE name = 'Must roll back'").first(), null)
    } finally { await storage.pool.query('ALTER TABLE console.campaign_members DROP CONSTRAINT reject_fixture_owner') }
    const node = (await db.createNode('owner', { name: 'Synthetic node', node_type: 'scanner', description: null }))!
    await storage.prepare('UPDATE bastet_nodes SET info = ?, websocket_connection = 1 WHERE id = ?').bind('{"test":true}', node.id).run()
    assert.deepEqual((await db.node('owner', node.id))?.info, { test: true })
    assert.equal((await db.node('owner', node.id))?.websocket_connection, true)
    assert.equal(await db.node('outsider', node.id), null)

    const originalJwt = process.env.JWT_SECRET
    process.env.JWT_SECRET = 'synthetic-postgres-http-secret'
    const serviceKey = 'synthetic-service-'.repeat(4), debugKey = 'synthetic-debug-'.repeat(4)
    const server = createApiServer({ database: db, serviceKey, debugKey, debugUserId: 'owner', storageLabel: 'postgres' })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    try {
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
      const ownerHeaders = { 'x-console-service-key': serviceKey, authorization: `Bearer ${jwt.sign({ userId: 'owner' }, process.env.JWT_SECRET)}` }
      assert.equal((await fetch(`${origin}/api/campaigns/${id}`)).status, 401)
      assert.equal((await fetch(`${origin}/api/campaigns/${id}`, { headers: ownerHeaders })).status, 200)
      const outsiderHeaders = { ...ownerHeaders, authorization: `Bearer ${jwt.sign({ userId: 'outsider' }, process.env.JWT_SECRET)}` }
      assert.equal((await fetch(`${origin}/api/campaigns/${id}`, { headers: outsiderHeaders })).status, 403)
      assert.equal((await fetch(`${origin}/api/campaigns/${id}/progress`, { headers: outsiderHeaders })).status, 403)
      const progress = await fetch(`${origin}/api/campaigns/${id}/progress`, { headers: ownerHeaders })
      assert.equal(progress.status, 200)
      assert.equal(progress.headers.get('cache-control'), 'no-store')
      assert.equal((await progress.json()).progress.run_id, 'synthetic-run')
      assert.equal((await (await fetch(`${origin}/health`, { headers: ownerHeaders })).json()).storage, 'postgres')
      assert.equal((await fetch(`${origin}/api/auth/verify`, { headers: { 'x-console-service-key': serviceKey, 'x-console-debug-key': debugKey } })).status, 200)
    } finally {
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
      if (originalJwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalJwt
    }
  } finally {
    if (createdProgressSchema) await storage.pool.query('DROP SCHEMA bastet CASCADE')
    if (createdSchema) await storage.pool.query('DROP SCHEMA console CASCADE')
    await storage.close()
  }
})
