import type { IpcMain } from 'electron'
import { IPC_CHANNELS, IpcHandlerError } from '../../shared/ipc'
import type { Chat } from '../../shared/models'
import type { TdlibService } from '../tdlib'
import { handle } from './handle'
import { requireTdlibService, runTdlibCall } from './tdlibHelpers'
import { requireFiniteNumber } from './validation'

/**
 * `chats.list` discovers private 1-on-1 chats via `TdlibService.getPrivateChats`
 * (Task 09) - filtering (private-only, bots excluded) and mapping to the
 * domain `Chat` model both happen there, not in this handler. `chats.open`
 * (Task 10) validates that `chatId` refers to an allowed private chat via
 * `TdlibService.getChat` (the same private/non-bot policy as `chats.list`,
 * applied to one chat instead of the whole list) and otherwise does nothing
 * - it is not a message screen, just the natural precondition check before
 * a renderer calls `messages.getHistory` for that chat.
 */
export function registerChatsHandlers(
  ipcMain: IpcMain,
  getTdlibService: () => TdlibService | null,
): void {
  handle(ipcMain, IPC_CHANNELS.chatsList, async (): Promise<Chat[]> => {
    const service = requireTdlibService(getTdlibService, 'chats.list')
    return runTdlibCall(() => service.getPrivateChats(), 'chats.list')
  })

  handle(ipcMain, IPC_CHANNELS.chatsOpen, async (_event, chatId: unknown): Promise<void> => {
    const validChatId = requireFiniteNumber(chatId, 'chatId')
    const service = requireTdlibService(getTdlibService, 'chats.open')

    const chat = await runTdlibCall(() => service.getChat(validChatId), 'chats.open')
    if (!chat) {
      throw new IpcHandlerError(
        'INVALID_ARGUMENT',
        'chatId does not refer to an allowed private chat',
      )
    }
  })
}
