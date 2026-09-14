import * as path from 'node:path'
import type { BrowserWindow, OpenDialogOptions, OpenDialogReturnValue } from 'electron'
import type { AttachmentType } from '../../shared/models/attachment'
import type { SelectedAttachmentFile } from '../../shared/ipc'
import { FilesystemError } from './filesystemError'

/** Narrowed to what this module actually calls - lets tests drive it with a plain fake instead of real Electron. */
export type OpenFileDialog = (
  window: BrowserWindow | null,
  options: OpenDialogOptions,
) => Promise<OpenDialogReturnValue>

export type StatFile = (filePath: string) => Promise<{ size: number }>

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']

/** Image filter for `type: 'photo'`; no filter (any file) for `type: 'document'`. */
export function buildAttachmentDialogOptions(type: AttachmentType): OpenDialogOptions {
  return {
    properties: ['openFile'],
    ...(type === 'photo' ? { filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }] } : {}),
  }
}

/**
 * Tracks exactly which local file paths this process's own file dialog has
 * handed to the renderer, and which attachment type each was picked as -
 * the trust boundary `messages.sendAttachment` checks before ever acting on
 * a renderer-supplied `filePath` (see docs/plan.md Task 14, "File input
 * security"). A path the renderer invents itself, never returned by
 * `selectAttachmentFile`, is rejected before any TDLib call.
 *
 * This is also how `sendAttachment(chatId, filePath, replyToMessageId?)` -
 * an existing contract method with no separate `type` argument - knows
 * whether to send a photo or a document: the type was already decided by
 * *which* dialog the user opened, not guessed from the renderer or the
 * file's extension.
 *
 * Single-use by design (`consume` deletes on read): a path stops being
 * trusted once it's been acted on, so resending after a failure requires
 * picking the file again - not a cache or dedup mechanism (out of scope,
 * see Task 15).
 */
export class AttachmentSelectionRegistry {
  private readonly selected = new Map<string, AttachmentType>()

  allow(filePath: string, type: AttachmentType): void {
    this.selected.set(filePath, type)
  }

  /** Returns the registered type for `filePath` and forgets it, or `undefined` if it was never (or no longer) registered. */
  consume(filePath: string): AttachmentType | undefined {
    const type = this.selected.get(filePath)
    if (type !== undefined) this.selected.delete(filePath)
    return type
  }
}

/**
 * Runs the main-process file dialog for one attachment `type`, records the
 * chosen path in `registry`, and returns just enough for the renderer to
 * show a picked-file preview and later call `sendAttachment` - never a Node
 * `fs` handle, and no other path the renderer could have picked becomes
 * usable as a side effect. `null` means the user cancelled the dialog.
 */
export async function selectAttachmentFile(
  openDialog: OpenFileDialog,
  statFile: StatFile,
  registry: AttachmentSelectionRegistry,
  window: BrowserWindow | null,
  type: AttachmentType,
): Promise<SelectedAttachmentFile | null> {
  const result = await openDialog(window, buildAttachmentDialogOptions(type))
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const filePath = result.filePaths[0]

  let stat: { size: number }
  try {
    stat = await statFile(filePath)
  } catch (err) {
    throw new FilesystemError('Failed to read the selected file', { cause: err })
  }

  registry.allow(filePath, type)

  return { filePath, fileName: path.basename(filePath), size: stat.size }
}
