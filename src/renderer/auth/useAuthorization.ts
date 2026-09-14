import { useEffect, useState, useSyncExternalStore } from 'react'
import { createAuthStore, type AuthSnapshot, type AuthStore } from './authStore'

export type UseAuthorizationResult = AuthSnapshot &
  Pick<AuthStore, 'submitPhone' | 'submitCode' | 'submitPassword'>

/**
 * The single source of authorization state on the renderer side - call this
 * once (in `AuthGate`) and pass its result down as props. All the actual
 * logic (state machine, retry/timeout handling, duplicate-submit guard)
 * lives in the framework-agnostic `authStore`, which is what's unit tested;
 * this hook is a thin, untested-by-design binding of that store to React
 * (`useSyncExternalStore` already guarantees correct subscribe-on-mount/
 * unsubscribe-on-unmount semantics).
 */
export function useAuthorization(): UseAuthorizationResult {
  const [store] = useState<AuthStore>(() =>
    createAuthStore({ auth: window.electronAPI.auth, events: window.electronAPI.events }),
  )

  useEffect(() => store.init(), [store])

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)

  return {
    ...snapshot,
    submitPhone: store.submitPhone,
    submitCode: store.submitCode,
    submitPassword: store.submitPassword,
  }
}
