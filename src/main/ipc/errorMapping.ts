import { FilesystemError } from '../attachments'
import { StorageError } from '../storage'
import { TdlibServiceError, type TdlibErrorKind } from '../tdlib'
import { IpcHandlerError, type IpcError, type IpcErrorCode } from '../../shared/ipc'
import { describeErrorForLog, logger } from '../logger'

/**
 * Maps this app's own `TdlibErrorKind` onto the IPC taxonomy. `authorization`
 * covers state/order violations (auth input submitted out of turn, the login
 * flow already terminated, an unsupported flow) - `NOT_ALLOWED` fits better
 * than a generic backend failure. Every other kind is a genuine TDLib-side
 * failure.
 */
const TDLIB_KIND_TO_IPC_CODE: Record<TdlibErrorKind, IpcErrorCode> = {
  authorization: 'NOT_ALLOWED',
  client: 'TDLIB_ERROR',
  configuration: 'TDLIB_ERROR',
  'native-load': 'TDLIB_ERROR',
  initialization: 'TDLIB_ERROR',
  shutdown: 'TDLIB_ERROR',
}

function causeDetails(cause: unknown): Record<string, string> | undefined {
  if (cause === undefined) return undefined
  const described = describeErrorForLog(cause)
  return described.name
    ? { causeName: described.name, causeMessage: described.message }
    : { causeMessage: described.message }
}

/**
 * The single funnel every main-process IPC error passes through: classifies
 * an unknown thrown value into the safe `{ code, message }` shape the
 * renderer is allowed to see, and logs whatever diagnostic detail is safe to
 * log (never message text, credentials, or a raw TDLib/Error object - see
 * `describeErrorForLog`).
 *
 * Called both by `runTdlibCall` (labels one specific backend call) and by
 * `handle()`'s own catch-all (labels the whole IPC channel, as a backstop
 * for anything not already wrapped, e.g. a `MessageRepository` call made
 * directly in a handler body). An `IpcHandlerError` reaching this function -
 * already classified and, if it warranted it, already logged by whatever
 * produced it - is passed through without logging again, so nothing is ever
 * logged twice for the same failure.
 */
export function classifyAndLogIpcError(err: unknown, operation: string): IpcError {
  if (err instanceof IpcHandlerError) {
    return err.toIpcError()
  }

  if (err instanceof TdlibServiceError) {
    const code = TDLIB_KIND_TO_IPC_CODE[err.kind]
    logger.error({
      operation,
      errorCode: code,
      category: err.kind,
      details: causeDetails(err.cause),
    })
    return { code, message: err.message }
  }

  if (err instanceof StorageError) {
    logger.error({
      operation,
      errorCode: 'STORAGE_ERROR',
      category: 'sqlite',
      details: causeDetails(err.cause),
    })
    return { code: 'STORAGE_ERROR', message: err.message }
  }

  if (err instanceof FilesystemError) {
    logger.error({
      operation,
      errorCode: 'FILESYSTEM_ERROR',
      category: 'fs',
      details: causeDetails(err.cause),
    })
    return { code: 'FILESYSTEM_ERROR', message: err.message }
  }

  const described = describeErrorForLog(err)
  logger.error({
    operation,
    errorCode: 'INTERNAL_ERROR',
    details: { name: described.name, message: described.message },
  })
  return { code: 'INTERNAL_ERROR', message: 'Internal error' }
}
