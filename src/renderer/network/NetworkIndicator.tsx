import { networkIndicatorLabel, resolveNetworkIndicator } from './resolveNetworkIndicator'
import { useNetworkStatus } from './useNetworkStatus'

/**
 * Minimal, always-visible network state banner (Task 17, docs/plan.md
 * "Renderer behavior") - rendered once above whatever screen `AuthGate`
 * currently shows (see `App.tsx`), so a lost connection is visible
 * regardless of whether the auth flow or a chat is on screen. Deliberately
 * not a separate network-settings screen, and never shows a raw TDLib error
 * - only the three states `resolveNetworkIndicator` maps to.
 *
 * Compact, non-intrusive: visually collapses to nothing while online
 * (`sr-only` keeps `role="status"` announcing it to assistive tech). When
 * shown, it's a normal-flow bar above the rest of the app (not `fixed`), so
 * it pushes content down instead of floating over a screen's own header -
 * all three states and the underlying recovery behavior in
 * `useNetworkStatus`/`resolveNetworkIndicator` are unchanged, only the
 * presentation.
 */
export function NetworkIndicator(): React.JSX.Element {
  const { status } = useNetworkStatus()
  const indicator = resolveNetworkIndicator(status)
  const label = networkIndicatorLabel(indicator)

  if (indicator === 'online') {
    return (
      <p role="status" className="sr-only">
        {label}
      </p>
    )
  }

  const tone = indicator === 'offline' ? 'bg-red-500' : 'bg-amber-500'

  return (
    <p
      role="status"
      className={`flex-none px-3 py-1 text-center text-xs font-medium text-white ${tone}`}
    >
      {label}
    </p>
  )
}
