import * as path from 'node:path'
import * as tdl from 'tdl'
import { getTdjson } from 'prebuilt-tdlib'
import { TdlibServiceError } from './types'

/**
 * Inside an asar-packaged Electron app, `getTdjson()` resolves via
 * `require.resolve()`, which returns the *virtual* in-archive path
 * (".../app.asar/node_modules/...") even though electron-builder's default
 * native-file detection physically unpacks `tdjson.dll` into
 * "app.asar.unpacked". Windows' LoadLibrary cannot open a path "inside" the
 * single-file .asar archive (Win32 error 126, "module not found") - verified
 * empirically for Task 01.6, see docs/tdlib-decision.md. Rewriting the
 * virtual path to its real on-disk unpacked counterpart is the standard
 * Electron workaround. No-op outside a packaged app (no "app.asar" segment
 * in the resolved path).
 *
 * This mirrors spike/connect.ts's resolveTdjsonPath() - duplicated
 * deliberately rather than imported, since spike/ is reference-only
 * documentation and must stay untouched, while this production layer must
 * not depend on it.
 */
export function rewriteAsarPath(resolved: string): string {
  const asarMarker = `app.asar${path.sep}`
  const unpackedMarker = `app.asar.unpacked${path.sep}`
  if (resolved.includes(asarMarker) && !resolved.includes(unpackedMarker)) {
    return resolved.replace(asarMarker, unpackedMarker)
  }
  return resolved
}

export function resolveTdjsonPath(): string {
  return rewriteAsarPath(getTdjson())
}

let configured = false

/**
 * Runs `tdl.configure()` exactly once for the lifetime of the process.
 * Must be called before any `tdl.createClient()` call and must never be
 * called again afterward - calling it more than once, or after a client
 * exists, is not a supported tdl usage pattern.
 */
export function configureTdlibNative(): void {
  if (configured) return
  try {
    tdl.configure({ tdjson: resolveTdjsonPath() })
    configured = true
  } catch (err) {
    throw new TdlibServiceError('native-load', 'Failed to load the native TDLib (tdjson) library', {
      cause: err,
    })
  }
}
