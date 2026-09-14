/**
 * Internal contracts for the production TDLib integration layer. Nothing in
 * this file (or the rest of src/main/tdlib) is imported by preload or
 * renderer code - TDLib stays entirely inside the main process. `TdlibService`
 * returning the domain `Chat` model (rather than a td_api `chat`) is the one
 * exception: it's the same domain type IPC handlers already return to the
 * renderer, not a TDLib type.
 */

import type { AttachmentType } from '../../shared/models/attachment'
import type { Chat } from '../../shared/models/chat'
import type { NetworkStatus } from '../../shared/ipc/events'

/**
 * Normalized authorization status. Mirrors TDLib's `authorizationState._`
 * discriminants (minus the `authorizationState` prefix), plus `unknown` for
 * any state this version of the app doesn't recognize - added so a future
 * TDLib update that introduces a new state can't crash this layer.
 */
export type AuthorizationStatus =
  | 'waitTdlibParameters'
  | 'waitEncryptionKey'
  | 'waitPhoneNumber'
  | 'waitEmailAddress'
  | 'waitEmailCode'
  | 'waitCode'
  | 'waitOtherDeviceConfirmation'
  | 'waitRegistration'
  | 'waitPassword'
  | 'ready'
  | 'loggingOut'
  | 'closing'
  | 'closed'
  | 'unknown'

const AUTHORIZATION_STATE_MAP: Record<string, AuthorizationStatus> = {
  authorizationStateWaitTdlibParameters: 'waitTdlibParameters',
  authorizationStateWaitEncryptionKey: 'waitEncryptionKey',
  authorizationStateWaitPhoneNumber: 'waitPhoneNumber',
  authorizationStateWaitEmailAddress: 'waitEmailAddress',
  authorizationStateWaitEmailCode: 'waitEmailCode',
  authorizationStateWaitCode: 'waitCode',
  authorizationStateWaitOtherDeviceConfirmation: 'waitOtherDeviceConfirmation',
  authorizationStateWaitRegistration: 'waitRegistration',
  authorizationStateWaitPassword: 'waitPassword',
  authorizationStateReady: 'ready',
  authorizationStateLoggingOut: 'loggingOut',
  authorizationStateClosing: 'closing',
  authorizationStateClosed: 'closed',
}

/** Maps a raw `authorizationState._` discriminant to AuthorizationStatus. Never throws. */
export function mapAuthorizationState(raw: string): AuthorizationStatus {
  return AUTHORIZATION_STATE_MAP[raw] ?? 'unknown'
}

const CONNECTION_STATE_MAP: Record<string, NetworkStatus> = {
  connectionStateWaitingForNetwork: 'waitingForNetwork',
  connectionStateConnectingToProxy: 'connectingToProxy',
  connectionStateConnecting: 'connecting',
  connectionStateUpdating: 'updating',
  connectionStateReady: 'ready',
}

/**
 * Maps a raw `connectionState._` discriminant (TDLib's `updateConnectionState`)
 * to the shared `NetworkStatus` domain type - never throws, and never lets an
 * unrecognized future TDLib state (or a malformed update) crash this layer;
 * it falls back to `'unknown'`, the same safe-default idiom
 * `mapAuthorizationState` already uses.
 */
export function mapConnectionState(raw: string): NetworkStatus {
  return CONNECTION_STATE_MAP[raw] ?? 'unknown'
}

export type TdlibErrorKind =
  /** Missing/invalid api_id, api_hash, or other required configuration. */
  | 'configuration'
  /** The native tdjson library failed to load. */
  | 'native-load'
  /** The TDLib client failed to initialize (createClient/configure). */
  | 'initialization'
  /** A problem in the phone/OTP/2FA authorization flow. */
  | 'authorization'
  /** An error reported by the TDLib client itself (TDLibError / client 'error' event). */
  | 'client'
  /** A problem while stopping/closing the client. */
  | 'shutdown'

/** Typed, structured error for every failure mode this layer can produce. */
export class TdlibServiceError extends Error {
  readonly kind: TdlibErrorKind

  constructor(kind: TdlibErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'TdlibServiceError'
    this.kind = kind
  }
}

/** The three prompts `tdl`'s `login()` bridges through this layer's pending-input mechanism. */
export type AuthInputStep = 'phone' | 'code' | 'password'

/**
 * Internal update stream shape. `raw` intentionally carries the full td_api
 * `Update` type for future main-process-internal consumers (message/chat
 * repositories, etc. - out of scope for this task) - only preload/renderer
 * are forbidden from seeing td_api types, not other main-process code.
 *
 * `authInputRejected` mirrors `tdl`'s own `retry` argument to
 * `getPhoneNumber`/`getAuthCode`/`getPassword` (see lifecycle.ts and
 * docs/tdlib-integration.md, "Retry semantics") - a confirmed rejection of
 * the previously submitted value, not a timeout inference. `authFlowTerminated`
 * fires once `tdl`'s `login()` promise itself rejects (a non-retryable auth
 * error): at that point `tdl` has detached its own update listener for good,
 * so this service can never again resolve a pending phone/code/password
 * prompt for the current login attempt.
 */
