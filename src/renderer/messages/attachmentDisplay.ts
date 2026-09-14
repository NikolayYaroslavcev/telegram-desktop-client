/**
 * Human-readable file size for a document's byte count (Task 14, "File
 * message"). Pure and TDLib-agnostic, same reasoning as `messageList.ts`/
 * `replyPreview.ts` - kept out of the component so it's testable on its own.
 */
export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} КБ`
  const mb = kb / 1024
  return `${mb.toFixed(1)} МБ`
}
