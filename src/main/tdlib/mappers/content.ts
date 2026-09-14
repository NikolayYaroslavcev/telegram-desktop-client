import type {
  document as TdDocument,
  file as TdFile,
  MessageContent,
  photo as TdPhoto,
} from 'tdlib-types'
import type { Attachment } from '../../../shared/models/attachment'

const SUPPORTED_CONTENT_TYPES = new Set<MessageContent['_']>([
  'messageText',
  'messagePhoto',
  'messageDocument',
])

/** Whether this task's mapper has an explicit policy for this content type. */
export function isSupportedMessageContent(content: Pick<MessageContent, '_'>): boolean {
  return SUPPORTED_CONTENT_TYPES.has(content._)
}

/**
 * Plain-string text of a text message, per Task 01's confirmed shape
 * (`message.content.text.text`, never the raw `formattedText`). `undefined`
 * for every other content type - including attachments with a caption,
 * which this task doesn't model (see docs/domain-models.md).
 */
export function extractMessageText(content: MessageContent): string | undefined {
  return content._ === 'messageText' ? content.text.text : undefined
}

function normalizeLocalPath(file: TdFile): string | undefined {
  return file.local.is_downloading_completed && file.local.path.length > 0
    ? file.local.path
    : undefined
}

function mapTdlibPhotoToAttachment(photo: TdPhoto): Attachment | null {
  if (photo.sizes.length === 0) {
    return null
  }
  const largest = photo.sizes.reduce((biggest, candidate) =>
    candidate.width * candidate.height > biggest.width * biggest.height ? candidate : biggest,
  )
  return {
    type: 'photo',
    fileId: largest.photo.id,
    size: largest.photo.size,
    fileName: undefined,
    localPath: normalizeLocalPath(largest.photo),
  }
}

function mapTdlibDocumentToAttachment(document: TdDocument): Attachment {
  return {
    type: 'document',
    fileId: document.document.id,
    size: document.document.size,
    fileName: document.file_name.length > 0 ? document.file_name : undefined,
    localPath: normalizeLocalPath(document.document),
  }
}

/**
 * Attachment metadata for message content this task supports (photos,
 * documents). `undefined` means "this content type has no attachment"
 * (e.g. text); `null` means "this is a supported attachment type but the
 * TDLib data was malformed" (e.g. a photo with no sizes) - callers must
 * treat that as an unsupported message, not silently drop the attachment.
 */
export function extractMessageAttachment(content: MessageContent): Attachment | null | undefined {
  if (content._ === 'messagePhoto') {
    return mapTdlibPhotoToAttachment(content.photo)
  }
  if (content._ === 'messageDocument') {
    return mapTdlibDocumentToAttachment(content.document)
  }
  return undefined
}
