#!/usr/bin/env node
// This tool never prints records, SQL parameters, provider responses, or tokens.
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

export const DEFAULT_DATABASE = '9dffd0e0-f0fb-4a9d-abe3-ff05ceff59ba'
export const DEFAULT_ACCOUNT = 'b6d1478423f0bb0c0477df387305e46b'
export const TABLES = ['users', 'bastet_nodes', 'scan_results', 'campaigns', 'campaign_members', 'observations', 'findings', 'tasks', 'campaign_messages', 'campaign_activities']
export const JSON_COLUMNS = {
  users: [], bastet_nodes: ['info'], scan_results: ['results'], campaigns: ['hackerone_metadata'], campaign_members: [],
  observations: ['evidence', 'metadata'], findings: ['evidence', 'metadata'], tasks: ['scan_config', 'results', 'metadata'],
  campaign_messages: ['metadata'], campaign_activities: ['activity_data']
}
export class MigrationError extends Error {}
const fail = message => { throw new MigrationError(message) }
const identifier = name => `"${name.replaceAll('"', '""')}"`
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const ddlSql = 'SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type, name'
const appDdl = rows => rows.filter(row => TABLES.includes(row.tbl_name)).map(row => ({
  type: row.type, name: row.name, tbl_name: row.tbl_name, sql: row.sql.trim().replace(/;$/, '')
}))

export function migrationSchema(sql) {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(sql)
    const columns = Object.fromEntries(TABLES.map(table => [table, db.prepare('SELECT * FROM pragma_table_info(?)').all(table)]))
    if (Object.values(columns).some(value => !value.length) || Object.values(columns).flat().length !== 102) fail('Migration must contain the expected 10 tables and 102 columns')
    return { sql, columns, ddl: appDdl(db.prepare(ddlSql).all()) }
  } finally { db.close() }
}

function stableJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) fail('JSON contains an unsafe numeric value; export that JSON column as text')
    return value
  }
  if (Array.isArray(value)) return value.map(stableJson)
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableJson(value[key])]))
  fail('Unsupported JSON value in source data')
}

function normalizeRow(table, row, columns, { stored = false, jsonText = false } = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail(`Invalid row shape for ${table}`)
  if (!equal(Object.keys(row).sort(), columns.map(column => column.name).sort())) fail(`Row columns differ from migration for ${table}`)
  return Object.fromEntries(columns.map(column => {
    const value = row[column.name]
    if (value === null) {
      if (column.notnull) fail(`Null value in required ${table}.${column.name}`)
      return [column.name, null]
    }
    if (JSON_COLUMNS[table].includes(column.name)) {
      try {
        if (stored || jsonText) {
          if (typeof value !== 'string') fail(`Expected JSON text in ${table}.${column.name}`)
          // Validate syntax, but retain the exact text. Parsing and reserializing
          // would round large PostgreSQL numeric values inside JSON documents.
          JSON.parse(value)
          return [column.name, value]
        }
        return [column.name, JSON.stringify(stableJson(value))]
      } catch (error) {
        if (error instanceof MigrationError) throw error
        fail(`Invalid JSON in ${table}.${column.name}`)
      }
    }
    if (table === 'bastet_nodes' && column.name === 'websocket_connection') {
      if (![true, false, 0, 1].includes(value)) fail('Invalid websocket_connection boolean')
      return [column.name, Number(value)]
    }
    if (typeof value !== 'string') fail(`Expected text in ${table}.${column.name}`)
    return [column.name, value]
  }))
}

export async function loadSnapshot(path) {
  if (!(await stat(path)).isDirectory()) return JSON.parse(await readFile(path, 'utf8'))
  const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'))
  if (manifest.format !== 'bastet-supabase-export-v1' || !Array.isArray(manifest.tables) ||
      !equal(manifest.tables.map(entry => entry.table).sort(), [...TABLES].sort())) fail('Unexpected export manifest format or table list')
  if (manifest.schema?.file !== 'schema.json') fail('Unexpected export schema path')
  const schemaContent = await readFile(join(path, 'schema.json'))
  if (createHash('sha256').update(schemaContent).digest('hex') !== manifest.schema.sha256) fail('Export schema hash mismatch')
  const catalog = JSON.parse(schemaContent)
  const tables = {}
  for (const table of TABLES) {
    const entry = manifest.tables.find(candidate => candidate.table === table)
    if (entry.file !== `tables/${table}.json` || entry.jsonFieldsFile !== `tables/${table}.json-fields.json`) fail(`Unexpected export file paths for ${table}`)
    const content = await readFile(join(path, entry.file))
    const jsonContent = await readFile(join(path, entry.jsonFieldsFile))
    if (createHash('sha256').update(content).digest('hex') !== entry.sha256 ||
        createHash('sha256').update(jsonContent).digest('hex') !== entry.jsonFieldsSha256) fail(`Export file hash mismatch for ${table}`)
    const rows = JSON.parse(content)
    const jsonFields = JSON.parse(jsonContent)
    if (!Array.isArray(rows) || !Array.isArray(jsonFields) || rows.length !== Number(entry.rows) || rows.length !== jsonFields.length) fail(`Export row count mismatch for ${table}`)
    tables[table] = rows.map((row, index) => {
      if (!jsonFields[index] || !equal(Object.keys(jsonFields[index]).sort(), [...JSON_COLUMNS[table]].sort())) fail(`JSON fidelity columns differ for ${table}`)
      return { ...row, ...jsonFields[index] }
    })
  }
  return { schema: catalog.columns.map(column => ({ schema_name: 'public', ...column })), tables, json_encoding: 'text' }
}

