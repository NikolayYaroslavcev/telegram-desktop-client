import type { Update } from 'tdlib-types'
import type { Chat, Message } from '../../shared/models'
import { describeErrorForLog, logger } from '../logger'
import { extractMessageText, mapTdlibMessageToMessage } from '../tdlib/mappers'
import type { MessageRepository } from '../storage'
import type { IpcEventBroadcaster } from '../ipc'

type RealtimeMessageRepository = Pick<
  MessageRepository,
  | 'upsertMessage'
  | 'updateContent'
  | 'markDeleted'
  | 'findByIds'
  | 'replaceMessageId'
  | 'deleteMessage'
>

type RealtimeEventBroadcaster = Pick<
  IpcEventBroadcaster,
  'newMessage' | 'messageDeleted' | 'messageSendFailed'
>

export interface RealtimeUpdateRouterDeps {
  /** Same private-chat/non-bot boundary check `chats.open` already uses (`TdlibService.getChat`) - not duplicated here. */
  getChat: (chatId: number) => Promise<Chat | null>
  /** `null` while storage hasn't finished starting up - updates are safely dropped, not queued. */
  getMessageRepository: () => RealtimeMessageRepository | null
  eventBroadcaster: RealtimeEventBroadcaster
  now?: () => number
}

function logRealtimeError(
  operation: string,
  err: unknown,
  extra?: { chatId?: number; messageId?: number },
): void {
  logger.error({ operation, ...extra, details: describeErrorForLog(err) })
}

/**
 * Routes real-time TDLib updates into storage + typed IPC events, following
 * the same direction as `historyService.ts`:
 *
 *   TDLib update -> map -> MessageRepository -> IPC event
 *
 * Handles `updateNewMessage`/`updateMessageContent`/`updateDeleteMessages`
 * (Task 11) plus `updateMessageSendSucceeded`/`updateMessageSendFailed`
 * (Task 12, this client's own outgoing sends); every other update kind is
 * ignored. Returns a function that
 * processes updates **one at a time, in call order** - each call is chained
 * onto an internal queue so a slow `getChat` lookup for one update can never
 * let a later update (e.g. a delete for the same message) be applied first.
 * An error in one update is logged and swallowed; it never stops the queue
 * or throws into the caller (`client.on('update', ...)` in `lifecycle.ts`).
 */
