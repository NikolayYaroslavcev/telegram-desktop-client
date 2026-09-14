import type { chat as TdChat } from 'tdlib-types'
import type { Chat } from '../../../shared/models/chat'
import { extractMessageText } from './content'

/**
 * Pure TDLib `chat` -> domain `Chat` mapping. Returns `null` for anything
 * that isn't a `chatTypePrivate` chat (basic groups, supergroups/channels,
 * secret chats, or malformed input with no recognizable type) - this
 * project's whole scope is private 1-on-1 chats, so there is no group/
 * channel/secret-chat domain model to fall back to. Bot exclusion is not
 * done here: it requires looking up the peer `User` by id, which is Task
 * 09's job (chat discovery), not this mapper's.
 */
export function mapTdlibChatToChat(chat: TdChat): Chat | null {
  if (chat.type?._ !== 'chatTypePrivate') {
    return null
  }

  return {
    id: chat.id,
    peerUserId: chat.type.user_id,
    title: chat.title,
    lastMessagePreview: chat.last_message
      ? extractMessageText(chat.last_message.content)
      : undefined,
  }
}
