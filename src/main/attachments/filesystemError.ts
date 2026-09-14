/**
 * Typed error for local filesystem/dialog operations (Task 18) - mirrors
 * `TdlibServiceError`/`StorageError`: thrown at the point a raw Node
 * `fs`/Electron `dialog`/`shell` failure is caught, carrying a fixed safe
 * message (never an absolute path or OS error text) plus the original error
 * as `cause` for logging.
 */
export class FilesystemError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'FilesystemError'
  }
}