function tableDigest(rows) {
  const sorted = [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}

export function prepareSnapshot(snapshot, schema) {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.schema)) fail('Export must contain schema catalog and tables')
  if (!snapshot.tables || !equal(Object.keys(snapshot.tables).sort(), [...TABLES].sort())) fail('Export must contain exactly the expected 10 tables')
  const catalogKeys = snapshot.schema.map(column => `${column.table_name}.${column.column_name}`).sort()
  const expectedKeys = TABLES.flatMap(table => schema.columns[table].map(column => `${table}.${column.name}`)).sort()
  if (!equal(catalogKeys, expectedKeys)) fail('Source catalog differs from migration columns')
  for (const table of TABLES) {
    for (const column of schema.columns[table]) {
      const source = snapshot.schema.find(entry => entry.table_name === table && entry.column_name === column.name)
      if (source.schema_name !== 'public' || source.nullable !== !column.notnull) fail(`Source nullability differs for ${table}.${column.name}`)
      const isBoolean = table === 'bastet_nodes' && column.name === 'websocket_connection'
      if (isBoolean ? source.data_type !== 'boolean' : !/^(uuid|text|character varying(?:\(\d+\))?|timestamp with time zone|jsonb)$/.test(source.data_type)) {
        fail(`Unsupported source type for ${table}.${column.name}`)
      }
      if ((source.data_type === 'jsonb') !== JSON_COLUMNS[table].includes(column.name)) fail(`Source JSON mapping differs for ${table}.${column.name}`)
    }
  }
  const tables = {}
  const inserts = []
  const summary = {}
  for (const table of TABLES) {
    if (!Array.isArray(snapshot.tables[table])) fail(`Export rows are missing for ${table}`)
    const columns = schema.columns[table]
    const rows = snapshot.tables[table].map(row => normalizeRow(table, row, columns, { jsonText: snapshot.json_encoding === 'text' }))
    if (new Set(rows.map(row => row.id)).size !== rows.length) fail(`Duplicate primary key in ${table}`)
    tables[table] = rows
    summary[table] = { count: rows.length, sha256: tableDigest(rows) }
    const sql = `INSERT INTO ${identifier(table)} (${columns.map(column => identifier(column.name)).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    for (const row of rows) inserts.push({ sql, params: columns.map(column => row[column.name]) })
  }
  // Validate FK, unique and check constraints locally before any remote write.
  const local = new DatabaseSync(':memory:')
  try {
    local.exec(schema.sql)
    for (const insert of inserts) local.prepare(insert.sql).run(...insert.params)
    if (local.prepare('PRAGMA foreign_key_check').all().length) fail('Source export violates foreign keys')
  } catch (error) {
    if (error instanceof MigrationError) throw error
    fail('Source export violates migration constraints')
  } finally { local.close() }
  // One bounded batch keeps this migration atomic. Do not silently split writes.
  if (inserts.length > 90 || Buffer.byteLength(JSON.stringify(inserts)) > 900000) fail('Export exceeds this atomic import tool limit; use a reviewed bulk migration')
  return { tables, inserts, summary }
}

export async function migrate(snapshot, schema, query, { mode = 'check' } = {}) {
  if (!['check', 'import', 'verify'].includes(mode)) fail('Invalid migration mode')
  const prepared = prepareSnapshot(snapshot, schema)
  const targetDdl = appDdl((await query([{ sql: ddlSql }]))[0].results)
  if (!equal(targetDdl, schema.ddl)) fail('Target schema differs from the checked-in migration; apply the correct migrations first')
  const countStatements = TABLES.map(table => ({ sql: `SELECT COUNT(*) AS count FROM ${identifier(table)}` }))
  const counts = await query(countStatements)
  if (mode !== 'verify' && counts.some(result => result.results[0].count !== 0)) fail('Target contains application data; import refused. Use --verify-only to check an existing import')
  if (mode === 'check') return { mode, ready: true, tables: prepared.summary }
  if (mode === 'import' && prepared.inserts.length) {
    // Recheck emptiness inside the same batch as all INSERTs. A concurrent write
    // makes this deliberately invalid INSERT fail its NOT NULL constraints.
    const occupied = TABLES.map(table => `EXISTS (SELECT 1 FROM ${identifier(table)})`).join(' OR ')
    const guard = { sql: `INSERT INTO users (id, email, name, google_id) SELECT NULL, NULL, NULL, NULL WHERE ${occupied}` }
    await query([guard, ...prepared.inserts])
  }
  const readStatements = TABLES.map(table => ({ sql: `SELECT ${schema.columns[table].map(column => identifier(column.name)).join(', ')} FROM ${identifier(table)} ORDER BY id` }))
  const target = await query([...readStatements, { sql: 'PRAGMA foreign_key_check' }])
  for (let index = 0; index < TABLES.length; index++) {
    const table = TABLES[index]
    const rows = target[index].results.map(row => normalizeRow(table, row, schema.columns[table], { stored: true }))
    if (rows.length !== prepared.summary[table].count || tableDigest(rows) !== prepared.summary[table].sha256) fail(`Verification mismatch in ${table}; do not cut over traffic`)
  }
  if (target[TABLES.length].results.length) fail('Target foreign key check failed; do not cut over traffic')
  return { mode, verified: true, foreign_keys: 'valid', tables: prepared.summary }
}

export function cloudflareQuery({ account, database, token, fetcher = fetch }) {
  if (!/^[a-f0-9]{32}$/.test(account) || !/^[a-f0-9-]{36}$/.test(database)) fail('Invalid Cloudflare account or database ID')
  if (!token) fail('Cloudflare authentication is missing')
  return async batch => {
    let response
    try {
      response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch }),
        signal: AbortSignal.timeout(60000)
      })
    } catch { fail('Cloudflare request failed or timed out; no automatic write retry. Run --verify-only before deciding how to recover') }
    let body
    try { body = await response.json() } catch { fail('Cloudflare returned an unreadable response') }
    if (!response.ok || !body.success || !Array.isArray(body.result) || body.result.length !== batch.length || body.result.some(result => result.success === false || !Array.isArray(result.results))) {
      // Provider errors may echo SQL parameters. Only expose the HTTP status.
      fail(`Cloudflare D1 request failed (HTTP ${response.status}); no values were logged`)
    }
    return body.result
  }
}

async function main(argv) {
  const options = {}
  const switches = new Set(['--import', '--verify-only', '--validate-only'])
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (switches.has(arg)) options[arg] = true
    else if (['--export', '--schema', '--migration', '--account', '--database', '--wrangler-auth'].includes(arg) && argv[index + 1] && !argv[index + 1].startsWith('--')) options[arg] = argv[++index]
    else fail('Unknown argument or missing value')
  }
  if (!options['--export']) fail('Usage: node scripts/import-d1.mjs --export private-export.json [--schema private-catalog.json] [--validate-only | --verify-only | --import] [--wrangler-auth /private/default.toml]')
  if ([...switches].filter(option => options[option]).length > 1) fail('Choose only one migration mode')
  const exported = await loadSnapshot(options['--export'])
  if (options['--schema']) exported.schema = JSON.parse(await readFile(options['--schema'], 'utf8'))
  const schema = migrationSchema(await readFile(options['--migration'] ?? new URL('../migrations/0001_console.sql', import.meta.url), 'utf8'))
  if (options['--validate-only']) {
    console.log(JSON.stringify({ mode: 'validate', valid: true, tables: prepareSnapshot(exported, schema).summary }, null, 2))
    return
  }
  let token = process.env.CLOUDFLARE_API_TOKEN
  if (!token && options['--wrangler-auth']) {
    const config = await readFile(options['--wrangler-auth'], 'utf8')
    token = config.match(/^oauth_token\s*=\s*"([^"\n]+)"/m)?.[1]
  }
  const account = options['--account'] ?? DEFAULT_ACCOUNT
  const database = options['--database'] ?? DEFAULT_DATABASE
  const mode = options['--import'] ? 'import' : options['--verify-only'] ? 'verify' : 'check'
  const report = await migrate(exported, schema, cloudflareQuery({ account, database, token }), { mode })
  console.log(JSON.stringify({ account, database, ...report }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof MigrationError ? error.message : 'Migration failed; private data and error details were not printed')
    process.exitCode = 1
  })
}
