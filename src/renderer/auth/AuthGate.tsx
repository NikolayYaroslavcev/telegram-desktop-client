import { useAuthorization } from './useAuthorization'
import { PhoneStep } from './PhoneStep'
import { CodeStep } from './CodeStep'
import { PasswordStep } from './PasswordStep'
import { ReadyScreen } from './ReadyScreen'
import { LoadingScreen } from './LoadingScreen'

/**
 * The one place the renderer decides which authorization screen to show -
 * see docs/tdlib-integration.md. Owns the single `useAuthorization()` call;
 * every screen below only receives props, never reads `window.electronAPI`
 * itself.
 */
export function AuthGate(): React.JSX.Element {
  const { status, screen, phase, error, submitPhone, submitCode, submitPassword } =
    useAuthorization()
  const submitting = phase !== 'idle'

  switch (screen) {
    case 'phone':
      return <PhoneStep submitting={submitting} error={error} onSubmit={submitPhone} />
    case 'code':
      return <CodeStep submitting={submitting} error={error} onSubmit={submitCode} />
    case 'password':
      return <PasswordStep submitting={submitting} error={error} onSubmit={submitPassword} />
    case 'ready':
      return <ReadyScreen />
    case 'loading':
      return <LoadingScreen status={status} />
  }
}
