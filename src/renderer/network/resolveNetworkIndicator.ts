import type { NetworkStatus } from '../../shared/ipc'

/**
 * Minimal display state for the network banner (Task 17, docs/plan.md
 * "Domain network state") - collapses TDLib's five real `connectionState`
 * variants (plus `'unknown'`) down to the three the UI actually
 * distinguishes. `NetworkStatus` itself (shared/ipc/events.ts) stays the one
 * canonical model crossing the IPC boundary; this is a pure display mapping
 * only, the same role `resolveAuthScreen` plays for `AuthorizationStatus`.
 */
export type NetworkIndicator = 'offline' | 'connecting' | 'online'

export function resolveNetworkIndicator(status: NetworkStatus): NetworkIndicator {
  switch (status) {
    case 'ready':
      return 'online'
    case 'waitingForNetwork':
      return 'offline'
    case 'connectingToProxy':
    case 'connecting':
    case 'updating':
      return 'connecting'
    default:
      // 'unknown' (no update observed yet, or a future TDLib state this app
      // doesn't recognize) must never be shown as "online" - see docs/plan.md
      // Task 17, "Initial state".
      return 'connecting'
  }
}

const LABELS: Record<NetworkIndicator, string> = {
  offline: 'Нет подключения',
  connecting: 'Подключение…',
  online: 'Подключено',
}

export function networkIndicatorLabel(indicator: NetworkIndicator): string {
  return LABELS[indicator]
}
