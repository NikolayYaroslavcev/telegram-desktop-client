/**
 * Single structured logger for the main process (Task 18). Deliberately a
 * thin typed `console` wrapper, not a logging framework - every call site
 * passes a fixed set of safe fields, never a raw Error/TDLib object.
 *
 * Every caller is responsible for only ever passing safe data via `details`:
 * never message text, credentials, file contents, or a raw Error/TDLib
 * update object - see `describeErrorForLog` below for the one sanctioned way
 * to turn an unknown thrown value into a loggable string.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogFields {
  /** What was being attempted, e.g. "messages.sendText" or "realtime.updateNewMessage". */
  operation: string
  /** This app's own IpcErrorCode, when the log is about a classified error. */
  errorCode?: string
  /** A finer-grained category within `errorCode`, e.g. TdlibErrorKind ("client", "authorization"). */
  category?: string
  chatId?: number
  messageId?: number
  fileId?: number
  /**
   * Extra safe, structured detail - short diagnostic strings/numbers/booleans
   * only. Never message text, file paths, credentials, or a raw Error/TDLib
   * object.
   */
  details?: Record<string, string | number | boolean | undefined>
}

/**
 * Debug logs are dropped outside development. `VITE_DEV_SERVER_URL` is the
 * same isDev signal `src/main/index.ts` already uses for its CSP policy -
 * only ever set by `npm run dev`, never in a packaged build - so production
 * logs stay diagnostic without turning every high-frequency realtime update
 * into log spam (see Task 18, "Logging volume").
 */
function isDev(): boolean {
  return Boolean(process.env.VITE_DEV_SERVER_URL)
}

function write(level: LogLevel, fields: LogFields): void {
  if (level === 'debug' && !isDev()) return

  const line = JSON.stringify({ level, time: new Date().toISOString(), ...fields })

  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  debug: (fields: LogFields): void => write('debug', fields),
  info: (fields: LogFields): void => write('info', fields),
  warn: (fields: LogFields): void => write('warn', fields),
  error: (fields: LogFields): void => write('error', fields),
}

const MAX_DETAIL_LENGTH = 300

/**
 * Extracts a short, safe diagnostic string from an unknown thrown value -
 * only `name`/`message`, truncated, never the full object or a stack trace.
 * The one sanctioned way to turn a caught error into loggable detail.
 *
 * Node/Electron filesystem errors (`ENOENT`, `EACCES`, ...) and
 * better-sqlite3 errors (`SQLITE_CONSTRAINT`, ...) carry a short, safe
 * *string* `code` - but their `.message` often embeds the absolute path or
 * SQL text that caused them. When a string `code` is present it is used
 * instead of `.message` for exactly that reason. TDLib's own errors carry a
 * *numeric* `code` (td_api's `error.code`) and a safe, path-free `.message`
 * (e.g. "PHONE_NUMBER_INVALID") - those fall through to `.message` as before.
 */
export function describeErrorForLog(err: unknown): { name?: string; message: string } {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0) {
      return { name: err.name, message: code.slice(0, MAX_DETAIL_LENGTH) }
    }
    return { name: err.name, message: err.message.slice(0, MAX_DETAIL_LENGTH) }
  }
  if (err === undefined) return { message: 'undefined' }
  return { message: String(err).slice(0, MAX_DETAIL_LENGTH) }
}
