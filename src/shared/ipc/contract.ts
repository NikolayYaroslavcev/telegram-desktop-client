import type { AttachmentType, AuthorizationState, Chat, Message } from '../models'
import type {
  AuthInputRejectedEvent,
  MessageDeletedEvent,
  MessageSendFailedEvent,
  NetworkState,
} from './events'

export interface AppInfo {
  name: string
  version: string
}

/**
 * Result of a main-process-owned file picker (`dialog.showOpenDialog`),
 * scoped to one attachment kind - see `messages.selectAttachmentFile`.
 * `filePath` only ever names a file the user just picked through this
 * exact dialog; it is meaningless as an argument to `sendAttachment` unless
 * main itself recognizes it as one it handed out (see
 * `src/main/attachments/fileSelection.ts`).
 */
export interface SelectedAttachmentFile {
  filePath: string
  fileName: string
  size: number
}

/**
 * Result of `messages.downloadAttachment`. Never carries a filesystem path -
 * the renderer has no way to turn this into a `shell.openPath`/`fs.readFile`
 * call of its own; `previewDataUrl` (photos only) is inline image bytes,
 * already base64-encoded by main, and `messages.openAttachment` is the only
 * way to actually open the file, using a path main resolves itself.
 */
export interface DownloadedAttachment {
  /** Base64 data URL - present only for `type: 'photo'`, never for documents (no preview). */
  previewDataUrl?: string
}

export type Unsubscribe = () => void

/**
 * The single whitelisted API surface `contextBridge` exposes to the
 * renderer as `window.electronAPI`. This is the entire boundary: nothing
 * else (no `ipcRenderer`, no generic `send`/`invoke`/`on`, no TDLib client
 * or types) is reachable from renderer code. Every method here is a typed
 * request/response or subscribe/unsubscribe pair backed by exactly one
 * fixed IPC channel (see `channels.ts`).
 */
export interface ElectronAPI {
  getAppInfo(): Promise<AppInfo>

  auth: {
    getState(): Promise<AuthorizationState>
    setPhoneNumber(phone: string): Promise<void>
    checkCode(code: string): Promise<void>
    checkPassword(password: string): Promise<void>
  }

  chats: {
    list(): Promise<Chat[]>
    open(chatId: number): Promise<void>
  }

  /**
   * `getState` (Task 17) mirrors `auth.getState()`: a renderer that mounts
   * after the first `updateConnectionState` already fired needs a way to ask
   * for the current value instead of showing a false initial state (see
   * `events.onNetworkStateChanged` and `NetworkState`).
   */
  network: {
    getState(): Promise<NetworkState>
  }

  messages: {
    /**
     * `forceRefresh` (Task 17), when `true`, bypasses the cache-first fast
     * path (Task 15) for the first page (`fromMessageId` omitted/`0`) and
     * re-fetches it from TDLib, merging the result into storage the same way
     * a normal cache-miss fetch does - existing tombstones are never
     * resurrected (`MessageRepository.upsertMessage` never touches
     * `is_deleted`/`deleted_at`). Used after a reconnect to catch up a chat
     * that's currently open, without invalidating the cache for any other
     * chat. Ignored (has no effect) for an explicit pagination cursor
     * (`fromMessageId !== 0`), which already always goes to TDLib.
     */
    getHistory(chatId: number, fromMessageId?: number, forceRefresh?: boolean): Promise<Message[]>
    sendText(chatId: number, text: string, replyToMessageId?: number): Promise<void>
    sendAttachment(chatId: number, filePath: string, replyToMessageId?: number): Promise<void>
    /** Opens a main-process `dialog.showOpenDialog` scoped to `type`; `null` if the user cancelled. */
    selectAttachmentFile(type: AttachmentType): Promise<SelectedAttachmentFile | null>
    /** Downloads (or reuses the already-downloaded) file for one message's attachment via TDLib. */
    downloadAttachment(chatId: number, messageId: number): Promise<DownloadedAttachment>
    /** Opens an already-downloaded attachment with the OS default handler (`shell.openPath`). */
    openAttachment(chatId: number, messageId: number): Promise<void>
  }

  events: {
    onAuthStateChanged(cb: (state: AuthorizationState) => void): Unsubscribe
    onAuthInputRejected(cb: (event: AuthInputRejectedEvent) => void): Unsubscribe
    onAuthFlowTerminated(cb: () => void): Unsubscribe
    onNewMessage(cb: (message: Message) => void): Unsubscribe
    onMessageDeleted(cb: (event: MessageDeletedEvent) => void): Unsubscribe
    onMessageSendFailed(cb: (event: MessageSendFailedEvent) => void): Unsubscribe
    onNetworkStateChanged(cb: (state: NetworkState) => void): Unsubscribe
  }
}
