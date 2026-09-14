import type { Client } from 'tdl'
import { TdlibServiceError, type DownloadedFile } from './types'

/**
 * Only `invoke` is needed - same narrowing as `MessageSendClient`/
 * `ChatDiscoveryClient`, so tests can drive this with a plain fake object.
 */
export type FileDownloadClient = Pick<Client, 'invoke'>

export interface DownloadRetryOptions {
  /** Total attempts before giving up, including the first. Default 3. */
  attempts?: number
  /** Delay between attempts, in ms. Default 600. */
  delayMs?: number
  /** Injectable for tests - real callers get an actual timer wait. */
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_ATTEMPTS = 3
const DEFAULT_DELAY_MS = 600

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Downloads one file via TDLib's `downloadFile`, `synchronous: true` so the
 * call only resolves once the download has actually finished (or failed) -
 * no separate `updateFile` polling is needed for this task's scope. If the
 * file is already fully downloaded locally (TDLib's own `use_file_database`
 * persists this across app restarts), TDLib itself treats the call as a
 * cheap no-op and resolves immediately with the existing local state - this
 * function does not add its own "already downloaded" short-circuit on top.
 *
 * Retries a few times (Task 20 fix) before giving up: right after this
 * client's own `sendAttachment` call, or right after a restart re-requests
 * every photo's preview at once, TDLib/the server can genuinely not have
 * finished processing a just-uploaded photo's size variants yet - a single
 * `downloadFile` call can legitimately report "not complete" for a file that
 * finishes seconds later. A manual "Повторить" click still works the same
 * way it always did (this is just that same retry, done automatically a few
 * times first) - it does not paper over a real, permanent failure (deleted
 * server-side, etc.), which still returns `null` after all attempts.
 *
 * Returns `null` when TDLib reports the download did not actually complete
 * (e.g. the file was deleted server-side) rather than throwing - only an
 * outright TDLib/client failure is an error.
 */
export async function downloadTdlibFile(
  client: FileDownloadClient,
  fileId: number,
  options: DownloadRetryOptions = {},
): Promise<DownloadedFile | null> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS
  const sleep = options.sleep ?? defaultSleep

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let file
    try {
      file = await client.invoke({
        _: 'downloadFile',
        file_id: fileId,
        priority: 1,
        offset: 0,
        limit: 0,
        synchronous: true,
      })
    } catch (err) {
      throw new TdlibServiceError('client', 'Failed to download the file via TDLib', { cause: err })
    }

    if (file.local.is_downloading_completed && file.local.path.length > 0) {
      return { localPath: file.local.path, size: file.size }
    }

    if (attempt < attempts) await sleep(delayMs)
  }

  return null
}
