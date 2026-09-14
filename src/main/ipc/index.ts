import type { IpcMain } from 'electron'
import type { MessageRepository } from '../storage'
import type { TdlibService } from '../tdlib'
import { registerAppHandlers } from './appHandlers'
import { registerAuthHandlers } from './authHandlers'
import { registerChatsHandlers } from './chatsHandlers'
import { registerMessagesHandlers, type AttachmentIpcDeps } from './messagesHandlers'
import { registerNetworkHandlers } from './networkHandlers'

export { createEventBroadcaster, type IpcEventBroadcaster } from './eventBroadcaster'
export type { AttachmentIpcDeps } from './messagesHandlers'

/**
 * Registers every handler in the IPC contract on the given `ipcMain`. The
 * only entry point `src/main/index.ts` needs from this module.
 */
export function registerIpcHandlers(
  ipcMain: IpcMain,
  getTdlibService: () => TdlibService | null,
  getMessageRepository: () => MessageRepository | null,
  attachments: AttachmentIpcDeps,
): void {
  registerAppHandlers(ipcMain)
  registerAuthHandlers(ipcMain, getTdlibService)
  registerChatsHandlers(ipcMain, getTdlibService)
  registerNetworkHandlers(ipcMain, getTdlibService)
  registerMessagesHandlers(ipcMain, getTdlibService, getMessageRepository, attachments)
}