export function createRealtimeUpdateRouter(
  deps: RealtimeUpdateRouterDeps,
): (update: Update) => Promise<void> {
  const now = deps.now ?? Date.now
  let queue: Promise<void> = Promise.resolve()

  async function handleNewMessage(message: import('tdlib-types').message): Promise<void> {
    const repository = deps.getMessageRepository()
    if (!repository) return

    let chat: Chat | null
    try {
      chat = await deps.getChat(message.chat_id)
    } catch (err) {
      logRealtimeError('realtime.updateNewMessage:getChat', err, { chatId: message.chat_id })
      return
    }
    if (!chat) return // not a supported private chat - group/channel/bot/unknown

    const mapped = mapTdlibMessageToMessage(message)
    if (!mapped) return // unsupported content, malformed attachment, non-user sender

    try {
      repository.upsertMessage(mapped)
    } catch (err) {
      logRealtimeError('realtime.updateNewMessage:upsert', err, {
        chatId: mapped.chatId,
        messageId: mapped.id,
      })
      return
    }

    // A message this client itself just sent arrives here first under a
    // temporary local id, with `sending_state` set (pending, or - rarely -
    // already failed) - see `TdlibService.sendText`. It is still stored
    // (findByIds/getHistory can already see it), but not broadcast yet: the
    // canonical, final-id version is what `handleMessageSendSucceeded`
    // broadcasts once TDLib confirms it, so emitting `onNewMessage` here too
    // would show the renderer two rows for one message (see
    // docs/tdlib-integration.md). A message that isn't ours (incoming, or
    // already fully sent) never has `sending_state` and is broadcast as before.
    if (message.sending_state) return

    deps.eventBroadcaster.newMessage(mapped)
  }

  /**
   * The server has confirmed a message this client sent - `update.message`
   * carries its final content/id, `update.old_message_id` the temporary id
   * `handleNewMessage` already stored (per `Message.id` docs, TDLib's own
   * `old_message_id` name for this). `MessageRepository.replaceMessageId`
   * does the actual temp -> final transition; this handler only decides
   * whether to broadcast, using its return value as the same "did this apply
   * to something we tracked" signal `handleMessageContent`/
   * `handleDeleteMessages` use - not a redundant `getChat` call.
   */
  async function handleMessageSendSucceeded(
    update: import('tdlib-types').updateMessageSendSucceeded,
  ): Promise<void> {
    const repository = deps.getMessageRepository()
    if (!repository) return

    const mapped = mapTdlibMessageToMessage(update.message)
    if (!mapped) {
      logger.warn({
        operation: 'realtime.updateMessageSendSucceeded:unsupportedContent',
        chatId: update.message.chat_id,
        messageId: update.old_message_id,
      })
      return
    }

    let replaced: boolean
    try {
      replaced = repository.replaceMessageId(update.message.chat_id, update.old_message_id, mapped)
    } catch (err) {
      logRealtimeError('realtime.updateMessageSendSucceeded:persist', err, {
        chatId: mapped.chatId,
        messageId: update.old_message_id,
      })
      return
    }
    // Not found locally: same idempotency/race reasoning as
    // handleMessageContent - safe to ignore.
    if (!replaced) return

    deps.eventBroadcaster.newMessage(mapped)
  }

  /**
   * A message this client sent could not be delivered. It was never really
   * "sent" from the rest of the app's point of view (unlike
   * `updateDeleteMessages`, which tombstones a once-live message), so its
   * temporary local row is hard-deleted, not soft-deleted - see
   * `MessageRepository.deleteMessage`.
   *
   * Task 12.1 closes the gap this left open: the renderer previously had no
   * signal that a send it fired off ever failed. `deleteMessage`'s "did a
   * row exist" return value is reused as the same idempotency guard
   * `handleMessageSendSucceeded`/`handleMessageContent`/
   * `handleDeleteMessages` already use, so a repeated delivery of the same
   * failure (or one for a message never tracked as pending) broadcasts at
   * most once. Order matters: storage cleanup happens first, the IPC event
   * only fires once that has actually completed - see
   * docs/tdlib-integration.md, "Failed sends". The event never carries TDLib's
   * `error` (code/message) or the message text - only which message failed;
   * the raw TDLib error is logged server-side only, never sent to renderer.
   */
  async function handleMessageSendFailed(
    update: import('tdlib-types').updateMessageSendFailed,
  ): Promise<void> {
    const repository = deps.getMessageRepository()
    if (!repository) return

    let existed: boolean
    try {
      existed = repository.deleteMessage(update.message.chat_id, update.old_message_id)
    } catch (err) {
      logRealtimeError('realtime.updateMessageSendFailed:cleanup', err, {
        chatId: update.message.chat_id,
        messageId: update.old_message_id,
      })
      return
    }

    if (existed) {
      deps.eventBroadcaster.messageSendFailed({
        chatId: update.message.chat_id,
        messageId: update.old_message_id,
      })
    }

    // The raw TDLib failure reason (a short protocol code/message, e.g.
    // "PEER_ID_INVALID") is safe to log - never the message text itself, per
    // docs/tdlib-integration.md "Failed sends".
    logger.warn({
      operation: 'realtime.updateMessageSendFailed',
      category: 'tdlib',
      chatId: update.message.chat_id,
      messageId: update.old_message_id,
      details: {
        tdlibErrorCode: update.error.code,
        tdlibErrorMessage: String(update.error.message).slice(0, 300),
      },
    })
  }

  async function handleMessageContent(
    update: import('tdlib-types').updateMessageContent,
  ): Promise<void> {
    const repository = deps.getMessageRepository()
    if (!repository) return

    const text = extractMessageText(update.new_content) ?? null

    let existed: boolean
    try {
      existed = repository.updateContent(update.chat_id, update.message_id, text)
    } catch (err) {
      logRealtimeError('realtime.updateMessageContent:persist', err, {
        chatId: update.chat_id,
        messageId: update.message_id,
      })
      return
    }
    // Not found locally: either not a supported private chat (never
    // upserted in the first place) or a race with history/new-message
    // loading - safe to ignore either way, per this task's idempotency rules.
    if (!existed) return

    let updated: Message | undefined
    try {
      ;[updated] = repository.findByIds(update.chat_id, [update.message_id])
    } catch (err) {
      logRealtimeError('realtime.updateMessageContent:reread', err, {
        chatId: update.chat_id,
        messageId: update.message_id,
      })
      return
    }
    if (!updated) return

    // No dedicated `onMessageUpdated` contract exists, and this task must
    // not invent a new public IPC event. `onNewMessage` already carries a
    // full domain `Message`, so the minimal correct behavior is to re-emit
    // it with the freshly persisted content - see final report.
    deps.eventBroadcaster.newMessage(updated)
  }

  async function handleDeleteMessages(
    update: import('tdlib-types').updateDeleteMessages,
  ): Promise<void> {
    const repository = deps.getMessageRepository()
    if (!repository) return

    // TDLib fires this update for two unrelated reasons - only one of them is
    // an actual deletion. `is_permanent: true` means a user genuinely deleted
    // the message. `is_permanent: false` (typically paired with
    // `from_cache: true`) means TDLib merely evicted it from its own local
    // cache - "can possibly be retrieved again in the future" per TDLib's own
    // doc comment on the field - nothing was deleted by anyone. Tombstoning
    // on a cache eviction would falsely mark live messages as deleted and can
    // never be undone (see `MessageRepository.markDeleted`'s permanence), so
    // only `is_permanent` events reach storage/the renderer at all.
    if (!update.is_permanent) {
      logger.info({
        operation: 'realtime.updateDeleteMessages:cacheEvictionIgnored',
        chatId: update.chat_id,
        details: { messageCount: update.message_ids.length },
      })
      return
    }

    const deletedAt = now()
    for (const messageId of update.message_ids) {
      let existed: boolean
      try {
        existed = repository.markDeleted(update.chat_id, messageId, deletedAt)
      } catch (err) {
        logRealtimeError('realtime.updateDeleteMessages:persist', err, {
          chatId: update.chat_id,
          messageId,
        })
        continue
      }
      // Idempotent by design: a delete for a message this storage never
      // saw (race with a not-yet-applied updateNewMessage, or a filtered
      // chat) is a no-op, not an error - but per Task 16 it must still be
      // observable: without a locally cached original text, no tombstone
      // can be created (there is nothing to preserve), so this is logged
      // rather than silently dropped.
      if (!existed) {
        logger.warn({
          operation: 'realtime.updateDeleteMessages:notFoundLocally',
          chatId: update.chat_id,
          messageId,
        })
        continue
      }

      deps.eventBroadcaster.messageDeleted({ chatId: update.chat_id, messageId, deletedAt })
    }
  }

  async function dispatch(update: Update): Promise<void> {
    try {
      switch (update._) {
        case 'updateNewMessage':
          await handleNewMessage(update.message)
          return
        case 'updateMessageContent':
          await handleMessageContent(update)
          return
        case 'updateDeleteMessages':
          await handleDeleteMessages(update)
          return
        case 'updateMessageSendSucceeded':
          await handleMessageSendSucceeded(update)
          return
        case 'updateMessageSendFailed':
          await handleMessageSendFailed(update)
          return
        default:
          return // unknown/unhandled update kinds are ignored safely
      }
    } catch (err) {
      logger.error({
        operation: 'realtime.dispatch',
        category: update._,
        details: describeErrorForLog(err),
      })
    }
  }

  return (update: Update): Promise<void> => {
    const next = queue.then(() => dispatch(update))
    // Swallow so one update's rejection can't poison the chain for the next
    // caller; `dispatch` itself never rejects, but this stays defensive.
    queue = next.catch(() => undefined)
    return next
  }
}
