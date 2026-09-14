import { TDLibError } from 'tdl'
import type { Client } from 'tdl'
import { discoverPrivateChats, resolvePrivateChat } from './chatDiscovery'
import { createTdlibClient } from './client'
import type { TdlibRuntimeConfig } from './config'
import { downloadTdlibFile } from './fileDownload'
import { logger } from '../logger'
import { fetchChatHistoryPage, fetchMessage } from './messageHistory'
import { extractMessageAttachment } from './mappers'
import { sendAttachmentMessage, sendTextMessage } from './messageSend'
import type { AttachmentType } from '../../shared/models/attachment'
import type { Chat } from '../../shared/models/chat'
import {
  mapAuthorizationState,
  mapConnectionState,
  TdlibServiceError,
  type AuthInputStep,
  type AuthorizationStatus,
  type DownloadedFile,
  type TdlibService,
  type TdlibUpdateEvent,
  type Unsubscribe,
} from './types'
import type { NetworkStatus } from '../../shared/ipc/events'

type LifecycleState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped'

interface PendingAuthInput {
  kind: AuthInputStep
  resolve: (value: string) => void
  reject: (err: Error) => void
}

/**
 * Production TDLib service: owns exactly one TDLib client for the lifetime
 * of the process, translates its authorization-state updates into a typed
 * event stream, and bridges the phone/OTP/2FA prompts tdl's `client.login()`
 * expects into a push-style internal API (setPhoneNumber/checkCode/
 * checkPassword) that a future task's UI code can drive. No Telegram
 * business logic (retries, validation) lives here - TDLib's own retry
 * mechanism (re-invoking the same handler) is relied on as-is.
 */
export class TdlibLifecycleService implements TdlibService {
  private client: Client | null = null
  private state: LifecycleState = 'idle'
  private status: AuthorizationStatus = 'closed'
  /**
   * `'unknown'` until the first `updateConnectionState` arrives (see
   * `getNetworkState` doc, types.ts) - deliberately not defaulted to
   * `'ready'`/`'connecting'`, which would be a guess this class cannot back up.
   */
  private networkStatus: NetworkStatus = 'unknown'
  private pending: PendingAuthInput | null = null
  /**
   * Set once `client.login()` itself rejects (a non-retryable auth error -
   * see docs/tdlib-integration.md, "Retry semantics"). `tdl` detaches its
   * own update listener when that happens, so this login attempt can never
   * resolve another phone/code/password prompt; recovering requires a full
   * `TdlibService` restart, which is out of this class's scope.
   */
  private flowTerminated = false
  private readonly listeners = new Set<(event: TdlibUpdateEvent) => void>()

  constructor(
    private readonly config: TdlibRuntimeConfig,
    private readonly createClient: (config: TdlibRuntimeConfig) => Client = createTdlibClient,
  ) {}

  async start(): Promise<void> {
    if (this.state !== 'idle') {
      throw new TdlibServiceError(
        'initialization',
        `TDLib service cannot start from state "${this.state}"`,
      )
    }
    this.state = 'starting'

    let client: Client
    try {
      client = this.createClient(this.config)
    } catch (err) {
      this.state = 'idle'
      throw err
    }
    this.client = client

    client.on('update', (update) => {
      if (update._ === 'updateAuthorizationState') {
        this.status = mapAuthorizationState(update.authorization_state._)
        logger.info({ operation: 'tdlib.authorizationState', details: { status: this.status } })
        this.emit({ kind: 'authorizationState', status: this.status })
        return
      }
      if (update._ === 'updateConnectionState') {
        this.networkStatus = mapConnectionState(update.state._)
        logger.info({ operation: 'tdlib.connectionState', details: { status: this.networkStatus } })
        this.emit({ kind: 'networkState', status: this.networkStatus })
        return
      }
      this.emit({ kind: 'raw', update })
    })

    client.on('error', (err) => {
      const wrapped = new TdlibServiceError(
        'client',
        err instanceof TDLibError ? `TDLib error ${err.code}: ${err.message}` : err.message,
        { cause: err },
      )
      logger.error({
        operation: 'tdlib.clientError',
        errorCode: 'TDLIB_ERROR',
        details: { message: wrapped.message.slice(0, 300) },
      })
      this.emit({ kind: 'error', error: wrapped })
    })

    client.on('close', () => {
      logger.info({ operation: 'tdlib.clientClosed' })
    })

    // Not awaited here: login() only resolves once authorizationStateReady
    // is reached, which may be much later (waiting on setPhoneNumber/
    // checkCode/checkPassword calls this task deliberately does not drive
    // itself - see class doc). Its rejection is still handled, not ignored.
    client
      .login({
        type: 'user',
        getPhoneNumber: (retry) => this.waitForAuthInput('phone', Boolean(retry)),
        getAuthCode: (retry) => this.waitForAuthInput('code', Boolean(retry)),
        getPassword: (_passwordHint, retry) => this.waitForAuthInput('password', Boolean(retry)),
        getEmailAddress: () =>
          Promise.reject(new TdlibServiceError('authorization', 'Email login is not supported')),
        getEmailCode: () =>
          Promise.reject(new TdlibServiceError('authorization', 'Email login is not supported')),
        confirmOnAnotherDevice: () => {
          logger.warn({ operation: 'tdlib.confirmOnAnotherDevice', category: 'unsupported' })
        },
        getName: () =>
          Promise.reject(new TdlibServiceError('authorization', 'Registration is not supported')),
      })
      .catch((err: unknown) => {
        const wrapped =
          err instanceof TdlibServiceError
            ? err
            : new TdlibServiceError(
                'authorization',
                err instanceof Error ? err.message : String(err),
                {
                  cause: err,
                },
              )
        logger.error({
          operation: 'tdlib.loginFlow',
          errorCode: 'NOT_ALLOWED',
          details: { message: wrapped.message.slice(0, 300) },
        })
        this.emit({ kind: 'error', error: wrapped })
        this.flowTerminated = true
        this.emit({ kind: 'authFlowTerminated' })
      })

    this.state = 'running'
  }

