import type Database from 'better-sqlite3'
import type { Migration } from './types'

/**
 * Tracks, per chat, whether this app has ever completed a full TDLib
 * `getChatHistory` first-page fetch (`from_message_id: 0`) for it - the
 * signal Task 15's cache-first `messages.getHistory` needs to tell "the
 * cache holds this chat's real current window" apart from "the cache only
 * has whatever stray messages a realtime update happened to deliver before
 * this chat was ever opened" (realtime updates flow as soon as TDLib is
 * authorized, independent of which chat the user has opened - see
 * `realtimeUpdates.ts`). Presence of a row is the signal; `synced_at` is
 * carried only for diagnostics/logging, never read back to decide
 * freshness (no TTL).
 */
export const addChatHistorySyncMigration: Migration = {
  id: 3,
  name: 'add_chat_history_sync',
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE chat_history_sync (
        chat_id INTEGER PRIMARY KEY,
        synced_at INTEGER NOT NULL
      )
    `)
  },
}
