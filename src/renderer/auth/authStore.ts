import type { AuthorizationState, AuthorizationStatus } from '../../shared/models'
import type { ElectronAPI, Unsubscribe } from '../../shared/ipc'
import {
  mapAuthError,
  mapAuthFlowTerminated,
  mapAuthInputRejected,
  mapVerificationTimeout,
  type AuthStep,
} from './authErrors'
import { resolveAuthScreen, type AuthScreen } from './resolveAuthScreen'

export type SubmitPhase = 'idle' | 'submitting' | 'verifying'

export interface AuthSnapshot {
  status: AuthorizationStatus
  screen: AuthScreen
  phase: SubmitPhase
  error: string | null
  /**
   * Set once `events.onAuthFlowTerminated` fires - the current login attempt
   * can never accept another phone/code/password submission (see
   * docs/tdlib-integration.md, "Retry semantics"). Blocks further submits
   * until a real `authStateChanged` event proves the backend moved on.
   */
  fatal: boolean
}

export interface AuthStoreDeps {
  auth: ElectronAPI['auth']
  events: Pick<
    ElectronAPI['events'],
    'onAuthStateChanged' | 'onAuthInputRejected' | 'onAuthFlowTerminated'
  >
}

export interface AuthStore {
  getSnapshot(): AuthSnapshot
  subscribe(listener: () => void): Unsubscribe
  /** Loads the current state and subscribes to updates. Returns the cleanup (unsubscribe). */
  init(): Unsubscribe
  submitPhone(phone: string): Promise<void>
  submitCode(code: string): Promise<void>
  submitPassword(password: string): Promise<void>
}

/**
 * How long to wait, after `setPhoneNumber`/`checkCode`/`checkPassword`
 * resolves, for a real `authorizationState` change before assuming the
 * value was rejected. Necessary because those calls resolve as soon as the
 * value reaches TDLib's login handshake, not once TDLib has validated it -
 * see docs/tdlib-integration.md, "Retry semantics" section. These are
 * best-effort UX constants, not a TDLib-documented timing guarantee.
 */
const DEFAULT_VERIFY_TIMEOUT_MS: Record<AuthStep, number> = {
  phone: 20000,
  code: 15000,
  password: 15000,
}

const INITIAL_SNAPSHOT: AuthSnapshot = {
  status: 'unknown',
  screen: 'loading',
  phase: 'idle',
  error: null,
  fatal: false,
}

export function createAuthStore(
  deps: AuthStoreDeps,
  verifyTimeoutMs: Record<AuthStep, number> = DEFAULT_VERIFY_TIMEOUT_MS,
): AuthStore {
  let snapshot: AuthSnapshot = INITIAL_SNAPSHOT
  const listeners = new Set<() => void>()

  // Bumped on every real state change and every new submit - invalidates
  // any in-flight verify-timeout or async result from a superseded attempt.
  let generation = 0

  function notify(): void {
    for (const listener of listeners) listener()
  }

  function patchSnapshot(patch: Partial<AuthSnapshot>): void {
    snapshot = { ...snapshot, ...patch }
    notify()
  }

  function applyStatus(status: AuthorizationStatus): void {
    patchSnapshot({
      status,
      screen: resolveAuthScreen(status),
      phase: 'idle',
      error: null,
      fatal: false,
    })
  }

  function getSnapshot(): AuthSnapshot {
    return snapshot
  }

  function subscribe(listener: () => void): Unsubscribe {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function init(): Unsubscribe {
    deps.auth
      .getState()
      .then((state: AuthorizationState) => applyStatus(state.status))
      .catch(() => applyStatus('unknown'))

    const unsubscribeStateChanged = deps.events.onAuthStateChanged((state) => {
      generation++ // a real state change supersedes any pending verify-timeout
      applyStatus(state.status)
    })

    // A confirmed rejection (tdl's own `retry` signal, see
    // docs/tdlib-integration.md) - ends "verifying" immediately instead of
    // waiting for the best-effort timeout below.
    const unsubscribeInputRejected = deps.events.onAuthInputRejected(({ step }) => {
      generation++
      patchSnapshot({ phase: 'idle', error: mapAuthInputRejected(step) })
    })

    // The login flow is dead until the app restarts - see AuthSnapshot.fatal.
    const unsubscribeFlowTerminated = deps.events.onAuthFlowTerminated(() => {
      generation++
      patchSnapshot({ phase: 'idle', fatal: true, error: mapAuthFlowTerminated() })
    })

    return () => {
      unsubscribeStateChanged()
      unsubscribeInputRejected()
      unsubscribeFlowTerminated()
    }
  }

  function runSubmit(step: AuthStep, action: () => Promise<void>): Promise<void> {
    if (snapshot.phase !== 'idle' || snapshot.fatal) {
      return Promise.resolve() // duplicate-submit guard: one in-flight attempt at a time; fatal blocks all further submits
    }
    const myGeneration = ++generation
    patchSnapshot({ phase: 'submitting', error: null })

    return action()
      .then(() => {
        if (myGeneration !== generation) return
        patchSnapshot({ phase: 'verifying' })
        setTimeout(() => {
          if (myGeneration !== generation) return
          patchSnapshot({ phase: 'idle', error: mapVerificationTimeout(step) })
        }, verifyTimeoutMs[step])
      })
      .catch((err: unknown) => {
        if (myGeneration !== generation) return
        patchSnapshot({ phase: 'idle', error: mapAuthError(err) })
      })
  }

  return {
    getSnapshot,
    subscribe,
    init,
    submitPhone: (phone) => runSubmit('phone', () => deps.auth.setPhoneNumber(phone)),
    submitCode: (code) => runSubmit('code', () => deps.auth.checkCode(code)),
    submitPassword: (password) => runSubmit('password', () => deps.auth.checkPassword(password)),
  }
}
