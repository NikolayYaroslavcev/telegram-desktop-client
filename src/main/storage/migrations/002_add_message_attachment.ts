import type Database from 'better-sqlite3'
import type { Migration } from './types'

/**
 * Adds attachment metadata columns to `messages` (Task 14). All nullable -
 * every existing row (and every text message) has none of them set. Mirrors
 * `Attachment` field-for-field; no binary content is ever stored here, only
 * the same small metadata TDLib itself reports (`type`, `fileId`, `size`,
 * optional `fileName`/`localPath`).
 */
export const addMessageAttachmentMigration: Migration = {
  id: 2,
  name: 'add_message_attachment',
  up(db: Database.Database): void {
    db.exec(`ALTER TABLE messages ADD COLUMN attachment_type TEXT`)
    db.exec(`ALTER TABLE messages ADD COLUMN attachment_file_id INTEGER`)
    db.exec(`ALTER TABLE messages ADD COLUMN attachment_size INTEGER`)
    db.exec(`ALTER TABLE messages ADD COLUMN attachment_file_name TEXT`)
    db.exec(`ALTER TABLE messages ADD COLUMN attachment_local_path TEXT`)
  },
}
