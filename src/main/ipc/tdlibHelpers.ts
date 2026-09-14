import { IpcHandlerError } from '../../shared/ipc'
import type { TdlibService } from '../tdlib'
import { classifyAndLogIpcError } from './errorMapping'
import { logger } from '../logger'

/**
 * Shared by every `*Handlers.ts` module that calls into `TdlibService`:
 * fail fast with a controlled error when the backend hasn't started yet,
 * instead of each handler re-deriving the same null check. `operation`
 * labels which IPC call this is for diagnostic logging (see `logger.ts`).
 */
export function requireTdlibService(
  getTdlibService: () => TdlibService | null,
  operation: string,
): TdlibService {
  const service = getTdlibService()
  if (!service) {
    logger.warn({ operation, errorCode: 'NOT_AUTHORIZED', category: 'availability' })
    throw new IpcHandlerError('NOT_AUTHORIZED', 'TDLib backend is not available')
  }
  return service
}

/**
 * Runs one backend call, mapping any failure through `classifyAndLogIpcError`
 * - never lets a raw `TdlibServiceError` (or anything else) escape this
 * module. `operation` labels the specific backend call for diagnostic
 * logging, e.g. "messages.sendText" or "messages.getHistory:tdlib".
 */
export async function runTdlibCall<T>(fn: () => Promise<T>, operation: string): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const ipcError = classifyAndLogIpcError(err, operation)
    throw new IpcHandlerError(ipcError.code, ipcError.message)
  }
}
