import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, beforeEach, test } from 'node:test'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import jwt from 'jsonwebtoken'
import { ConsoleDatabase } from '../src/server/database'
import { authenticatedUser } from '../src/server/auth'
import { SQLiteDatabase } from '../src/server/sqlite'
import { migrationSchema, migrate, TABLES, JSON_COLUMNS } from '../scripts/import-d1.mjs'

let runtime: Miniflare
let binding: D1Database
let db: ConsoleDatabase
let sqlite: SQLiteDatabase | undefined

before(async () => {
  if (process.env.CONSOLE_TEST_SQLITE === '1') {
    sqlite = new SQLiteDatabase(':memory:')
    sqlite.connection.exec(await readFile(new URL('../migrations/0001_console.sql', import.meta.url), 'utf8'))
    binding = Object.assign(sqlite, { exec: async (sql: string) => sqlite!.connection.exec(sql) }) as unknown as D1Database
    db = new ConsoleDatabase(sqlite)
    return
  }
  runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-09-30',
    d1Databases: ['DB']
  }))
  binding = await runtime.getD1Database('DB')
  const schema = await readFile(new URL('../migrations/0001_console.sql', import.meta.url), 'utf8')
  for (const statement of schema.replace(/^--.*$/gm, '').split(';').map(sql => sql.trim()).filter(Boolean)) {
    await binding.prepare(statement).run()
  }
  db = new ConsoleDatabase(binding)
})

after(async () => { await runtime?.dispose(); sqlite?.close() })

