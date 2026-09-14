import type { Attachment } from './attachment'

/**
 * Domain message model for a private 1-on-1 chat.
 *
 * `isDeleted`/`deletedAt` exist here (per the project plan) so the future
 * tombstone repository (Task 16) doesn't need a schema change - but nothing
 * in this task ever sets `isDeleted: true`. A TDLib `message` object is by
 * definition a live message; deletion is only ever learned about later via
 * `updateDeleteMessages`, which Task 16 alone is responsible for handling.
 */
export interface Message {
  id: number
  chatId: number
  senderId: number
  /** Plain text - only present for text messages (see mappers/content.ts). */
  text?: string
  createdAt: number
  replyToMessageId?: number
  isOutgoing: boolean
  isDeleted: boolean
  deletedAt: number | null
  attachment?: Attachment
}
