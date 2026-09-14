import { useEffect, useState, useSyncExternalStore } from 'react'
import { createNetworkStore, type NetworkSnapshot, type NetworkStore } from './networkStore'

/**
 * The single source of network state on the renderer side - see
 * `useAuthorization`, which this mirrors. Call it anywhere a component needs
 * to know the current network state; each call binds to the same underlying
 * `window.electronAPI.network`/`events.onNetworkStateChanged` contract
 * independently (`NetworkIndicator` and `MessageScreen` each own their own
 * store instance, exactly like every other `on...` subscription in this app).
 */
export function useNetworkStatus(): NetworkSnapshot {
  const [store] = useState<NetworkStore>(() =>
    createNetworkStore({ network: window.electronAPI.network, events: window.electronAPI.events }),
  )

  useEffect(() => store.init(), [store])

  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
