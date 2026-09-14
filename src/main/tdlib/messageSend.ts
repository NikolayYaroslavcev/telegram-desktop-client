import type { Client } from 'tdl'
import type { AttachmentType } from '../../shared/models/attachment'
import { TdlibServiceError } from './types'

/**
 * Only `invoke` is needed - same narrowing as `ChatDiscoveryClient`/
 * `MessageHistoryClient`, so tests can drive this with a plain fake object
 * instead of a real/mocked TDLib client.
 */
export type MessageSendClient = Pick<Client, 'invoke'>

/**
 * Sends one plain-text message via TDLib's `sendMessage`, using
 * `inputMessageText` - the only `input_message_content` type this task
 * supports (see docs/plan.md Task 12, "TDLib API"). `entities` is always
 * empty and `text` is passed through exactly as given: no Markdown/HTML
 * parsing, no hidden trimming or mutation of the caller's text.
 *
 * `replyToMessageId`, when given, is sent as `reply_to:
 * inputMessageReplyToMessage { message_id }` (Task 13) - a reply within the
 * same chat/topic, the only reply shape this task supports. `quote` is
 * omitted (TDLib treats it as "no quote"); `reply_to` itself is omitted
 * entirely for a plain (non-reply) send, exactly as before.
 *
 * The resolved TDLib `message` this call returns is a locally-created,
 * not-yet-confirmed message (its `sending_state` is `messageSendingStatePending`
 * and its `id` is a temporary identifier) - it is intentionally not returned
 * to callers. The canonical outcome (success with a final message id, or
 * failure) only ever arrives later via `updateMessageSendSucceeded`/
 * `updateMessageSendFailed` on the update stream - see
 * `src/main/messages/realtimeUpdates.ts`.
 */
export async function sendTextMessage(
  client: MessageSendClient,
  chatId: number,
  text: string,
  replyToMessageId?: number,
): Promise<void> {
  try {
    await client.invoke({
      _: 'sendMessage',
      chat_id: chatId,
      ...(replyToMessageId !== undefined
        ? { reply_to: { _: 'inputMessageReplyToMessage' as const, message_id: replyToMessageId } }
        : {}),
      input_message_content: {
        _: 'inputMessageText',
        text: { _: 'formattedText', text, entities: [] },
        clear_draft: false,
      },
    })
  } catch (err) {
    throw new TdlibServiceError('client', 'Failed to send the message via TDLib', { cause: err })
  }
}

/**
 * Sends one photo or document via TDLib's `sendMessage`, using
 * `inputMessagePhoto`/`inputMessageDocument` with an `inputFileLocal`
 * pointing at `filePath` (see docs/plan.md Task 14, "Sending") - the only
 * two `input_message_content` shapes this function ever builds. No caption
 * (an empty `formattedText`, same "no caption" shape TDLib itself expects),
 * no thumbnail, and no width/height/type detection pipeline of our own:
 * TDLib uploads the raw local file as-is and the server fills in the
 * resulting `document`/`photo` fields (name, size, sizes[]) - the mapper
 * (`mappers/content.ts`) reads those back from the confirmed message, it is
 * never guessed at here.
 *
 * Same not-delivery-confirmation caveat as `sendTextMessage`: resolving only
 * means TDLib accepted the request locally; the real outcome arrives later
 * via `updateMessageSendSucceeded`/`updateMessageSendFailed`.
 */
export async function sendAttachmentMessage(
  client: MessageSendClient,
  chatId: number,
  type: AttachmentType,
  filePath: string,
  replyToMessageId?: number,
): Promise<void> {
  const emptyCaption = { _: 'formattedText' as const, text: '', entities: [] }
  const file = { _: 'inputFileLocal' as const, path: filePath }

  const inputMessageContent =
    type === 'photo'
      ? {
          _: 'inputMessagePhoto' as const,
          photo: { _: 'inputPhoto' as const, photo: file },
          caption: emptyCaption,
        }
      : {
          _: 'inputMessageDocument' as const,
          document: { _: 'inputDocument' as const, document: file },
          caption: emptyCaption,
        }

  try {
    await client.invoke({
      _: 'sendMessage',
      chat_id: chatId,
      ...(replyToMessageId !== undefined
        ? { reply_to: { _: 'inputMessageReplyToMessage' as const, message_id: replyToMessageId } }
        : {}),
      input_message_content: inputMessageContent,
    })
  } catch (err) {
    throw new TdlibServiceError('client', 'Failed to send the attachment via TDLib', { cause: err })
  }
}
