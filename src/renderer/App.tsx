import { AuthGate } from './auth/AuthGate'
import { NetworkIndicator } from './network/NetworkIndicator'
import { ThemeToggle } from './theme/ThemeToggle'

/**
 * App shell (UI polish pass 2): `NetworkIndicator` sits in normal flow above
 * everything else, so a shown banner pushes content down instead of
 * floating over a screen's own header (see NetworkIndicator.tsx). The
 * content region below it is `relative`, giving `ThemeToggle` a stable
 * corner to anchor to (`absolute`, not viewport-`fixed`) that never drifts
 * outside the actual content area - and every screen underneath fills it
 * via `h-full`, not its own `h-screen`.
 */
export function App(): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <NetworkIndicator />
      <div className="relative min-h-0 flex-1">
        <ThemeToggle />
        <AuthGate />
      </div>
    </div>
  )
}