  async stop(): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopped' || this.state === 'stopping') {
      return
    }
    this.state = 'stopping'

    if (this.pending) {
      this.pending.reject(new TdlibServiceError('shutdown', 'TDLib service is shutting down'))
      this.pending = null
    }

    try {
      if (this.client) {
        await this.client.close()
      }
    } catch (err) {
      throw new TdlibServiceError('shutdown', 'Failed to close the TDLib client cleanly', {
        cause: err,
      })
    } finally {
      this.state = 'stopped'
    }
  }

  getAuthorizationState(): AuthorizationStatus {
    return this.status
  }

  getNetworkState(): NetworkStatus {
    return this.networkStatus
  }

  onUpdate(listener: (event: TdlibUpdateEvent) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async setPhoneNumber(phone: string): Promise<void> {
    this.resolveAuthInput('phone', phone)
  }

  async checkCode(code: string): Promise<void> {
    this.resolveAuthInput('code', code)
  }

  async checkPassword(password: string): Promise<void> {
    this.resolveAuthInput('password', password)
  }

  async getPrivateChats(): Promise<Chat[]> {
    if (!this.client) {
      throw new TdlibServiceError('client', 'TDLib client is not running')
    }
    return discoverPrivateChats(this.client)
  }

  async getChat(chatId: number): Promise<Chat | null> {
    if (!this.client) {
      throw new TdlibServiceError('client', 'TDLib client is not running')
    }
    return resolvePrivateChat(this.client, chatId)
  }

  async getChatHistory(
    chatId: number,
    fromMessageId: number,
  ): Promise<import('tdlib-types').message[]> {
    if (!this.client) {
      throw new TdlibServiceError('client', 'TDLib client is not running')
    }
    return fetchChatHistoryPage(this.client, chatId, fromMessageId)
  }

  async sendText(chatId: number, text: string, replyToMessageId?: number): Promise<void> {
    if (!this.client) {
      throw new TdlibServiceError('client', 'TDLib client is not running')
    }
    return sendTextMessage(this.client, chatId, text, replyToMessageId)
  }

  async sendAttachment(
    chatId: number,
    type: AttachmentType,
    filePath: string,
    replyToMessageId?: number,
  ): Promise<void> {
    if (!this.client) {
      throw new TdlibServiceError('client', 'TDLib client is not running')
    }
    return sendAttachmentMessage(this.client, chatId, type, filePath, replyToMessageId)
  }

  async downloadFile(fileId: number): Promise<DownloadedFile | null> {
    if (!this.client) {
      throw new TdlibServiceError('client', 'TDLib client is not running')
    }
    return downloadTdlibFile(this.client, fileId)
  }

  async refreshAttachmentFileId(chatId: number, messageId: number): Promise<number | null> {
    if (!this.client) {
      throw new TdlibServiceError('client', 'TDLib client is not running')
    }
    const message = await fetchMessage(this.client, chatId, messageId)
    if (!message) return null

    const attachment = extractMessageAttachment(message.content)
    if (!attachment) return null

    return attachment.fileId
  }

  /**
   * `retry` is `tdl`'s own confirmed signal that the previously submitted
   * value for `kind` was rejected (see docs/tdlib-integration.md, "Retry
   * semantics") - not a guess or a timeout inference.
   */
  private waitForAuthInput(kind: AuthInputStep, retry: boolean): Promise<string> {
    if (retry) {
      this.emit({ kind: 'authInputRejected', step: kind })
    }
    return new Promise((resolve, reject) => {
      this.pending = { kind, resolve, reject }
    })
  }

  private resolveAuthInput(kind: AuthInputStep, value: string): void {
    if (this.flowTerminated) {
      throw new TdlibServiceError(
        'authorization',
        `TDLib login flow has terminated and can no longer accept ${kind} input; restart the app to sign in again`,
      )
    }
    if (!this.pending || this.pending.kind !== kind) {
      throw new TdlibServiceError(
        'authorization',
        `TDLib is not currently waiting for ${kind} (current authorization state: ${this.status})`,
      )
    }
    const { resolve } = this.pending
    this.pending = null
    resolve(value)
  }

  private emit(event: TdlibUpdateEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}
