import type { Message } from '../../shared/models'

/**
 * How a reply target should be shown, resolved purely from already-loaded
 * messages (Task 13) - never a separate IPC/TDLib request per reply (see
 * docs/plan.md Task 13, "Resolve reply target"). `unavailable` covers both
 * "never loaded" and "not in this chat's currently loaded list"; the
 * component only ever calls this with messages from the same chat, so
 * neither caller needs to distinguish those cases further.
 */
export type ReplyPreview =
  { kind: 'available'; text: string } | { kind: 'deleted' } | { kind: 'unavailable' }

/** A photo/document sent with no caption has no `text` to quote - shown instead of an empty `""`. */
function fallbackAttachmentLabel(target: Message): string | undefined {
  if (!target.attachment) return undefined
  return target.attachment.type === 'photo' ? 'Фото' : 'Файл'
}

/**
 * Looks up `replyToMessageId` in the already-loaded `messages` list. A
 * target that exists but is tombstoned (`isDeleted`) is reported as
 * `'deleted'`, not `'available'` with its (still-preserved) text - showing
 * a deleted message's live text here would contradict the tombstone
 * semantics `MessageRepository.markDeleted` establishes elsewhere. See
 * `tombstoneDisplay.ts` for the label shown on a tombstoned message itself
 * (Task 16), as opposed to a reply merely pointing at one.
 */
export function resolveReplyPreview(
  messages: readonly Message[],
  replyToMessageId: number,
): ReplyPreview {
  const target = messages.find((message) => message.id === replyToMessageId)
  if (!target) return { kind: 'unavailable' }
  if (target.isDeleted) return { kind: 'deleted' }
  return { kind: 'available', text: target.text || fallbackAttachmentLabel(target) || '' }
}

/** User-facing label for a `ReplyPreview` - kept out of the component, same as `messageSendFailure.ts`. */
export function formatReplyPreviewLabel(preview: ReplyPreview): string {
  switch (preview.kind) {
    case 'available':
      return `Ответ на: "${preview.text}"`
    case 'deleted':
      return 'Ответ на удалённое сообщение'
    case 'unavailable':
      return 'Ответ на недоступное сообщение'
  }
}
