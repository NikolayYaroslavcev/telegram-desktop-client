import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { runMigrations } from './migrations'
import { StorageError } from './storageError'

/**
 * Local storage lives under Electron's userData directory - outside the
 * repository, outside dist/out/release - in its own `storage` subfolder,
 * kept separate from `<userData>/tdlib` (TDLib's own database) since this
 * cache is deliberately independent of it.
 */
export function resolveStorageDatabasePath(userDataPath: string): string {
  return path.join(userDataPath, 'storage', 'app.db')
}

/**
 * Opens (creating if necessary) the local SQLite database at `dbPath` and
 * brings it up to the latest schema. Returns a single connection owned by
 * the caller, who is responsible for closing it via `closeDatabase` -
 * this module holds no module-level/singleton connection itself.
 */
export function openDatabase(dbPath: string): Database.Database {
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })

    const db = new Database(dbPath)

    // WAL + synchronous=NORMAL is the standard desktop-app tradeoff: the
    // UI thread's reads never block on the writer, and a crash can only
    // lose the last not-yet-checkpointed commit rather than corrupt the
    // database (unlike synchronous=OFF).
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = ON')

    runMigrations(db)

    return db
  } catch (err) {
    throw new StorageError('Failed to open the local database', { cause: err })
  }
}

export function closeDatabase(db: Database.Database): void {
  db.close()
}
