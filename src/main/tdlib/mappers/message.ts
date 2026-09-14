import type { message as TdMessage, MessageReplyTo, MessageSender } from 'tdlib-types'
import type { Message } from '../../../shared/models/message'
import { extractMessageAttachment, extractMessageText, isSupportedMessageContent } from './content'

function extractSenderId(sender: MessageSender): number | null {
  return sender._ === 'messageSenderUser' ? sender.user_id : null
}

function extractReplyToMessageId(replyTo: MessageReplyTo | undefined): number | undefined {
  return replyTo?._ === 'messageReplyToMessage' ? replyTo.message_id : undefined
}

/**
 * Pure TDLib `message` -> domain `Message` mapping. Returns `null` when the
 * message can't be represented at all under this task's explicit content
 * policy (unsupported content type, malformed attachment, or a sender that
 * isn't a user) - see docs/domain-models.md for the full policy and why.
 */
export function mapTdlibMessageToMessage(message: TdMessage): Message | null {
  const senderId = extractSenderId(message.sender_id)
  if (senderId === null) {
    return null
  }

  if (!isSupportedMessageContent(message.content)) {
    return null
  }

  const attachment = extractMessageAttachment(message.content)
  if (attachment === null) {
    return null
  }

  return {
    id: message.id,
    chatId: message.chat_id,
    senderId,
    text: extractMessageText(message.content),
    createdAt: message.date,
    replyToMessageId: extractReplyToMessageId(message.reply_to),
    isOutgoing: message.is_outgoing,
    isDeleted: false,
    deletedAt: null,
    attachment,
  }
}
