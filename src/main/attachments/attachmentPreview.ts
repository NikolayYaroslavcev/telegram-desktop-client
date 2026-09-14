/**
 * Telegram photos are always transcoded server-side to JPEG (see
 * docs/plan.md Task 14, "no transcoding pipeline of our own" - this relies
 * on that TDLib/server guarantee rather than sniffing the downloaded
 * bytes). Pure by design: takes already-downloaded bytes in, returns a
 * `data:` URL out - no filesystem access here, so it's testable without a
 * real download and reusable regardless of how the bytes were read.
 */
export function buildPhotoPreviewDataUrl(bytes: Uint8Array): string {
  return `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`
}
