/**
 * Serializable IPC error shape. Renderer must never see a raw main-process
 * `Error` (stack trace, TDLib error objects, arbitrary enumerable fields) -
 * only this fixed, JSON-safe shape crosses the boundary.
 */
export interface IpcError {
  code: IpcErrorCode
  message: string
}

/**
 * `NOT_AUTHORIZED` - the TDLib backend/session isn't available or ready for
 * this call. `NOT_FOUND` - a referenced remote resource (e.g. a file TDLib
 * no longer has) doesn't exist. `NOT_ALLOWED` - the operation isn't valid in
 * the current state (e.g. an auth step submitted out of order). `TDLIB_ERROR`
 * - TDLib itself rejected/failed a call. `STORAGE_ERROR` - the local SQLite
 * cache failed. `FILESYSTEM_ERROR` - a local file operation (dialog/
 * read/open) failed. `NETWORK_ERROR` - reserved for a future distinctly
 * network-caused failure; Task 17's connection state already covers
 * connectivity, so no current call site produces this yet.
 */
export type IpcErrorCode =
  | 'NOT_IMPLEMENTED'
  | 'INVALID_ARGUMENT'
  | 'NOT_AUTHORIZED'
  | 'NOT_FOUND'
  | 'NOT_ALLOWED'
  | 'TDLIB_ERROR'
  | 'STORAGE_ERROR'
  | 'FILESYSTEM_ERROR'
  | 'NETWORK_ERROR'
  | 'INTERNAL_ERROR'

/**
 * Thrown by main-process IPC handlers. `serializeIpcError`/`deserializeIpcError`
 * carry its `{ code, message }` across `ipcMain.handle` -> `ipcRenderer.invoke`,
 * which otherwise only preserves the thrown error's `message` string.
 */
export class IpcHandlerError extends Error {
  readonly code: IpcErrorCode

  constructor(code: IpcErrorCode, message: string) {
    super(message)
    this.name = 'IpcHandlerError'
    this.code = code
  }

  toIpcError(): IpcError {
    return { code: this.code, message: this.message }
  }
}

const IPC_ERROR_PREFIX = '__ipc_error__:'

/** Main side: encode an IpcError into a string an Electron-thrown Error can carry. */
export function serializeIpcError(error: IpcError): string {
  return IPC_ERROR_PREFIX + JSON.stringify(error)
}

/** Preload side: recover the IpcError from a rejected invoke()'s error message, if present. */
export function deserializeIpcError(message: string): IpcError | null {
  const index = message.indexOf(IPC_ERROR_PREFIX)
  if (index === -1) return null

  try {
    const parsed: unknown = JSON.parse(message.slice(index + IPC_ERROR_PREFIX.length))
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as IpcError).code === 'string' &&
      typeof (parsed as IpcError).message === 'string'
    ) {
      return parsed as IpcError
    }
  } catch {
    // Not our envelope - fall through to null.
  }
  return null
}
