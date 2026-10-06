import { DatabaseSync } from 'node:sqlite'
import type { SqlDatabase, SqlStatement, SqlValue } from './database'

class Statement implements SqlStatement {
  constructor(readonly owner: SQLiteDatabase, readonly sql: string, readonly values: SqlValue[] = []) {}
  bind(...values: SqlValue[]) { return new Statement(this.owner, this.sql, values) }
  async first<T>() {
    const row = this.owner.connection.prepare(this.sql).get(...this.values)
    return row ? { ...row } as T : null
  }
  async all<T>() { return { results: this.owner.connection.prepare(this.sql).all(...this.values).map(row => ({ ...row })) as T[] } }
  execute() { return { meta: { changes: Number(this.owner.connection.prepare(this.sql).run(...this.values).changes) } } }
  async run() { return this.execute() }
}

export class SQLiteDatabase implements SqlDatabase {
  readonly connection: DatabaseSync
  constructor(path: string) {
    this.connection = new DatabaseSync(path)
    this.connection.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
  }
  prepare(sql: string) { return new Statement(this, sql) }
  async batch(statements: SqlStatement[]) {
    // All operations execute synchronously: no other request can enter this transaction.
    this.connection.exec('BEGIN IMMEDIATE')
    try {
      const results = statements.map(statement => {
        if (!(statement instanceof Statement) || statement.owner !== this) throw new Error('Invalid batch statement')
        return statement.execute()
      })
      this.connection.exec('COMMIT')
      return results
    } catch (error) {
      this.connection.exec('ROLLBACK')
      throw error
    }
  }
  close() { this.connection.close() }
}
