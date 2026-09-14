import type Database from 'better-sqlite3'
import type { Attachment, AttachmentType, Message } from '../../shared/models'
import { StorageError } from './storageError'

interface MessageRow {
  chat_id: number
  message_id: number
  sender_id: number
  text: string | null
  created_at: number
  reply_to_message_id: number | null
  is_outgoing: number
  is_deleted: number
  deleted_at: number | null
  attachment_type: string | null
  attachment_file_id: number | null
  attachment_size: number | null
  attachment_file_name: string | null
  attachment_local_path: string | null
}

/**
 * Reassembles `Attachment` from its flat columns - `null` when the row has
 * no attachment (the normal case for text messages), never a partial object.
 */
function rowToAttachment(row: MessageRow): Attachment | undefined {
  if (
    row.attachment_type === null ||
    row.attachment_file_id === null ||
    row.attachment_size === null
  ) {
    return undefined
  }
  return {
    type: row.attachment_type as AttachmentType,
    fileId: row.attachment_file_id,
    size: row.attachment_size,
    fileName: row.attachment_file_name ?? undefined,
    localPath: row.attachment_local_path ?? undefined,
  }
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.message_id,
    chatId: row.chat_id,
    senderId: row.sender_id,
    text: row.text ?? undefined,
    createdAt: row.created_at,
    replyToMessageId: row.reply_to_message_id ?? undefined,
    isOutgoing: Boolean(row.is_outgoing),
    isDeleted: Boolean(row.is_deleted),
    deletedAt: row.deleted_at,
    attachment: rowToAttachment(row),
  }
}

/**
 * Persistence for `Message`, independent of TDLib's own cache. Works only
 * with the shared domain model in `src/shared/models` - callers never see
 * raw SQLite rows.
 */
