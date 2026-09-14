import type { AuthorizationStatus } from '../../shared/models'

/**
 * Screens this task implements. Every `AuthorizationStatus` this app
 * doesn't have a dedicated screen for (email login, other-device
 * confirmation, registration, TDLib's own startup states, `unknown`, or a
 * shutdown state) falls back to `'loading'` - a safe, non-authenticated
 * placeholder, never treated as success.
 */
export type AuthScreen = 'phone' | 'code' | 'password' | 'ready' | 'loading'

export function resolveAuthScreen(status: AuthorizationStatus): AuthScreen {
  switch (status) {
    case 'waitPhoneNumber':
      return 'phone'
    case 'waitCode':
      return 'code'
    case 'waitPassword':
      return 'password'
    case 'ready':
      return 'ready'
    default:
      return 'loading'
  }
}

/**
 * Loading-screen copy varies only cosmetically: startup states read as
 * "preparing", a live TDLib session shutting down reads as "disconnecting".
 * Never a hard error - `resolveAuthScreen` already guarantees this text is
 * shown only for a state this app doesn't otherwise handle.
 */
const SHUTDOWN_STATUSES: ReadonlySet<AuthorizationStatus> = new Set([
  'loggingOut',
  'closing',
  'closed',
])

export function loadingMessageFor(status: AuthorizationStatus): string {
  return SHUTDOWN_STATUSES.has(status) ? 'Соединение...' : 'Подготовка...'
}
