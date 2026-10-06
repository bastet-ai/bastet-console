import { DatabaseSync } from 'node:sqlite'
import { readFileSync, existsSync, chmodSync } from 'node:fs'
import { createHash } from 'node:crypto'

export function manifest(db) {
  const integrity = db.prepare('PRAGMA integrity_check').all()
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database integrity check failed')
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  return Object.fromEntries(tables.map(({ name }) => {
    const rows = db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
      .map(row => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))))).sort()
    return [name, { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }]
  }))
}

if (process.argv[1]?.endsWith('/import-sqlite.mjs')) {
  const [source, destination] = process.argv.slice(2)
  if (!source || !destination || existsSync(destination)) throw new Error('Usage: import-sqlite.mjs export.sql NEW_DATABASE_PATH (must not exist)')
  process.umask(0o077)
  const db = new DatabaseSync(destination)
  try {
    db.exec(readFileSync(source, 'utf8'))
    db.exec('PRAGMA foreign_keys=ON;')
    console.log(JSON.stringify(manifest(db), null, 2))
  } finally { db.close(); chmodSync(destination, 0o600) }
}
