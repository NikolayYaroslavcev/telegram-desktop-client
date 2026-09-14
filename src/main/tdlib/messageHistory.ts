import type { Client } from 'tdl'
import type { message as TdMessage } from 'tdlib-types'
import { TdlibServiceError } from './types'

/**
 * Only `invoke` is needed - same narrowing as `ChatDiscoveryClient`, so
 * tests can drive this with a plain fake object instead of a real/mocked
 * TDLib client.
 */
export type MessageHistoryClient = Pick<Client, 'invoke'>

/**
 * Requested page size for one `getChatHistory` call. TDLib caps `limit` at
 * 100 and may itself return fewer messages than requested (see the
 * `getChatHistory` doc comment in `tdlib-types`) - this is a request upper
 * bound, not a guarantee, and callers must treat any page (including an
 * empty one) as final rather than looping until an exact count is reached.
 */
const CHAT_HISTORY_PAGE_LIMIT = 50

/**
 * Fetches one page of a chat's message history via TDLib's `getChatHistory`.
 *
 * Pagination contract (see docs/plan.md Task 10):
 * - `fromMessageId: 0` is TDLib's own sentinel for "start from the newest
 *   message" - used for the first page.
 * - For every later page, pass the smallest `message.id` from the previous
 *   page as `fromMessageId`. Combined with `offset: 0`, TDLib returns the
 *   messages immediately preceding (older than) that message, excluding it
 *   - so no message is ever repeated or skipped across pages.
 * - An empty result means there is no more history to fetch; this function
 *   makes exactly one TDLib call and never loops internally, so it cannot
 *   itself get stuck in an infinite pagination loop.
 *
 * Returned in TDLib's own order (decreasing `message.id`, i.e. newest first
 * within the page) - not re-sorted here. `null` entries (TDLib documents
 * `messages.messages` as possibly containing them) are dropped: they carry
 * no data for the mapper to work with, same as any other unsupported
 * message.
 */
export async function fetchChatHistoryPage(
  client: MessageHistoryClient,
  chatId: number,
  fromMessageId: number,
): Promise<TdMessage[]> {
  let result
  try {
    result = await client.invoke({
      _: 'getChatHistory',
      chat_id: chatId,
      from_message_id: fromMessageId,
      offset: 0,
      limit: CHAT_HISTORY_PAGE_LIMIT,
      only_local: false,
    })
  } catch (err) {
    throw new TdlibServiceError('client', 'Failed to fetch chat history from TDLib', { cause: err })
  }

  return result.messages.filter((message): message is TdMessage => message !== null)
}

/**
 * Fetches one message directly via TDLib's `getMessage` (Task 20 fix - see
 * `TdlibLifecycleService.refreshAttachmentFileId` for why: a cached
 * `Attachment.fileId` from a previous TDLib client/session can become stale,
 * and re-fetching the message is how a fresh, current-session file id is
 * obtained). Returns `null` when TDLib rejects the call (message no longer
 * resolvable - deleted, chat no longer accessible, etc.) rather than
 * throwing: unlike `fetchChatHistoryPage`'s page-fetch failures, a single
 * message miss here is an expected, recoverable outcome for the caller.
 */
export async function fetchMessage(
  client: MessageHistoryClient,
  chatId: number,
  messageId: number,
): Promise<TdMessage | null> {
  try {
    return await client.invoke({ _: 'getMessage', chat_id: chatId, message_id: messageId })
  } catch {
    return null
  }
}
