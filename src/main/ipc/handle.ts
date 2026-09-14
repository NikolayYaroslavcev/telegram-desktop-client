import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { serializeIpcError } from '../../shared/ipc'
import { classifyAndLogIpcError } from './errorMapping'

/**
 * Wraps `ipcMain.handle` so every handler gets the same error boundary: any
 * thrown error is run through `classifyAndLogIpcError` (using `channel` as
 * the operation label) and serialized into the fixed `{ code, message }`
 * envelope - never a raw TDLib error, native `Error`, stack trace, or
 * filesystem/SQL detail reaching the renderer. This is also the backstop
 * that logs anything not already classified+logged by a lower-level helper
 * (`runTdlibCall`, `MessageRepository`, etc.) - see `errorMapping.ts`.
 */
export function handle<T>(
  ipcMain: IpcMain,
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T,
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    try {
      return await handler(event, ...args)
    } catch (err) {
      const ipcError = classifyAndLogIpcError(err, channel)
      throw new Error(serializeIpcError(ipcError))
    }
  })
}
