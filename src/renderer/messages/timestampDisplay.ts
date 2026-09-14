/**
 * Wall-clock `HH:MM` label shown on each message bubble (UI polish pass).
 * `createdAt` is TDLib's `message.date`, Unix seconds (see
 * `src/main/tdlib/mappers/message.ts`) - converted to local time the same
 * way a user's own clock would read it, not UTC.
 */
export function formatMessageTimestamp(createdAt: number): string {
  const date = new Date(createdAt * 1000)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}
