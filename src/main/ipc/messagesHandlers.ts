import type { BrowserWindow, IpcMain } from 'electron'
import {
  buildPhotoPreviewDataUrl,
  selectAttachmentFile,
  FilesystemError,
  type AttachmentSelectionRegistry,
  type OpenFileDialog,
  type StatFile,
} from '../attachments'
import {
  IPC_CHANNELS,
  IpcHandlerError,
  type DownloadedAttachment,
  type SelectedAttachmentFile,
} from '../../shared/ipc'
import type { Message } from '../../shared/models'
import { logger } from '../logger'
import {
  loadChatHistory,
  refreshChatHistory,
  tryServeChatHistoryFromCache,
} from '../messages/historyService'
import type { MessageRepository } from '../storage'
import type { DownloadedFile, TdlibService } from '../tdlib'
import { handle } from './handle'
import { requireTdlibService, runTdlibCall } from './tdlibHelpers'
import {
  optionalBoolean,
  optionalNonNegativeInteger,
  requireAttachmentType,
  requireFiniteNumber,
  requireNonEmptyString,
  requireNonNegativeInteger,
} from './validation'

/**
 * Electron/Node primitives `sendAttachment`'s file-selection and download
 * handlers need, injected rather than imported directly - same reasoning as
 * `MessageSendClient`/`ChatDiscoveryClient` in `src/main/tdlib`: tests drive
 * this module with plain fakes instead of a real Electron process or
 * filesystem. `src/main/index.ts` is the only caller that wires in the real
 * `dialog.showOpenDialog`/`fs.promises.stat`/`fs.promises.readFile`/
 * `shell.openPath`.
 */
export interface AttachmentIpcDeps {
  getWindow: () => BrowserWindow | null
  openDialog: OpenFileDialog
  statFile: StatFile
  readFile: (filePath: string) => Promise<Buffer>
  openPath: (filePath: string) => Promise<string>
  registry: AttachmentSelectionRegistry
}

function requireMessageRepository(
  getMessageRepository: () => MessageRepository | null,
  operation: string,
): MessageRepository {
  const repository = getMessageRepository()
  if (!repository) {
    logger.warn({ operation, errorCode: 'STORAGE_ERROR', category: 'availability' })
    throw new IpcHandlerError('STORAGE_ERROR', 'Message storage is not available')
  }
  return repository
}

/**
 * `messages.getHistory` (Task 10, cache-first read path added in Task 15)
 * fetches one `getChatHistory` page, mapped and persisted via
 * `src/main/messages/historyService.ts` (which owns the cache-first
 * SQLite/TDLib orchestration; this handler only validates the IPC boundary
 * and wires the two backends together). The cache-hit fast path
 * (`tryServeChatHistoryFromCache`) is tried before `TdlibService` is even
 * required to exist, so a chat whose history is already cached loads
 * without depending on TDLib being reachable.
 *
 * `messages.sendText` (Task 12) validates its arguments, re-validates the
 * target chat via `TdlibService.getChat` (the same private-chat/non-bot
 * boundary `chats.open` already enforces - never trusting the renderer's own
 * chat selection), then calls `TdlibService.sendText`. The actual send
 * outcome (success with the final message id, or failure) is not returned
 * here - it arrives later on the update stream, handled in
 * `src/main/messages/realtimeUpdates.ts`; see docs/tdlib-integration.md.
 *
 * `replyToMessageId` (Task 13) is additionally checked against local
 * storage via `MessageRepository.findByIds(chatId, [replyToMessageId])`:
 * the target must already exist in *this* chat's history, or the request is
 * rejected with `INVALID_ARGUMENT` before anything is sent to TDLib. Since
 * `findByIds` scopes by `(chatId, messageId)`, a reply id that belongs to a
 * different chat is indistinguishable from a missing one here - both are
 * rejected the same way, which is exactly the cross-chat-reply boundary
 * this task requires.
 *
 * `messages.sendAttachment` (Task 14) applies the exact same validation and
 * private-chat boundary as `sendText`, plus one more check specific to
 * attachments: `filePath` must be a path `attachments.registry` actually
 * handed out via a prior `selectAttachmentFile` call (see
 * `src/main/attachments/fileSelection.ts`) - this is also how the handler
 * learns whether to send a photo or a document, since the wire contract
 * itself carries no separate `type` argument. `messages.selectAttachmentFile`/
 * `downloadAttachment`/`openAttachment` are the three new IPC methods this
 * task adds to support it end-to-end (dialog, TDLib file download, opening
 * the result) - none of them ever accept a renderer-supplied filesystem path.
 */
