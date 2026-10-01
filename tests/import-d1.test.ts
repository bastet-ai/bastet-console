import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import {
  migrationSchema, prepareSnapshot, migrate, cloudflareQuery,
  TABLES, JSON_COLUMNS, DEFAULT_ACCOUNT, DEFAULT_DATABASE
} from '../scripts/import-d1.mjs'

const schema = migrationSchema(await readFile(new URL('../migrations/0001_console.sql', import.meta.url), 'utf8'))
const fixture = () => {
  const catalog = TABLES.flatMap(table => schema.columns[table].map(column => ({
    schema_name: 'public', table_name: table, column_name: column.name, nullable: !column.notnull,
    data_type: JSON_COLUMNS[table].includes(column.name) ? 'jsonb' : table === 'bastet_nodes' && column.name === 'websocket_connection' ? 'boolean' : 'text'
  })))
  const tables = Object.fromEntries(TABLES.map(table => [table, []]))
  const row = (table, values) => Object.fromEntries(schema.columns[table].map(column => [column.name, values[column.name] ?? null]))
  tables.users.push(row('users', { id: 'owner', email: 'owner@example.test', name: 'Owner', google_id: 'google-owner', access_token: 'private-fixture-token', created_at: '2025-10-09T03:02:01.123456+00:00' }))
  tables.bastet_nodes.push(row('bastet_nodes', { id: 'node', user_id: 'owner', name: 'Scanner', node_type: 'scanner', status: 'offline', info: '{"nested":{"n":900719925474099312345},"value":null}', websocket_connection: false }))
  tables.campaigns.push(row('campaigns', { id: 'campaign', name: "Quote ' and SQL ; --", owner_id: 'owner', scope: 'example.test', status: 'active', privacy: 'private', hackerone_metadata: 'null' }))
  tables.campaign_members.push(row('campaign_members', { id: 'member', campaign_id: 'campaign', user_id: 'owner', role: 'owner' }))
  return { schema: catalog, tables, json_encoding: 'text' }
}

function target() {
  const db = new DatabaseSync(':memory:')
  db.exec(schema.sql)
  let writes = 0
  const query = async statements => {
    const writesData = statements.some(statement => /^INSERT/i.test(statement.sql))
    if (writesData) writes++
    db.exec('BEGIN')
    try {
      const result = statements.map(statement => ({ success: true, results: db.prepare(statement.sql).all(...(statement.params ?? [])) }))
      db.exec('COMMIT')
      return result
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  return { db, query, writes: () => writes }
}

test('import preserves all fields, JSON precision, JSON null, SQL null and timestamp precision', async () => {
  const source = fixture()
  const { db, query, writes } = target()
  try {
    const preflight = await migrate(source, schema, query)
    assert.equal(preflight.ready, true)
    assert.equal(writes(), 0)
    const report = await migrate(source, schema, query, { mode: 'import' })
    assert.equal(report.verified, true)
    assert.equal(report.foreign_keys, 'valid')
    assert.equal(writes(), 1)
    assert.equal(db.prepare('SELECT info FROM bastet_nodes').get().info, source.tables.bastet_nodes[0].info)
    assert.equal(db.prepare('SELECT websocket_connection FROM bastet_nodes').get().websocket_connection, 0)
    assert.equal(db.prepare('SELECT hackerone_metadata FROM campaigns').get().hackerone_metadata, 'null')
    assert.equal(db.prepare('SELECT created_at FROM users').get().created_at, source.tables.users[0].created_at)
    assert.equal(db.prepare('SELECT refresh_token FROM users').get().refresh_token, null)
    assert.equal((await migrate(source, schema, query, { mode: 'verify' })).verified, true)
    assert.equal(writes(), 1)
    assert.equal(JSON.stringify(report).includes('private-fixture-token'), false)
    assert.equal(JSON.stringify(report).includes('owner@example.test'), false)
  } finally { db.close() }
})

test('nonempty destinations and schema differences refuse import without changing records', async () => {
  const source = fixture()
  const { db, query, writes } = target()
  try {
    await migrate(source, schema, query, { mode: 'import' })
    const before = writes()
    await assert.rejects(migrate(source, schema, query, { mode: 'import' }), /Target contains application data/)
    assert.equal(writes(), before)
    db.exec('ALTER TABLE users ADD COLUMN unexpected TEXT')
    await assert.rejects(migrate(source, schema, query, { mode: 'verify' }), /Target schema differs/)
  } finally { db.close() }
})

test('a destination write between preflight and import triggers atomic refusal', async () => {
  const source = fixture()
  const { db, query } = target()
  let raced = false
  const racingQuery = async statements => {
    if (statements.some(statement => /^INSERT/i.test(statement.sql)) && !raced) {
      raced = true
      db.exec("INSERT INTO users (id, email, name, google_id) VALUES ('concurrent', 'concurrent@example.test', 'Concurrent', 'concurrent-google')")
    }
    return query(statements)
  }
  try {
    await assert.rejects(migrate(source, schema, racingQuery, { mode: 'import' }))
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM campaigns').get().count, 0)
  } finally { db.close() }
})

test('full-row verification detects changed values with unchanged counts and IDs', async () => {
  const source = fixture()
  const { db, query } = target()
  try {
    await migrate(source, schema, query, { mode: 'import' })
    db.exec("UPDATE users SET name = 'Changed'")
    await assert.rejects(migrate(source, schema, query, { mode: 'verify' }), /Verification mismatch in users/)
  } finally { db.close() }
})

test('invalid exports fail before any remote query', async () => {
  let queried = false
  const query = async () => { queried = true; return [] }
  const missingColumn = fixture()
  delete missingColumn.tables.users[0].refresh_token
  await assert.rejects(migrate(missingColumn, schema, query), /Row columns differ/)
  const foreignKey = fixture()
  foreignKey.tables.campaigns[0].owner_id = 'missing'
  await assert.rejects(migrate(foreignKey, schema, query), /violates migration constraints/)
  const badBoolean = fixture()
  badBoolean.tables.bastet_nodes[0].websocket_connection = 'false'
  await assert.rejects(migrate(badBoolean, schema, query), /Invalid websocket_connection/)
  const unknownTable = fixture()
  unknownTable.tables.unknown = []
  await assert.rejects(migrate(unknownTable, schema, query), /expected 10 tables/)
  const badCatalog = fixture()
  badCatalog.schema[0].nullable = true
  await assert.rejects(migrate(badCatalog, schema, query), /nullability differs/)
  assert.equal(queried, false)
})

test('Cloudflare adapter binds values and never exposes provider error text', async () => {
  const source = prepareSnapshot(fixture(), schema)
  const query = cloudflareQuery({
    account: DEFAULT_ACCOUNT, database: DEFAULT_DATABASE, token: 'dummy-api-token',
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body)
      assert.ok(body.batch.every(statement => !statement.sql.includes('private-fixture-token')))
      assert.ok(body.batch.some(statement => statement.params?.includes('private-fixture-token')))
      return Response.json({ success: false, errors: [{ message: 'private-fixture-token' }] }, { status: 400 })
    }
  })
  await assert.rejects(query(source.inserts), error => {
    assert.match(error.message, /HTTP 400/)
    assert.equal(error.message.includes('private-fixture-token'), false)
    assert.equal(error.message.includes('dummy-api-token'), false)
    return true
  })
})