export class MessageRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Runs one SQLite operation, converting any driver failure (disk full, DB
   * locked/corrupt, constraint violation, etc.) into a `StorageError` - never
   * lets a raw better-sqlite3 error (which can carry SQL text) escape this
   * class. Every public method below goes through this.
   */
  private run<T>(fn: () => T): T {
    try {
      return fn()
    } catch (err) {
      if (err instanceof StorageError) throw err
      throw new StorageError('Local storage operation failed', { cause: err })
    }
  }

  /**
   * Inserts a new message, or updates the mutable content fields of an
   * existing one keyed by `(chatId, id)` - idempotent, never throws on a
   * repeated upsert of the same message.
   *
   * Deliberately does not touch `is_deleted`/`deleted_at` on conflict: a
   * TDLib `message` object is always live (see `shared/models/message.ts`),
   * so re-upserting one must never silently resurrect a message this
   * storage has already tombstoned via `markDeleted`.
   */
  upsertMessage(message: Message): void {
    this.run(() => this.upsertRow(message))
  }

  /**
   * Transitions a message from TDLib's temporary local id (assigned when
   * this client itself sent it, before the server confirmed it - see
   * `sendText`/`updateMessageSendSucceeded` in `realtimeUpdates.ts`) to its
   * final id, without ever leaving both rows present at once.
   *
   * `message.id` is the final id and is assumed to already be `!=
   * oldMessageId` in the expected case; if a row already exists there (a
   * repeat delivery of the same `updateMessageSendSucceeded`, most notably),
   * upserting it is idempotent by construction. Wrapped in one transaction so
   * a crash mid-way can never leave the old row deleted without the new one
   * written, or vice versa.
   *
   * Returns whether a row existed at `oldMessageId` - the same "did this
   * update apply to something we tracked" signal `updateContent`/
   * `markDeleted` already use, so a delivery for a chat/message this storage
   * never saw as pending is a safe no-op rather than an error.
   */
  replaceMessageId(chatId: number, oldMessageId: number, message: Message): boolean {
    return this.run(() => {
      const existed =
        this.db
          .prepare(`SELECT 1 FROM messages WHERE chat_id = @chatId AND message_id = @oldMessageId`)
          .get({ chatId, oldMessageId }) !== undefined

      const applyTransition = this.db.transaction(() => {
        if (existed) {
          this.db
            .prepare(
              `DELETE FROM messages WHERE chat_id = @chatId AND message_id = @oldMessageId AND message_id != @newMessageId`,
            )
            .run({ chatId, oldMessageId, newMessageId: message.id })
        }
        this.upsertRow(message)
      })
      applyTransition()

      return existed
    })
  }

  /**
   * Hard-deletes a row outright - unlike `markDeleted`, this is not a
   * tombstone. Used only to clean up the temporary local row for a message
   * that TDLib reports via `updateMessageSendFailed`: it was never actually
   * sent, so nothing about it should linger (not even as a "deleted"
   * message a future tombstone UI would render).
   *
   * Returns whether a matching row existed, exactly like `markDeleted`.
   */
  deleteMessage(chatId: number, messageId: number): boolean {
    return this.run(() => {
      const result = this.db
        .prepare(`DELETE FROM messages WHERE chat_id = @chatId AND message_id = @messageId`)
        .run({ chatId, messageId })

      return result.changes > 0
    })
  }

  private upsertRow(message: Message): void {
    this.db
      .prepare(
        `
        INSERT INTO messages (
          chat_id, message_id, sender_id, text, created_at, reply_to_message_id, is_outgoing, is_deleted, deleted_at,
          attachment_type, attachment_file_id, attachment_size, attachment_file_name, attachment_local_path
        )
        VALUES (
          @chatId, @messageId, @senderId, @text, @createdAt, @replyToMessageId, @isOutgoing, 0, NULL,
          @attachmentType, @attachmentFileId, @attachmentSize, @attachmentFileName, @attachmentLocalPath
        )
        ON CONFLICT (chat_id, message_id) DO UPDATE SET
          sender_id = excluded.sender_id,
          text = excluded.text,
          created_at = excluded.created_at,
          reply_to_message_id = excluded.reply_to_message_id,
          is_outgoing = excluded.is_outgoing,
          attachment_type = excluded.attachment_type,
          attachment_file_id = excluded.attachment_file_id,
          attachment_size = excluded.attachment_size,
          attachment_file_name = excluded.attachment_file_name,
          attachment_local_path = excluded.attachment_local_path
        `,
      )
      .run({
        chatId: message.chatId,
        messageId: message.id,
        senderId: message.senderId,
        text: message.text ?? null,
        createdAt: message.createdAt,
        replyToMessageId: message.replyToMessageId ?? null,
        isOutgoing: message.isOutgoing ? 1 : 0,
        attachmentType: message.attachment?.type ?? null,
        attachmentFileId: message.attachment?.fileId ?? null,
        attachmentSize: message.attachment?.size ?? null,
        attachmentFileName: message.attachment?.fileName ?? null,
        attachmentLocalPath: message.attachment?.localPath ?? null,
      })
  }

  /**
   * Soft-deletes a message: sets `is_deleted` and, only the first time,
   * `deleted_at` (a repeat call keeps the original deletion timestamp
   * rather than overwriting it, so the operation is idempotent). `text`
   * is never touched - preserving it is the entire point of this table.
   *
   * Returns whether a matching row existed. A missing message is not an
   * error: it just means this storage never saw it before the delete.
   */
  markDeleted(chatId: number, messageId: number, deletedAt: number): boolean {
    return this.run(() => {
      const result = this.db
        .prepare(
          `
          UPDATE messages
          SET is_deleted = 1, deleted_at = COALESCE(deleted_at, @deletedAt)
          WHERE chat_id = @chatId AND message_id = @messageId
          `,
        )
        .run({ chatId, messageId, deletedAt })

      return result.changes > 0
    })
  }

  /**
   * Applies a TDLib `updateMessageContent` edit: only the `text` column
   * changes. `chat_id`/`message_id`/`sender_id`/`created_at` and the
   * deletion state are left untouched, and no row is created if one isn't
   * already there - a content update can never be the first thing this
   * storage learns about a message.
   *
   * Returns whether a matching row existed, exactly like `markDeleted`.
   */
  updateContent(chatId: number, messageId: number, text: string | null): boolean {
    return this.run(() => {
      const result = this.db
        .prepare(
          `
          UPDATE messages
          SET text = @text
          WHERE chat_id = @chatId AND message_id = @messageId
          `,
        )
        .run({ chatId, messageId, text })

      return result.changes > 0
    })
  }

  /** All messages for one chat, oldest first, in a stable total order. */
  getHistory(chatId: number): Message[] {
    return this.run(() => {
      const rows = this.db
        .prepare(
          `SELECT * FROM messages WHERE chat_id = @chatId ORDER BY created_at ASC, message_id ASC`,
        )
        .all({ chatId }) as MessageRow[]

      return rows.map(rowToMessage)
    })
  }

  /**
   * Looks up messages by id within one chat. `chatId` is required because
   * `message_id` alone is not globally unique in this schema - identity is
   * `(chat_id, message_id)`.
   */
  findByIds(chatId: number, messageIds: number[]): Message[] {
    if (messageIds.length === 0) return []

    return this.run(() => {
      const placeholders = messageIds.map(() => '?').join(', ')
      const rows = this.db
        .prepare(
          `SELECT * FROM messages WHERE chat_id = ? AND message_id IN (${placeholders}) ORDER BY created_at ASC, message_id ASC`,
        )
        .all(chatId, ...messageIds) as MessageRow[]

      return rows.map(rowToMessage)
    })
  }

  /**
   * Records that a full TDLib first-page history fetch (`from_message_id:
   * 0`) has completed for `chatId` - the signal `historyService.ts` uses to
   * decide a cache-first `getHistory` can serve this chat from SQLite alone.
   * Idempotent: a repeated call just overwrites `synced_at`.
   */
  markChatHistorySynced(chatId: number, syncedAt: number): void {
    this.run(() =>
      this.db
        .prepare(
          `
          INSERT INTO chat_history_sync (chat_id, synced_at) VALUES (@chatId, @syncedAt)
          ON CONFLICT (chat_id) DO UPDATE SET synced_at = excluded.synced_at
          `,
        )
        .run({ chatId, syncedAt }),
    )
  }

  /** Whether `markChatHistorySynced` has ever been recorded for `chatId`. */
  isChatHistorySynced(chatId: number): boolean {
    return this.run(
      () =>
        this.db
          .prepare(`SELECT 1 FROM chat_history_sync WHERE chat_id = @chatId`)
          .get({ chatId }) !== undefined,
    )
  }
}