export function registerMessagesHandlers(
  ipcMain: IpcMain,
  getTdlibService: () => TdlibService | null,
  getMessageRepository: () => MessageRepository | null,
  attachments: AttachmentIpcDeps,
): void {
  handle(
    ipcMain,
    IPC_CHANNELS.messagesGetHistory,
    async (
      _event,
      chatId: unknown,
      fromMessageId: unknown,
      forceRefresh: unknown,
    ): Promise<Message[]> => {
      const validChatId = requireFiniteNumber(chatId, 'chatId')
      const validFromMessageId = optionalNonNegativeInteger(fromMessageId, 'fromMessageId') ?? 0
      const validForceRefresh = optionalBoolean(forceRefresh, 'forceRefresh') ?? false

      const repository = requireMessageRepository(getMessageRepository, 'messages.getHistory')

      // Task 17 recovery path: skip the cache-hit fast path entirely and go
      // straight to TDLib, so a reconnect can catch up messages missed while
      // offline. Only meaningful for the first page - an explicit pagination
      // cursor already always goes to TDLib (see historyService.ts).
      if (validFromMessageId === 0 && validForceRefresh) {
        const service = requireTdlibService(getTdlibService, 'messages.getHistory:refresh')
        return runTdlibCall(
          () => refreshChatHistory(service, repository, validChatId),
          'messages.getHistory:refresh',
        )
      }

      if (validFromMessageId === 0) {
        const cached = tryServeChatHistoryFromCache(repository, validChatId)
        if (cached !== null) return cached
      }

      const service = requireTdlibService(getTdlibService, 'messages.getHistory')
      return runTdlibCall(
        () => loadChatHistory(service, repository, validChatId, validFromMessageId),
        'messages.getHistory',
      )
    },
  )

  handle(
    ipcMain,
    IPC_CHANNELS.messagesSendText,
    async (_event, chatId: unknown, text: unknown, replyToMessageId: unknown): Promise<void> => {
      const validChatId = requireFiniteNumber(chatId, 'chatId')
      const validText = requireNonEmptyString(text, 'text')
      const validReplyToMessageId = optionalNonNegativeInteger(replyToMessageId, 'replyToMessageId')

      const service = requireTdlibService(getTdlibService, 'messages.sendText')

      const chat = await runTdlibCall(() => service.getChat(validChatId), 'messages.sendText')
      if (!chat) {
        throw new IpcHandlerError(
          'INVALID_ARGUMENT',
          'chatId does not refer to an allowed private chat',
        )
      }

      if (validReplyToMessageId !== undefined) {
        const repository = requireMessageRepository(getMessageRepository, 'messages.sendText')
        const [target] = repository.findByIds(validChatId, [validReplyToMessageId])
        if (!target) {
          throw new IpcHandlerError(
            'INVALID_ARGUMENT',
            'replyToMessageId does not refer to a message in this chat',
          )
        }
      }

      await runTdlibCall(
        () => service.sendText(validChatId, validText, validReplyToMessageId),
        'messages.sendText',
      )
    },
  )

  handle(
    ipcMain,
    IPC_CHANNELS.messagesSendAttachment,
    async (
      _event,
      chatId: unknown,
      filePath: unknown,
      replyToMessageId: unknown,
    ): Promise<void> => {
      const validChatId = requireFiniteNumber(chatId, 'chatId')
      const validFilePath = requireNonEmptyString(filePath, 'filePath')
      const validReplyToMessageId = optionalNonNegativeInteger(replyToMessageId, 'replyToMessageId')

      const type = attachments.registry.consume(validFilePath)
      if (!type) {
        throw new IpcHandlerError(
          'INVALID_ARGUMENT',
          'filePath does not refer to a file selected through the attachment picker',
        )
      }

      const service = requireTdlibService(getTdlibService, 'messages.sendAttachment')

      const chat = await runTdlibCall(() => service.getChat(validChatId), 'messages.sendAttachment')
      if (!chat) {
        throw new IpcHandlerError(
          'INVALID_ARGUMENT',
          'chatId does not refer to an allowed private chat',
        )
      }

      if (validReplyToMessageId !== undefined) {
        const repository = requireMessageRepository(getMessageRepository, 'messages.sendAttachment')
        const [target] = repository.findByIds(validChatId, [validReplyToMessageId])
        if (!target) {
          throw new IpcHandlerError(
            'INVALID_ARGUMENT',
            'replyToMessageId does not refer to a message in this chat',
          )
        }
      }

      await runTdlibCall(
        () => service.sendAttachment(validChatId, type, validFilePath, validReplyToMessageId),
        'messages.sendAttachment',
      )
    },
  )

  handle(
    ipcMain,
    IPC_CHANNELS.messagesSelectAttachmentFile,
    async (_event, type: unknown): Promise<SelectedAttachmentFile | null> => {
      const validType = requireAttachmentType(type, 'type')
      return selectAttachmentFile(
        attachments.openDialog,
        attachments.statFile,
        attachments.registry,
        attachments.getWindow(),
        validType,
      )
    },
  )

  function requireAttachmentMessage(
    chatId: number,
    messageId: number,
    operation: string,
  ): Message & { attachment: NonNullable<Message['attachment']> } {
    const repository = requireMessageRepository(getMessageRepository, operation)
    const [message] = repository.findByIds(chatId, [messageId])
    if (!message || !message.attachment) {
      throw new IpcHandlerError(
        'INVALID_ARGUMENT',
        'messageId does not refer to a message with an attachment in this chat',
      )
    }
    return message as Message & { attachment: NonNullable<Message['attachment']> }
  }

  /**
   * `service.downloadFile` by the cached `fileId`, with one automatic retry
   * against a freshly re-resolved file id on failure (Task 20 fix). Shared
   * by `downloadAttachment` and `openAttachment` - both hit the exact same
   * "cached id from a previous TDLib client session is stale" failure mode,
   * since both start from the same `requireAttachmentMessage` row. See
   * `TdlibService.refreshAttachmentFileId` for why a cached id can go stale.
   */
  async function downloadWithFreshIdRetry(
    service: TdlibService,
    chatId: number,
    messageId: number,
    fileId: number,
    operation: string,
  ): Promise<DownloadedFile | null> {
    try {
      return await runTdlibCall(() => service.downloadFile(fileId), operation)
    } catch (err) {
      const freshFileId = await service.refreshAttachmentFileId(chatId, messageId).catch(() => null)
      if (freshFileId === null || freshFileId === fileId) throw err
      return runTdlibCall(() => service.downloadFile(freshFileId), operation)
    }
  }

  handle(
    ipcMain,
    IPC_CHANNELS.messagesDownloadAttachment,
    async (_event, chatId: unknown, messageId: unknown): Promise<DownloadedAttachment> => {
      const validChatId = requireFiniteNumber(chatId, 'chatId')
      const validMessageId = requireNonNegativeInteger(messageId, 'messageId')

      const message = requireAttachmentMessage(
        validChatId,
        validMessageId,
        'messages.downloadAttachment',
      )
      const service = requireTdlibService(getTdlibService, 'messages.downloadAttachment')

      const downloaded = await downloadWithFreshIdRetry(
        service,
        validChatId,
        validMessageId,
        message.attachment.fileId,
        'messages.downloadAttachment',
      )
      if (!downloaded) {
        logger.warn({
          operation: 'messages.downloadAttachment',
          errorCode: 'NOT_FOUND',
          chatId: validChatId,
          messageId: validMessageId,
          fileId: message.attachment.fileId,
        })
        throw new IpcHandlerError('NOT_FOUND', 'Failed to download the attachment')
      }

      if (message.attachment.type !== 'photo') {
        return {}
      }

      let bytes: Buffer
      try {
        bytes = await attachments.readFile(downloaded.localPath)
      } catch (err) {
        throw new FilesystemError('Failed to read the downloaded attachment', { cause: err })
      }
      return { previewDataUrl: buildPhotoPreviewDataUrl(bytes) }
    },
  )

  handle(
    ipcMain,
    IPC_CHANNELS.messagesOpenAttachment,
    async (_event, chatId: unknown, messageId: unknown): Promise<void> => {
      const validChatId = requireFiniteNumber(chatId, 'chatId')
      const validMessageId = requireNonNegativeInteger(messageId, 'messageId')

      const message = requireAttachmentMessage(
        validChatId,
        validMessageId,
        'messages.openAttachment',
      )
      const service = requireTdlibService(getTdlibService, 'messages.openAttachment')

      const downloaded = await downloadWithFreshIdRetry(
        service,
        validChatId,
        validMessageId,
        message.attachment.fileId,
        'messages.openAttachment',
      )
      if (!downloaded) {
        logger.warn({
          operation: 'messages.openAttachment',
          errorCode: 'NOT_FOUND',
          chatId: validChatId,
          messageId: validMessageId,
          fileId: message.attachment.fileId,
        })
        throw new IpcHandlerError('NOT_FOUND', 'Failed to download the attachment')
      }

      let openError: string
      try {
        openError = await attachments.openPath(downloaded.localPath)
      } catch (err) {
        throw new FilesystemError('Failed to open the attachment', { cause: err })
      }
      if (openError) {
        // `openError` is `shell.openPath`'s own OS-level message, which can
        // echo the filesystem path it tried to open - never logged verbatim
        // (see Task 18, "Не возвращать renderer... Не логировать
        // содержимое файлов"), only a fixed marker distinguishing this
        // failure mode from a thrown exception above.
        throw new FilesystemError('Failed to open the attachment', {
          cause: new Error('shell.openPath reported an error'),
        })
      }
    },
  )
}
