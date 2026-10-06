import { backup, DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export async function snapshotDatabase(source: DatabaseSync, directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const target = join(directory, `console-${new Date().toISOString().replaceAll(':', '-')}-${crypto.randomUUID()}.sqlite`)
  if (existsSync(target)) throw new Error('Backup destination already exists')
  await backup(source, target)
  chmodSync(target, 0o600)
  const restored = new DatabaseSync(target)
  try {
    // Make the snapshot portable as one file, with no WAL/SHM sidecars required.
    restored.exec('PRAGMA journal_mode=DELETE;')
    const result = restored.prepare('PRAGMA integrity_check').all()
    if (result.length !== 1 || result[0].integrity_check !== 'ok' || restored.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Backup validation failed')
  } finally { restored.close() }
  return target
}
