/**
 * User-facing error copy for the authorization flow.
 *
 * The IPC boundary (Task 06, `shared/ipc/errors.ts`) only ever carries three
 * generic codes (`NOT_IMPLEMENTED` | `INVALID_ARGUMENT` | `INTERNAL_ERROR`)
 * plus a message string - it never carries a TDLib-specific reason like
 * "wrong code" or "flood wait" (see docs/tdlib-integration.md, "Retry
 * semantics" section, for why: `checkCode`/`checkPassword` resolve as soon
 * as the value is handed to TDLib, before TDLib has actually validated it).
 * The two message substrings matched below are this codebase's *own* fixed
 * strings (`src/main/ipc/authHandlers.ts`, `src/main/tdlib/lifecycle.ts`),
 * not TDLib's - matching TDLib's own error text would be exactly the kind
 * of guessed, unverified error code this task must not invent.
 */

const BACKEND_UNAVAILABLE_MESSAGE = 'TDLib backend is not available'
const OUT_OF_SYNC_MESSAGE_PREFIX = 'TDLib is not currently waiting for'

const GENERIC_ERROR_MESSAGE =
  'Не удалось выполнить запрос. Проверьте соединение и попробуйте снова.'

export function mapAuthError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message.includes(BACKEND_UNAVAILABLE_MESSAGE)) {
      return 'Служба Telegram недоступна. Перезапустите приложение.'
    }
    if (err.message.startsWith(OUT_OF_SYNC_MESSAGE_PREFIX)) {
      return 'Шаг авторизации устарел. Попробуйте ещё раз.'
    }
    if (err.name === 'INVALID_ARGUMENT') {
      return 'Введены некорректные данные. Проверьте поле и попробуйте снова.'
    }
  }
  return GENERIC_ERROR_MESSAGE
}

export type AuthStep = 'phone' | 'code' | 'password'

/**
 * Shown when a submitted phone/code/password produced no observable
 * response from TDLib within the timeout - see docs/tdlib-integration.md.
 * This is an inferred, best-effort message ("might be wrong"), not a
 * confirmed TDLib error - the current IPC contract has no way to confirm
 * it, so the copy deliberately doesn't claim certainty.
 */
export function mapVerificationTimeout(step: AuthStep): string {
  switch (step) {
    case 'phone':
      return 'Не удалось подтвердить номер телефона. Проверьте номер и попробуйте снова.'
    case 'code':
      return 'Неверный код или истекло время ожидания. Попробуйте снова.'
    case 'password':
      return 'Неверный пароль или истекло время ожидания. Попробуйте снова.'
  }
}

/**
 * Shown on `events.onAuthInputRejected` - a confirmed TDLib rejection
 * (`retry === true`, see docs/tdlib-integration.md), unlike
 * `mapVerificationTimeout`'s best-effort guess. The copy is assertive
 * ("неверный"), not hedged, because this is no longer an inference.
 */
export function mapAuthInputRejected(step: AuthStep): string {
  switch (step) {
    case 'phone':
      return 'Неверный номер телефона. Попробуйте снова.'
    case 'code':
      return 'Неверный код. Попробуйте снова.'
    case 'password':
      return 'Неверный пароль. Попробуйте снова.'
  }
}

/**
 * Shown on `events.onAuthFlowTerminated` - `tdl`'s login() promise itself
 * rejected (a non-retryable auth error), so this login attempt can never
 * accept another phone/code/password submission (see
 * docs/tdlib-integration.md, "Retry semantics"). Unlike every other error
 * in this file, retrying the same step cannot recover from this - only
 * restarting the app can.
 */
export function mapAuthFlowTerminated(): string {
  return 'Авторизация была прервана. Перезапустите приложение, чтобы войти снова.'
}
