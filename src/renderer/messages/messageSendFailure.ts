const MESSAGE_SEND_FAILED_MESSAGE = 'Не удалось отправить сообщение. Попробуйте снова.'

/**
 * Shown on `events.onMessageSendFailed` (Task 12.1). The event carries no
 * TDLib error code/message (see `shared/ipc/events.ts`), so there is
 * nothing chat/message-specific to surface - this copy is always the same
 * fixed string, mirroring how `auth/authErrors.ts` keeps user-facing text
 * out of the component itself.
 */
export function mapMessageSendFailed(): string {
  return MESSAGE_SEND_FAILED_MESSAGE
}
