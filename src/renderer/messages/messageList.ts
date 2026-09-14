import type { Message } from '../../shared/models'
import type { MessageDeletedEvent } from '../../shared/ipc'

/**
 * Merges one incoming real-time message into a displayed list: replaces any
 * existing entry with the same `id` (never producing two rows for the same
 * id), then keeps the list ordered the same way
 * `MessageRepository.getHistory` does (oldest first, ties broken by id).
 *
 * Pure and TDLib-agnostic on purpose - it only knows about the domain
 * `Message` shape, so it can live in the renderer without pulling in any
 * business/TDLib logic (see docs/plan.md Task 12, "UI").
 */
export function upsertMessageInList(messages: Message[], incoming: Message): Message[] {
  const next = [...messages.filter((message) => message.id !== incoming.id), incoming]
  next.sort((a, b) => a.createdAt - b.createdAt || a.id - b.id)
  return next
}

/**
 * Merges one older page (Task 20 fix: scroll-up pagination) into an
 * already-loaded list: any id already present is dropped from the incoming
 * page rather than overwriting the current row - the currently loaded copy
 * (which may carry newer info, e.g. a tombstone applied since) always wins
 * over a plain history re-fetch. Order matches `upsertMessageInList` (oldest
 * first, ties broken by id) so both can feed the same rendered list.
 */
export function mergeOlderMessages(current: Message[], older: readonly Message[]): Message[] {
  const existingIds = new Set(current.map((message) => message.id))
  const next = [...current, ...older.filter((message) => !existingIds.has(message.id))]
  next.sort((a, b) => a.createdAt - b.createdAt || a.id - b.id)
  return next
}

/**
 * Applies `events.onMessageDeleted` (Task 16) to an already-loaded message
 * list: turns the matching entry into a tombstone in place, never removing
 * it or touching its `text` - mirroring `MessageRepository.markDeleted`'s
 * own semantics on the main-process side.
 *
 * A message id not present in `messages` (a delete for a chat page this
 * screen hasn't loaded) is a safe no-op, same as `resolveReplyPreview`'s
 * `'unavailable'` case. Already-tombstoned messages are left untouched
 * (first `deletedAt` wins) so a duplicate delivery of the same event can
 * never overwrite it with a later timestamp - the same idempotency
 * `MessageRepository.markDeleted`'s `COALESCE` already guarantees.
 */
export function markMessageDeletedInList(
  messages: Message[],
  event: MessageDeletedEvent,
): Message[] {
  return messages.map((message) => {
    if (message.id !== event.messageId || message.isDeleted) return message
    return { ...message, isDeleted: true, deletedAt: event.deletedAt }
  })
}
