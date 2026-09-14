import type Database from 'better-sqlite3'
import { createMessagesMigration } from './001_create_messages'
import { addMessageAttachmentMigration } from './002_add_message_attachment'
import { addChatHistorySyncMigration } from './003_add_chat_history_sync'
import type { Migration } from './types'

export type { Migration } from './types'

/** Explicit, ordered migration list - no filesystem scanning/discovery. */
export const migrations: Migration[] = [
  createMessagesMigration,
  addMessageAttachmentMigration,
  addChatHistorySyncMigration,
]

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)
}

/**
 * Applies every migration in `migrationList` not yet recorded in
 * `schema_migrations`, each in its own transaction so a failing
 * migration can't leave a partially-applied schema behind.
 */
export function runMigrations(
  db: Database.Database,
  migrationList: Migration[] = migrations,
): void {
  ensureMigrationsTable(db)

  const appliedIds = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: number }>).map(
      (row) => row.id,
    ),
  )
  const recordMigration = db.prepare(
    'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
  )

  for (const migration of migrationList) {
    if (appliedIds.has(migration.id)) continue

    const applyMigration = db.transaction(() => {
      migration.up(db)
      recordMigration.run(migration.id, migration.name, new Date().toISOString())
    })
    applyMigration()
  }
}