beforeEach(async () => {
  await binding.exec('DELETE FROM users;')
  for (const id of ['owner', 'manager', 'watcher', 'outsider']) {
    await binding.prepare(`INSERT INTO users (id, google_id, email, name, access_token, refresh_token)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(id, `google-${id}`, `${id}@example.test`, id, 'private-access-token', 'private-refresh-token').run()
  }
})

test('Google login preserves migrated IDs and private fields while returning only public profile data', async () => {
  const result = await db.signInGoogle({ googleId: 'google-owner', email: 'owner@example.test', name: 'Updated Owner', avatar: null })
  assert.equal(result?.id, 'owner')
  assert.equal(result?.name, 'Updated Owner')
  assert.equal('access_token' in result!, false)
  assert.equal('refresh_token' in (await db.userById('owner'))!, false)
  const raw = await binding.prepare('SELECT access_token, refresh_token FROM users WHERE id = ?').bind('owner').first()
  assert.deepEqual(raw, { access_token: 'private-access-token', refresh_token: 'private-refresh-token' })
  const created = await db.signInGoogle({ googleId: 'new-google-id', email: 'new@example.test', name: 'New User', avatar: 'https://example.test/avatar' })
  assert.match(created!.id, /^[a-f0-9-]{36}$/)
  assert.equal((await db.signInGoogle({ googleId: 'new-google-id', email: 'new@example.test', name: 'New User', avatar: null }))?.id, created!.id)
})

test('node queries enforce ownership and return JSON and boolean data in the existing format', async () => {
  const node = await db.createNode('owner', { name: "scanner'); DROP TABLE users; --", node_type: 'scanner', description: null })
  const nodeId = String(node!.id)
  await binding.prepare('UPDATE bastet_nodes SET info = ?, websocket_connection = 1 WHERE id = ?')
    .bind(JSON.stringify({ capabilities: ['scan'], enabled: true }), nodeId).run()
  assert.deepEqual((await db.node('owner', nodeId))?.info, { capabilities: ['scan'], enabled: true })
  assert.equal((await db.node('owner', nodeId))?.websocket_connection, true)
  assert.equal(await db.node('outsider', nodeId), null)
  assert.deepEqual(await db.nodes('outsider'), [])
  assert.equal(await db.updateNode('outsider', nodeId, { name: 'stolen' }), null)
  assert.equal(await db.deleteNode('outsider', nodeId), false)
  assert.equal((await db.updateNode('owner', nodeId, { status: 'online', description: 'Updated' }))?.status, 'online')
  await binding.prepare("INSERT INTO scan_results (id, node_id, scan_id, results) VALUES ('scan-row', ?, 'scan', '{\"findings\":[]}')").bind(nodeId).run()
  assert.equal(await db.deleteNode('owner', nodeId), true)
  assert.equal(await binding.prepare("SELECT id FROM scan_results WHERE id = 'scan-row'").first(), null)
})

test('campaign creation, owner membership, and activities commit together and roll back together', async () => {
  const campaign = await db.createCampaign('owner', { name: 'Private campaign', scope: 'example.test', hackerone_metadata: { imported: true, count: 2 } })
  const campaignId = String(campaign!.id)
  assert.deepEqual(campaign!.hackerone_metadata, { imported: true, count: 2 })
  assert.equal(await db.campaignRole('owner', campaignId), 'owner')
  assert.equal((await db.members('owner', campaignId))[0].users.email, 'owner@example.test')
  const activities = await db.activities('owner', campaignId, 50, 0)
  assert.deepEqual(activities.map(activity => activity.activity_type).sort(), ['campaign_created', 'member_added'])
  assert.equal(activities.find(activity => activity.activity_type === 'campaign_created')?.activity_data.campaign_name, 'Private campaign')
  await binding.exec("CREATE TRIGGER reject_test_member BEFORE INSERT ON campaign_members BEGIN SELECT RAISE(ABORT, 'test member rejected'); END;")
  try {
    await assert.rejects(db.createCampaign('owner', { name: 'Must roll back', scope: 'example.test' }))
    assert.equal(await binding.prepare("SELECT id FROM campaigns WHERE name = 'Must roll back'").first(), null)
  } finally {
    await binding.exec('DROP TRIGGER reject_test_member;')
  }
})

test('outsiders cannot read, edit, delete, join or fetch activities for a guessed campaign ID', async () => {
  const campaign = await db.createCampaign('owner', { name: 'Hidden', scope: 'example.test', privacy: 'public' })
  const id = String(campaign!.id)
  assert.equal(await db.campaign('outsider', id), null)
  assert.deepEqual(await db.campaigns('outsider'), [])
  assert.deepEqual(await db.members('outsider', id), [])
  assert.deepEqual(await db.activities('outsider', id, 50, 0), [])
  assert.deepEqual(await db.activities('outsider', null, 50, 0), [])
  assert.equal(await db.updateCampaign('outsider', id, { name: 'Taken' }), null)
  assert.equal(await db.deleteCampaign('outsider', id), false)
  assert.equal(await db.addMember('outsider', id, 'outsider', 'owner'), null)
  assert.equal(await db.campaignRole('outsider', id), null)
})

test('membership permissions preserve owner control and prevent manager privilege escalation', async () => {
  const campaign = await db.createCampaign('owner', { name: 'Shared', scope: 'example.test' })
  const id = String(campaign!.id)
  const manager = await db.addMember('owner', id, 'manager', 'manager')
  const watcher = await db.addMember('manager', id, 'watcher', 'watcher')
  const owner = (await db.members('owner', id)).find(member => member.user_id === 'owner')!
  assert.equal(await db.campaignRole('manager', id), 'manager')
  assert.equal((await db.campaigns('manager'))[0].campaign_members[0].role, 'manager')
  assert.equal((await db.updateCampaign('manager', id, { name: 'Updated' }))?.name, 'Updated')
  assert.equal(await db.updateCampaign('watcher', id, { name: 'Wrong' }), null)
  assert.equal(await db.addMember('manager', id, 'outsider', 'owner'), null)
  assert.equal(await db.updateMember('manager', id, String(manager!.id), 'owner'), null)
  assert.equal(await db.updateMember('manager', id, String(owner.id), 'watcher'), null)
  assert.equal(await db.removeMember('manager', id, String(owner.id)), false)
  assert.equal(await db.removeMember('owner', id, String(owner.id)), false)
  assert.equal(await db.deleteCampaign('manager', id), false)
  assert.equal((await db.updateMember('manager', id, String(watcher!.id), 'collaborator'))?.role, 'collaborator')
  assert.equal(await db.removeMember('manager', id, String(watcher!.id)), true)
  assert.equal(await db.campaignRole('watcher', id), null)
  assert.equal((await db.activities('owner', id, 50, 0)).filter(activity => activity.activity_type === 'member_removed').length, 1)
  assert.equal(await db.deleteCampaign('owner', id), true)
  assert.deepEqual(await binding.prepare('SELECT * FROM campaign_members WHERE campaign_id = ?').bind(id).all().then(result => result.results), [])
  assert.deepEqual(await binding.prepare('SELECT * FROM campaign_activities WHERE campaign_id = ?').bind(id).all().then(result => result.results), [])
})

test('existing HS256 sessions still work and missing user IDs, other algorithms and expired sessions fail', () => {
  process.env.JWT_SECRET = 'local-test-only-jwt-secret'
  let status = 200
  const res = { status(code: number) { status = code; return this }, json() { return this } }
  const verify = (token: string) => authenticatedUser({ headers: { authorization: `Bearer ${token}` } } as never, res as never)
  assert.equal(verify(jwt.sign({ userId: 'owner', email: 'owner@example.test', googleId: 'google-owner' }, process.env.JWT_SECRET, { expiresIn: '7d' })), 'owner')
  for (const token of [
    jwt.sign({ email: 'owner@example.test' }, process.env.JWT_SECRET),
    jwt.sign({ userId: 'owner' }, process.env.JWT_SECRET, { algorithm: 'HS384' }),
    jwt.sign({ userId: 'owner' }, process.env.JWT_SECRET, { expiresIn: -1 }),
    'invalid-token'
  ]) {
    assert.equal(verify(token), null)
    assert.equal(status, 401)
  }
})

test('safe importer performs a complete verified import through actual D1 batches', { skip: process.env.CONSOLE_TEST_SQLITE === '1' }, async () => {
  await binding.exec('DELETE FROM users;')
  const schema = migrationSchema(await readFile(new URL('../migrations/0001_console.sql', import.meta.url), 'utf8'))
  const catalog = TABLES.flatMap(table => schema.columns[table].map(column => ({
    schema_name: 'public', table_name: table, column_name: column.name, nullable: !column.notnull,
    data_type: JSON_COLUMNS[table].includes(column.name) ? 'jsonb' : table === 'bastet_nodes' && column.name === 'websocket_connection' ? 'boolean' : 'text'
  })))
  const tables = Object.fromEntries(TABLES.map(table => [table, []]))
  tables.users.push({ id: 'imported', email: 'imported@example.test', name: 'Imported', google_id: 'google-imported',
    access_token: null, refresh_token: null, avatar_url: null, last_login: null, created_at: null, updated_at: null })
  const snapshot = { schema: catalog, tables }
  const query = async statements => binding.batch(statements.map(statement => {
    const prepared = binding.prepare(statement.sql)
    return statement.params ? prepared.bind(...statement.params) : prepared
  }))
  assert.equal((await migrate(snapshot, schema, query, { mode: 'import' })).verified, true)
  assert.equal((await migrate(snapshot, schema, query, { mode: 'verify' })).verified, true)
  await assert.rejects(migrate(snapshot, schema, query, { mode: 'import' }), /Target contains application data/)
})
