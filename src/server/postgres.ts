import { Pool, type PoolConfig, type PoolClient, type QueryResultRow } from 'pg'
import type { SqlDatabase, SqlStatement, SqlValue } from './database'

/** Translate only unquoted placeholders, not question marks in SQL data/comments. */
export function postgresPlaceholders(sql: string): string {
  let output = ''
  let parameter = 0
  for (let i = 0; i < sql.length;) {
    const ch = sql[i]
    if (ch === "'" || ch === '"') {
      const quote = ch
      const escaped = quote === "'" && i > 0 && /[eE]/.test(sql[i - 1]) && (i === 1 || !/[a-zA-Z0-9_$]/.test(sql[i - 2]))
      const start = i++
      let closed = false
      while (i < sql.length) {
        if (escaped && sql[i] === '\\') { i += 2; continue }
        if (sql[i++] === quote) {
          if (sql[i] === quote) { i++; continue }
          closed = true; break
        }
      }
      if (!closed) throw new Error('Unterminated SQL quote')
      output += sql.slice(start, i)
    } else if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i)
      const stop = end < 0 ? sql.length : end + 1
      output += sql.slice(i, stop); i = stop
    } else if (sql.startsWith('/*', i)) {
      const start = i
      let depth = 1
      i += 2
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2 }
        else if (sql.startsWith('*/', i)) { depth--; i += 2 }
        else i++
      }
      if (depth) throw new Error('Unterminated SQL comment')
      output += sql.slice(start, i)
    } else if (ch === '$') {
      const delimiter = sql.slice(i).match(/^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/)?.[0]
      if (delimiter) {
        const end = sql.indexOf(delimiter, i + delimiter.length)
        if (end < 0) throw new Error('Unterminated SQL dollar quote')
        output += sql.slice(i, end + delimiter.length); i = end + delimiter.length
      } else { output += ch; i++ }
    } else if (ch === '?') { output += `$${++parameter}`; i++ }
    else { output += ch; i++ }
  }
  return output
}

/** Never accept URL-supplied options/search_path, or plaintext off-loopback DB connections. */
export function postgresPoolConfig(connectionString: string, certificateAuthority?: string): PoolConfig {
  let url: URL
  try { url = new URL(connectionString) } catch { throw new Error('Invalid console PostgreSQL connection configuration') }
  const allowed = new Set(['sslmode'])
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.pathname.slice(1) ||
      url.pathname.slice(1).includes('/') || url.hash || [...url.searchParams.keys()].some(key => !allowed.has(key)) || url.searchParams.getAll('sslmode').length > 1) {
    throw new Error('Invalid console PostgreSQL connection configuration')
  }
  const loopback = ['127.0.0.1', '[::1]'].includes(url.hostname)
  const mode = url.searchParams.get('sslmode') || (loopback ? 'disable' : 'verify-full')
  if (!['disable', 'verify-full'].includes(mode) || (mode === 'disable' && !loopback)) {
    throw new Error('Console PostgreSQL requires verified TLS or an explicit loopback tunnel')
  }
  return {
    host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 5432),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)),
    ssl: mode === 'disable' ? false : { rejectUnauthorized: true, ...(certificateAuthority ? { ca: certificateAuthority } : {}) },
    options: '-c search_path=pg_catalog,console,pg_temp -c statement_timeout=20000 -c idle_in_transaction_session_timeout=20000',
    application_name: 'bastet-console', max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000,
  }
}

// Preserve the existing SQLite/D1 repository's JSON text + ISO timestamp boundary.
export function normalizePostgresRow(row: QueryResultRow, fields: readonly { name: string; dataTypeID: number }[] = []): Record<string, SqlValue> {
  const jsonColumns = new Set(fields.filter(field => [114, 3802].includes(field.dataTypeID)).map(field => field.name))
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    value == null ? null : jsonColumns.has(key) ? JSON.stringify(value) : value instanceof Date ? value.toISOString() :
      typeof value === 'boolean' ? Number(value) : typeof value === 'object' ? JSON.stringify(value) : value,
  ]))
}

class PostgresStatement implements SqlStatement {
  constructor(readonly owner: PostgresDatabase, readonly sql: string, readonly values: SqlValue[] = []) {}
  bind(...values: SqlValue[]) { return new PostgresStatement(this.owner, this.sql, values) }
  async first<T>() {
    const result = await this.owner.pool.query(this.sql, this.values)
    return result.rows.length ? normalizePostgresRow(result.rows[0], result.fields) as T : null
  }
  async all<T>() {
    const result = await this.owner.pool.query(this.sql, this.values)
    return { results: result.rows.map(row => normalizePostgresRow(row, result.fields)) as T[] }
  }
  async execute(client: Pool | PoolClient) {
    const result = await client.query(this.sql, this.values)
    return { meta: { changes: result.rowCount ?? 0 } }
  }
  run() { return this.execute(this.owner.pool) }
}

export class PostgresDatabase implements SqlDatabase {
  readonly dialect = 'postgres' as const
  readonly pool: Pool
  constructor(connectionString: string, certificateAuthority?: string) {
    this.pool = new Pool(postgresPoolConfig(connectionString, certificateAuthority))
    this.pool.on('error', () => console.error(JSON.stringify({ event: 'postgres_idle_connection_failed' })))
  }
  prepare(sql: string) { return new PostgresStatement(this, postgresPlaceholders(sql)) }
  async batch(statements: SqlStatement[]) {
    if (statements.some(statement => !(statement instanceof PostgresStatement) || statement.owner !== this)) throw new Error('Invalid batch statement')
    const client = await this.pool.connect()
    let broken = false
    try {
      await client.query('BEGIN')
      const result = []
      for (const statement of statements as PostgresStatement[]) result.push(await statement.execute(client))
      await client.query('COMMIT')
      return result
    } catch (error) {
      try { await client.query('ROLLBACK') } catch { broken = true }
      throw error
    } finally { client.release(broken) }
  }
  async close() { await this.pool.end() }
}
