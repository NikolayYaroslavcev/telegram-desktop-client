/**
 * Attachment kinds this project currently maps. Not a full TDLib content-type
 * enum on purpose - unsupported types are rejected by the mapper rather than
 * silently coerced (see `src/main/tdlib/mappers/content.ts`).
 */
export type AttachmentType = 'photo' | 'document'

/**
 * Typed attachment metadata only. Deliberately excludes download/upload,
 * progress, preview and file-cache state - none of that exists yet (Task 14).
 */
export interface Attachment {
  type: AttachmentType
  fileId: number
  /** Present only once TDLib reports the file as fully downloaded locally. */
  localPath?: string
  /** Documents carry a sender-supplied name; photos have none. */
  fileName?: string
  size: number
}
