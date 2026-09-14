import type { ElectronAPI, NetworkState, NetworkStatus, Unsubscribe } from '../../shared/ipc'

export interface NetworkSnapshot {
  status: NetworkStatus
}

export interface NetworkStoreDeps {
  network: ElectronAPI['network']
  events: Pick<ElectronAPI['events'], 'onNetworkStateChanged'>
}

export interface NetworkStore {
  getSnapshot(): NetworkSnapshot
  subscribe(listener: () => void): Unsubscribe
  /** Loads the current state and subscribes to updates. Returns the cleanup (unsubscribe). */
  init(): Unsubscribe
}

/**
 * `'unknown'` until `network.getState()` resolves or the first
 * `onNetworkStateChanged` event arrives - never a guessed `'ready'`. Same
 * "don't lie about the initial value" shape as `authStore`'s
 * `INITIAL_SNAPSHOT`.
 */
const INITIAL_SNAPSHOT: NetworkSnapshot = { status: 'unknown' }

/**
 * Framework-agnostic network-state store (Task 17), mirroring `authStore`'s
 * getSnapshot/subscribe/init shape so `useNetworkStatus` can bind it via
 * `useSyncExternalStore` the same way `useAuthorization` does. Much simpler
 * than `authStore` on purpose - there is no submit flow, retry/timeout
 * inference, or fatal state here, only "what is the current network state".
 */
export function createNetworkStore(deps: NetworkStoreDeps): NetworkStore {
  let snapshot: NetworkSnapshot = INITIAL_SNAPSHOT
  const listeners = new Set<() => void>()

  function notify(): void {
    for (const listener of listeners) listener()
  }

  function applyStatus(status: NetworkStatus): void {
    snapshot = { status }
    notify()
  }

  function getSnapshot(): NetworkSnapshot {
    return snapshot
  }

  function subscribe(listener: () => void): Unsubscribe {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function init(): Unsubscribe {
    deps.network
      .getState()
      .then((state: NetworkState) => applyStatus(state.status))
      .catch(() => applyStatus('unknown'))

    return deps.events.onNetworkStateChanged((state) => applyStatus(state.status))
  }

  return { getSnapshot, subscribe, init }
}
