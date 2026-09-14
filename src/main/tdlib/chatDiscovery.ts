import type { Client } from 'tdl'
import type { Chat } from '../../shared/models/chat'
import { mapTdlibChatToChat, mapTdlibUserToUser } from './mappers'
import { TdlibServiceError } from './types'

/**
 * Chat discovery only ever calls `invoke` - narrowing to this instead of the
 * full `tdl` `Client` lets tests drive it with a plain fake object instead of
 * a real/mocked TDLib client.
 */
export type ChatDiscoveryClient = Pick<Client, 'invoke'>

/**
 * `getChats` is explicitly "for informational purposes only" per TDLib's own
 * docs and returns at most this many ids from the main chat list - loading
 * further pages (`loadChats`) is out of this task's scope (see docs/plan.md
 * Task 09, Scope). The natural order `getChats` returns is preserved as-is.
 */
const PRIVATE_CHATS_LIST_LIMIT = 200

/**
 * Discovers private 1-on-1 chats: groups/supergroups/channels are filtered
 * out by `mapTdlibChatToChat` (returns `null` for anything but
 * `chatTypePrivate`), and bot peers are excluded by checking the resolved
 * `User.isBot` (itself only ever `user.type._ === 'userTypeBot'`, see
 * `mapTdlibUserToUser` - never a name/username heuristic).
 *
 * A chat whose own details or peer user can't be fetched is dropped rather
 * than returned half-confirmed - only the initial `getChats` call failing
 * outright is treated as a hard error, since at that point there is no chat
 * list to even attempt resolving.
 */
export async function discoverPrivateChats(client: ChatDiscoveryClient): Promise<Chat[]> {
  let chatIds: number[]
  try {
    const result = await client.invoke({
      _: 'getChats',
      chat_list: { _: 'chatListMain' },
      limit: PRIVATE_CHATS_LIST_LIMIT,
    })
    chatIds = result.chat_ids
  } catch (err) {
    throw new TdlibServiceError('client', 'Failed to fetch the chat list from TDLib', {
      cause: err,
    })
  }

  const resolved = await Promise.all(chatIds.map((chatId) => resolvePrivateChat(client, chatId)))
  return resolved.filter((chat): chat is Chat => chat !== null)
}

/**
 * Resolves and validates a single chat by id, applying the exact same
 * private-chat/non-bot policy as `discoverPrivateChats` - used directly by
 * that function's per-id loop, and also by `TdlibService.getChat` (Task 10's
 * `chats.open`) to validate one chat id without listing/resolving every
 * chat. Any failure (chat doesn't exist, isn't private, peer is a bot, or a
 * transient TDLib error) is reported the same way: `null`, never thrown.
 */
export async function resolvePrivateChat(
  client: ChatDiscoveryClient,
  chatId: number,
): Promise<Chat | null> {
  try {
    const tdChat = await client.invoke({ _: 'getChat', chat_id: chatId })
    const chat = mapTdlibChatToChat(tdChat)
    if (!chat) return null

    const tdUser = await client.invoke({ _: 'getUser', user_id: chat.peerUserId })
    const user = mapTdlibUserToUser(tdUser)
    if (user.isBot) return null

    return chat
  } catch {
    return null
  }
}
