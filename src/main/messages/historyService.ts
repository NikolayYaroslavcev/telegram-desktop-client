import type { Message } from '../../shared/models'
import { describeErrorForLog, logger } from '../logger'
import { mapTdlibMessageToMessage } from '../tdlib/mappers'
import type { TdlibService } from '../tdlib'
import type { MessageRepository } from '../storage'

/** Cache read/sync-state failures are expected (Task 15's safe-fallback path), so `warn`, not `error`. */
function logCacheFallback(operation: string, chatId: number, err?: unknown): void {
  const described = err !== undefined ? describeErrorForLog(err) : undefined
  logger.warn({
    operation,
    category: 'cache-fallback',
    chatId,
    details: described ? { message: described.message } : undefined,
  })
}

function logHistoryInfo(
  operation: string,
  chatId: number,
  extra?: Record<string, string | number | boolean>,
): void {
  logger.info({ operation, chatId, details: extra })
}

/**
 * Orchestrates one `messages.getHistory` page: fetches raw TDLib history via
 * `TdlibService.getChatHistory`, then for every message, in order:
 *
 *   TDLib message -> mapTdlibMessageToMessage -> repository.upsertMessage()
 *
 * Each successfully mapped message is written to `MessageRepository`
 * immediately, before the next raw message is even mapped - never collected
 * into a plain array first and persisted in a later, separate pass. This
 * matters for Task 16's future tombstone handling: a message must already
 * be in storage before any later delete/update event for it can be applied.
 *
 * A message the mapper rejects (unsupported content, malformed attachment,
 * non-user sender) is skipped - it is never persisted and never appears in
 * the returned list, but does not fail the rest of the page.
 *
 * The returned array preserves TDLib's own order (decreasing message id).
 */
export async function loadChatHistoryPage(
  tdlibService: Pick<TdlibService, 'getChatHistory'>,
  repository: Pick<MessageRepository, 'upsertMessage'>,
  chatId: number,
  fromMessageId: number,
): Promise<Message[]> {
  const rawMessages = await tdlibService.getChatHistory(chatId, fromMessageId)

  const messages: Message[] = []
  for (const raw of rawMessages) {
    const mapped = mapTdlibMessageToMessage(raw)
    if (mapped === null) continue
    repository.upsertMessage(mapped)
    messages.push(mapped)
  }
  return messages
}

export type ChatHistoryRepository = Pick<
  MessageRepository,
  'upsertMessage' | 'getHistory' | 'isChatHistorySynced' | 'markChatHistorySynced'
>

export function readCachedHistory(
  repository: Pick<ChatHistoryRepository, 'getHistory'>,
  chatId: number,
): Message[] | null {
  try {
    // repository.getHistory is oldest-first; reversed to match the
    // newest-first order loadChatHistoryPage/TDLib itself returns, which
    // messages.getHistory callers (MessageScreen.tsx) already depend on.
    return [...repository.getHistory(chatId)].reverse()
  } catch (err) {
    logCacheFallback('messages.getHistory:cacheRead', chatId, err)
    return null
  }
}

/**
 * The cache-hit check for `messages.getHistory`'s first page (`fromMessageId
 * === 0`): returns the cached rows (newest-first, matching TDLib's own
 * order) when `isChatHistorySynced(chatId)` is true - i.e. a full first-page
 * TDLib fetch has completed for this chat before - and `null` otherwise
 * (never synced, or a cache read failed). A chat is deliberately *not*
 * considered synced just because it has some rows: a realtime
 * `updateNewMessage` can populate a single row for a chat the user has never
 * opened (realtime updates flow as soon as TDLib is authorized, independent
 * of which chat is open - see `realtimeUpdates.ts`), and treating that as
 * "cache is sufficient" would show only that one message and never backfill
 * the rest of the chat's history.
 *
 * Exported so `messagesHandlers.ts` can try this fast path before even
 * requiring a `TdlibService` to exist - a cache hit must not depend on TDLib
 * being reachable - and reused identically by `loadChatHistory` below, so
 * there is exactly one place this decision is made.
 */
export function tryServeChatHistoryFromCache(
  repository: Pick<ChatHistoryRepository, 'getHistory' | 'isChatHistorySynced'>,
  chatId: number,
): Message[] | null {
  let synced = false
  try {
    synced = repository.isChatHistorySynced(chatId)
  } catch (err) {
    logCacheFallback('messages.getHistory:cacheSyncState', chatId, err)
    return null
  }
  if (!synced) return null

  const cached = readCachedHistory(repository, chatId)
  if (cached !== null) {
    logHistoryInfo('messages.getHistory:cacheHit', chatId, { count: cached.length })
  }
  return cached
}

