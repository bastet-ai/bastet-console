// Private operational importer: never print rows, query parameters or provider errors.
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Pool, type PoolClient } from 'pg'
import { postgresPoolConfig } from '../src/server/postgres'
import { TABLES, JSON_COLUMNS } from './import-d1.mjs'

const dates = new Set(['last_login', 'last_seen', 'hackerone_last_synced', 'due_date', 'created_at', 'updated_at', 'joined_at'])
const quote = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('Unexpected migration identifier')
  return `"${name}"`
}
const hashRows = (rows: Record<string, unknown>[]) => createHash('sha256').update(JSON.stringify(rows.map(row =>
  JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))))
  .sort())).digest('hex')
function expression(table: string, column: string, value: string) {
  if (JSON_COLUMNS[table].includes(column)) return `CAST(${value} AS jsonb)::text`
  if (dates.has(column)) return `to_char(CAST(${value} AS timestamptz) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
  if (table === 'bastet_nodes' && column === 'websocket_connection') return `CAST(${value} AS integer)`
  return `CAST(${value} AS text)`
}

/** Copy a verified offline snapshot into a new/empty console schema, atomically. */
export async function importPostgres(sourcePath: string, client: PoolClient) {
  const file = statSync(sourcePath)
  if (!file.isFile() || (file.mode & 0o077)) throw new Error('SQLite snapshot must be a private mode-600 regular file')
  const source = new DatabaseSync(sourcePath, { readOnly: true })
  try {
    const integrity = source.prepare('PRAGMA integrity_check').all()
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || source.prepare('PRAGMA foreign_key_check').all().length) throw new Error('SQLite snapshot failed integrity verification')
    const sourceTables = source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => String(row.name))
    if (TABLES.some((table: string) => !sourceTables.includes(table)) || sourceTables.some(table => !TABLES.includes(table) && table !== 'd1_migrations')) throw new Error('SQLite snapshot contains an unexpected table set')
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
    try {
      const schemaExists = (await client.query("SELECT 1 FROM pg_namespace WHERE nspname = 'console'")).rowCount
      if (!schemaExists) {
        const migration = readFileSync(new URL('../migrations/postgres/0001_console.sql', import.meta.url), 'utf8').replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '')
        await client.query(migration)
      }
      const targetTables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'console'")).rows.map(row => row.tablename).sort()
      if (JSON.stringify(targetTables) !== JSON.stringify([...TABLES].sort())) throw new Error('PostgreSQL console schema differs from the migration')
      await client.query(`LOCK TABLE ${TABLES.map((table: string) => `console.${quote(table)}`).join(', ')} IN ACCESS EXCLUSIVE MODE`)
      for (const table of TABLES) {
        if ((await client.query(`SELECT 1 FROM console.${quote(table)} LIMIT 1`)).rowCount) throw new Error('Target console schema is not empty; no data was imported')
      }
      const manifest: Record<string, { count: number; sha256: string }> = {}
      for (const table of TABLES) {
        const columns = source.prepare(`PRAGMA table_info(${quote(table)})`).all().map(row => String(row.name))
        const targetColumns = (await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'console' AND table_name = $1 ORDER BY ordinal_position", [table])).rows.map(row => row.column_name)
        if (JSON.stringify(columns) !== JSON.stringify(targetColumns)) throw new Error('Source and target column sets differ')
        const rows = source.prepare(`SELECT * FROM ${quote(table)}`).all()
        const canonical: Record<string, unknown>[] = []
        for (const row of rows) {
          const values = columns.map(column => row[column])
          // Raw JSON text goes directly to PostgreSQL; never parse/re-serialize
          // it through JS numbers, which could round large JSON numeric values.
          await client.query(`INSERT INTO console.${quote(table)} (${columns.map(quote).join(', ')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`, values)
          canonical.push((await client.query(`SELECT ${columns.map((column, index) => `${expression(table, column, `$${index + 1}`)} AS ${quote(column)}`).join(', ')}`, values)).rows[0])
        }
        const stored = (await client.query(`SELECT ${columns.map(column => `${expression(table, column, quote(column))} AS ${quote(column)}`).join(', ')} FROM console.${quote(table)}`)).rows
        const sourceHash = hashRows(canonical)
        if (stored.length !== rows.length || hashRows(stored) !== sourceHash) throw new Error('PostgreSQL row manifest differs from SQLite snapshot')
        manifest[table] = { count: rows.length, sha256: sourceHash }
      }
      await client.query('COMMIT')
      return { verified: true, manifest, preservedSourceMetadataTables: sourceTables.filter(table => !TABLES.includes(table)) }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  } finally { source.close() }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [sourcePath] = process.argv.slice(2)
  if (!sourcePath || !process.env.CONSOLE_DATABASE_URL) {
    console.error('Usage: protected CONSOLE_DATABASE_URL environment + import-postgres.ts PRIVATE_SQLITE_SNAPSHOT')
    process.exitCode = 1
  } else {
    const pool = new Pool(postgresPoolConfig(process.env.CONSOLE_DATABASE_URL,
      process.env.CONSOLE_POSTGRES_CA_FILE ? readFileSync(process.env.CONSOLE_POSTGRES_CA_FILE, 'utf8') : undefined))
    let client: PoolClient | undefined
    try {
      client = await pool.connect()
      console.log(JSON.stringify(await importPostgres(sourcePath, client)))
    } catch {
      console.error(JSON.stringify({ event: 'console_postgres_import_failed', noPrivateDataLogged: true }))
      process.exitCode = 1
    } finally { client?.release(); await pool.end() }
  }
}
