/**
 * Domain chat model - private 1-on-1 chats only (this project's whole
 * scope). `peerUserId` is what makes that explicit: a chat that isn't a
 * TDLib `chatTypePrivate` has no single peer user and can't be represented
 * as a `Chat` at all (see `mapTdlibChatToChat`, which returns `null` for it).
 */
export interface Chat {
  id: number
  peerUserId: number
  title: string
  /** Plain-text preview of the last message, if it was a text message. */
  lastMessagePreview?: string
}