/**
 * Cache-first entry point for `messages.getHistory` (Task 15). Only the
 * "first page" cursor (`fromMessageId === 0`, TDLib's own sentinel for
 * "start from the newest message" - also the only way any current UI calls
 * this, see MessageScreen.tsx) is cache-aware, via `tryServeChatHistoryFromCache`
 * above. An explicit pagination cursor (`fromMessageId !== 0`) always goes
 * straight to TDLib via `loadChatHistoryPage`, unchanged from Task 10 - the
 * cache has no reliable way to know whether it already holds "everything
 * older than this id" without a TDLib round trip anyway, and Task 15
 * explicitly must not change that contract.
 *
 * For `fromMessageId === 0`:
 * - **Cache miss**: fetch via `loadChatHistoryPage` (upserts as it goes,
 *   same as before Task 15), then record the chat as synced so the next
 *   call can be served from cache alone.
 * - **TDLib fetch fails and the chat already has cached rows**: serve
 *   those instead of raising - a temporarily unreachable TDLib must not
 *   blank out a chat with offline-available data. (Full reconnect/offline
 *   handling is Task 17, out of scope here.)
 */
export async function loadChatHistory(
  tdlibService: Pick<TdlibService, 'getChatHistory'>,
  repository: ChatHistoryRepository,
  chatId: number,
  fromMessageId: number,
): Promise<Message[]> {
  const isFirstPage = fromMessageId === 0

  if (isFirstPage) {
    const cached = tryServeChatHistoryFromCache(repository, chatId)
    if (cached !== null) return cached
  }

  try {
    const page = await loadChatHistoryPage(tdlibService, repository, chatId, fromMessageId)
    if (isFirstPage) {
      try {
        repository.markChatHistorySynced(chatId, Date.now())
      } catch (err) {
        logCacheFallback('messages.getHistory:markSynced', chatId, err)
      }
    }
    logHistoryInfo('messages.getHistory:tdlibFetch', chatId, { fromMessageId, count: page.length })
    return page
  } catch (err) {
    if (isFirstPage) {
      const cached = readCachedHistory(repository, chatId)
      if (cached !== null && cached.length > 0) {
        logger.warn({
          operation: 'messages.getHistory:tdlibFallback',
          category: 'cache-fallback',
          chatId,
          details: { count: cached.length, ...describeErrorForLog(err) },
        })
        return cached
      }
    }
    throw err
  }
}

/**
 * Reconnect recovery (Task 17): re-fetches the open chat's first page
 * straight from TDLib - deliberately bypassing `tryServeChatHistoryFromCache`
 * - and upserts it via the same `loadChatHistoryPage` pagination already uses,
 * so any message missed while offline is caught up without a second
 * synchronization mechanism. Only ever called for the chat currently open in
 * the renderer (see `messagesHandlers.ts`'s `forceRefresh` argument) - closed
 * chats are left to the existing realtime-update + cache-first read path,
 * per this task's "no mass resync" constraint.
 *
 * Returns the freshly-read cache, not `loadChatHistoryPage`'s own return
 * value: every raw TDLib `message` maps to `isDeleted: false` (see
 * `mapTdlibMessageToMessage`), which would resurrect an already-tombstoned
 * message in the renderer if handed back directly. Re-reading from storage
 * guarantees the response reflects `MessageRepository`'s protected
 * `is_deleted`/`deleted_at` state instead - the same values a normal
 * cache-hit read would already return.
 */
export async function refreshChatHistory(
  tdlibService: Pick<TdlibService, 'getChatHistory'>,
  repository: ChatHistoryRepository,
  chatId: number,
): Promise<Message[]> {
  const page = await loadChatHistoryPage(tdlibService, repository, chatId, 0)

  try {
    repository.markChatHistorySynced(chatId, Date.now())
  } catch (err) {
    logCacheFallback('messages.getHistory:refresh:markSynced', chatId, err)
  }

  logHistoryInfo('messages.getHistory:refresh', chatId, { count: page.length })

  const cached = readCachedHistory(repository, chatId)
  return cached ?? page
}
