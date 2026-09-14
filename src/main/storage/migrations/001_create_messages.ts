import type Database from 'better-sqlite3'
import type { Migration } from './types'

/**
 * `id` is a local SQLite surrogate key, not TDLib's message id - TDLib
 * message ids repeat across chats, so the real identity of a row is
 * `(chat_id, message_id)`, enforced below via UNIQUE and relied on by
 * MessageRepository for both idempotent upserts and findByIds lookups.
 *
 * `is_deleted`/`deleted_at` implement a soft-delete tombstone: TDLib's
 * `updateDeleteMessages` (routed in a later task) carries no message
 * content, so the only way to keep showing a deleted message's original
 * text is to have already stored it here before the delete arrives -
 * markDeleted therefore only ever flips these two columns and never
 * touches `text`.
 */
export const createMessagesMigration: Migration = {
  id: 1,
  name: 'create_messages',
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL,
        sender_id INTEGER NOT NULL,
        text TEXT,
        created_at INTEGER NOT NULL,
        reply_to_message_id INTEGER,
        is_outgoing INTEGER NOT NULL,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        deleted_at INTEGER,
        UNIQUE (chat_id, message_id)
      )
    `)
    db.exec(`CREATE INDEX idx_messages_chat_id_created_at ON messages (chat_id, created_at)`)
  },
}
