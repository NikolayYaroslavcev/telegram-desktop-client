/**
 * Typed error for the local SQLite storage layer (Task 18) - mirrors the
 * role `TdlibServiceError` already plays for `src/main/tdlib`: thrown at the
 * point a raw driver error is caught, carrying a fixed safe message (never
 * SQL text or bound values) plus the original error as `cause` for logging.
 */
export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StorageError'
  }
}