export type TdlibUpdateEvent =
  | { kind: 'authorizationState'; status: AuthorizationStatus }
  | { kind: 'authInputRejected'; step: AuthInputStep }
  | { kind: 'authFlowTerminated' }
  | { kind: 'networkState'; status: NetworkStatus }
  | { kind: 'error'; error: TdlibServiceError }
  | { kind: 'raw'; update: import('tdlib-types').Update }

export type Unsubscribe = () => void

/** Result of a completed TDLib file download (`fileDownload.ts`) - never a raw td_api `file`. */
export interface DownloadedFile {
  localPath: string
  size: number
}

/**
 * Minimal typed service API for main-process-internal use. Deliberately not
 * a generic `execute(method, params)` passthrough - only the operations this
 * task's scope calls for.
 */
export interface TdlibService {
  start(): Promise<void>
  stop(): Promise<void>
  getAuthorizationState(): AuthorizationStatus
  /**
   * Last known TDLib `connectionState` (Task 17), mapped via
   * `mapConnectionState`. `'unknown'` before the first `updateConnectionState`
   * has been observed for this client - callers must not treat that as
   * "online". Mirrors `getAuthorizationState`'s synchronous, always-available
   * shape so a renderer mounting after the first event still fired can ask
   * for the current value instead of guessing.
   */
  getNetworkState(): NetworkStatus
  onUpdate(listener: (event: TdlibUpdateEvent) => void): Unsubscribe
  setPhoneNumber(phone: string): Promise<void>
  checkCode(code: string): Promise<void>
  checkPassword(password: string): Promise<void>
  getPrivateChats(): Promise<Chat[]>
  /** Resolves and validates one chat by id - `null` if it isn't an allowed private chat. */
  getChat(chatId: number): Promise<Chat | null>
  /** One page of raw TDLib history for `chatId` - see `messageHistory.ts` for pagination semantics. */
  getChatHistory(chatId: number, fromMessageId: number): Promise<import('tdlib-types').message[]>
  /**
   * Sends a plain-text message to `chatId` via TDLib's `sendMessage` +
   * `inputMessageText` (see `messageSend.ts`). Resolving only means TDLib
   * accepted the request locally (the message now exists in a "pending"
   * sending state) - it is not delivery confirmation. The actual outcome
   * arrives later as `updateMessageSendSucceeded`/`updateMessageSendFailed`
   * on the update stream, handled in `src/main/messages/realtimeUpdates.ts`.
   *
   * `replyToMessageId` (Task 13), when given, is sent as TDLib's
   * `inputMessageReplyToMessage` - the caller (`messagesHandlers.ts`) has
   * already verified it refers to an existing message in the same chat
   * before this is called.
   */
  sendText(chatId: number, text: string, replyToMessageId?: number): Promise<void>
  /**
   * Sends a photo or document to `chatId` via TDLib's `sendMessage` +
   * `inputMessagePhoto`/`inputMessageDocument` (see `messageSend.ts`). Same
   * "not delivery confirmation" semantics as `sendText` - the outcome
   * arrives later via `updateMessageSendSucceeded`/`updateMessageSendFailed`.
   * `filePath` is never interpreted by this layer beyond handing it to TDLib
   * as an `inputFileLocal`; the caller (`messagesHandlers.ts`) is
   * responsible for only ever passing a path this app itself resolved.
   */
  sendAttachment(
    chatId: number,
    type: AttachmentType,
    filePath: string,
    replyToMessageId?: number,
  ): Promise<void>
  /**
   * Downloads one file by TDLib file id (see `fileDownload.ts`) - never by
   * filesystem path. Resolves once the download has completed (or TDLib
   * reports it didn't, `null`); an already-downloaded file resolves
   * immediately without a redundant network fetch (TDLib's own behavior,
   * not special-cased here).
   */
  downloadFile(fileId: number): Promise<DownloadedFile | null>
  /**
   * Re-resolves `messageId`'s attachment straight from TDLib and returns its
   * *current* `file_id` (Task 20 fix). TDLib file ids are only guaranteed
   * valid within the TDLib client instance/session that handed them out -
   * one cached in local storage from a previous app run (or a previous
   * `authorizationStateReady`) can be rejected by `downloadFile` with "File
   * not found" even though the file itself is still perfectly available.
   * `null` means the message (or its attachment) could no longer be
   * resolved at all - not the same as a transient download failure.
   */
  refreshAttachmentFileId(chatId: number, messageId: number): Promise<number | null>
}
