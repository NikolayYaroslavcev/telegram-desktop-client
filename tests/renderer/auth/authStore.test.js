'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { createAuthStore } = require(
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    'out',
    'renderer-logic',
    'renderer',
    'auth',
    'authStore.js',
  ),
)

const TEST_TIMEOUTS = { phone: 50, code: 50, password: 50 }

function makeIpcError(code, message) {
  const err = new Error(message)
  err.name = code
  return err
}

/** Lets pending `.then()` chains (e.g. `getState().then(...)`) settle, without relying on any timer. */
function flush() {
  return Promise.resolve()
    .then(() => {})
    .then(() => {})
}

/** A fake `{ auth, events }` matching the slice of ElectronAPI the store depends on. */
function createFakeDeps(overrides = {}) {
  const authStateListeners = new Set()
  const authInputRejectedListeners = new Set()
  const authFlowTerminatedListeners = new Set()
  let unsubscribeCalls = 0

  const deps = {
    auth: {
      getState: async () => ({ status: 'waitPhoneNumber' }),
      setPhoneNumber: async () => {},
      checkCode: async () => {},
      checkPassword: async () => {},
      ...overrides.auth,
    },
    events: {
      onAuthStateChanged: (cb) => {
        authStateListeners.add(cb)
        return () => {
          unsubscribeCalls++
          authStateListeners.delete(cb)
        }
      },
      onAuthInputRejected: (cb) => {
        authInputRejectedListeners.add(cb)
        return () => authInputRejectedListeners.delete(cb)
      },
      onAuthFlowTerminated: (cb) => {
        authFlowTerminatedListeners.add(cb)
        return () => authFlowTerminatedListeners.delete(cb)
      },
    },
  }

  return {
    deps,
    emitAuthStateChanged: (status) => {
      for (const listener of authStateListeners) listener({ status })
    },
    emitAuthInputRejected: (step) => {
      for (const listener of authInputRejectedListeners) listener({ step })
    },
    emitAuthFlowTerminated: () => {
      for (const listener of authFlowTerminatedListeners) listener()
    },
    getUnsubscribeCalls: () => unsubscribeCalls,
    getListenerCount: () => authStateListeners.size,
  }
}

test('init() loads the initial state via auth.getState()', async () => {
  const { deps } = createFakeDeps({ auth: { getState: async () => ({ status: 'waitCode' }) } })
  const store = createAuthStore(deps, TEST_TIMEOUTS)

  const dispose = store.init()
  await flush()

  assert.equal(store.getSnapshot().status, 'waitCode')
  assert.equal(store.getSnapshot().screen, 'code')
  dispose()
})

test('init() falls back to "unknown" (safe loading state) if getState() rejects', async () => {
  const { deps } = createFakeDeps({
    auth: {
      getState: async () => {
        throw new Error('boom')
      },
    },
  })
  const store = createAuthStore(deps, TEST_TIMEOUTS)

  const dispose = store.init()
  await flush()

  assert.equal(store.getSnapshot().status, 'unknown')
  assert.equal(store.getSnapshot().screen, 'loading')
  dispose()
})

test('subscribing to onAuthStateChanged updates the snapshot and notifies listeners', async () => {
  const { deps, emitAuthStateChanged } = createFakeDeps()
  const store = createAuthStore(deps, TEST_TIMEOUTS)
  const dispose = store.init()
  await flush()

  let notifications = 0
  store.subscribe(() => notifications++)

  emitAuthStateChanged('waitPassword')

  assert.equal(store.getSnapshot().status, 'waitPassword')
  assert.equal(store.getSnapshot().screen, 'password')
  assert.equal(notifications, 1)
  dispose()
})

test("init()'s returned dispose function unsubscribes from onAuthStateChanged exactly once", async () => {
  const { deps, getUnsubscribeCalls, getListenerCount } = createFakeDeps()
  const store = createAuthStore(deps, TEST_TIMEOUTS)

  const dispose = store.init()
  assert.equal(getListenerCount(), 1)

  dispose()
  assert.equal(getUnsubscribeCalls(), 1)
  assert.equal(getListenerCount(), 0)
})

test('successful submitPhone: an authStateChanged event before the timeout clears phase/error, no false timeout error', async () => {
  const { deps, emitAuthStateChanged } = createFakeDeps()
  const store = createAuthStore(deps, TEST_TIMEOUTS)
  const dispose = store.init()
  await flush()

  const submitPromise = store.submitPhone('+15550001111')
  assert.equal(store.getSnapshot().phase, 'submitting')
  await submitPromise
  assert.equal(store.getSnapshot().phase, 'verifying')

  emitAuthStateChanged('waitCode')
  assert.equal(store.getSnapshot().phase, 'idle')
  assert.equal(store.getSnapshot().error, null)
  assert.equal(store.getSnapshot().screen, 'code')

  dispose()
})

test('successful submitCode calls auth.checkCode() with the submitted value', async () => {
  const calls = []
  const { deps } = createFakeDeps({
    auth: {
      checkCode: async (code) => {
        calls.push(code)
      },
    },
  })
  const store = createAuthStore(deps, TEST_TIMEOUTS)
  store.init()

  await store.submitCode('12345')
  assert.deepEqual(calls, ['12345'])
})

test('successful submitPassword calls auth.checkPassword() with the submitted value', async () => {
  const calls = []
  const { deps } = createFakeDeps({
    auth: {
      checkPassword: async (password) => {
        calls.push(password)
      },
    },
  })
  const store = createAuthStore(deps, TEST_TIMEOUTS)
  store.init()

  await store.submitPassword('correct horse battery staple')
  assert.deepEqual(calls, ['correct horse battery staple'])
})

test('an IPC error thrown by the submit call surfaces immediately as a mapped, non-raw message', async () => {
  const { deps } = createFakeDeps({
    auth: {
      checkCode: async () => {
        throw makeIpcError('INTERNAL_ERROR', 'TDLib is not currently waiting for code')
      },
    },
  })
  const store = createAuthStore(deps, TEST_TIMEOUTS)
  store.init()

  await store.submitCode('00000')

  const snapshot = store.getSnapshot()
  assert.equal(snapshot.phase, 'idle')
  assert.ok(snapshot.error)
  assert.ok(!snapshot.error.includes('TDLib'))
})

test('a submit with no observable state change infers failure after the verify timeout', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  return (async () => {
    const { deps } = createFakeDeps()
    const store = createAuthStore(deps, TEST_TIMEOUTS)
    store.init()
    await flush()

    await store.submitCode('00000')
    assert.equal(store.getSnapshot().phase, 'verifying')

    t.mock.timers.tick(TEST_TIMEOUTS.code)

    const snapshot = store.getSnapshot()
    assert.equal(snapshot.phase, 'idle')
    assert.ok(snapshot.error)
  })()
})

test('duplicate submit while an attempt is in flight is ignored (no second underlying call)', async () => {
  let callCount = 0
  let resolveFirst
  const { deps } = createFakeDeps({
    auth: {
      checkCode: () =>
        new Promise((resolve) => {
          callCount++
          resolveFirst = resolve
        }),
    },
  })
  const store = createAuthStore(deps, TEST_TIMEOUTS)
  store.init()

  const first = store.submitCode('11111')
  const second = store.submitCode('22222') // fired while the first is still "submitting"

  assert.equal(callCount, 1)
  resolveFirst()
  await Promise.all([first, second])
})

test('retry after an error works normally (the guard only blocks concurrent, not sequential, submits)', async () => {
  let attempt = 0
  const { deps } = createFakeDeps({
    auth: {
      checkPassword: async () => {
        attempt++
        if (attempt === 1) throw makeIpcError('INTERNAL_ERROR', 'Internal error')
      },
    },
  })
  const store = createAuthStore(deps, TEST_TIMEOUTS)
  store.init()

  await store.submitPassword('wrong')
  assert.ok(store.getSnapshot().error)
  assert.equal(store.getSnapshot().phase, 'idle')

  const retryPromise = store.submitPassword('correct')
  assert.equal(store.getSnapshot().phase, 'submitting')
  assert.equal(store.getSnapshot().error, null) // error is cleared as soon as a retry starts
  await retryPromise

  assert.equal(attempt, 2)
})

test('authInputRejected ends verifying immediately, without waiting for the timeout, and shows a step-specific error', async () => {
  const { deps, emitAuthInputRejected } = createFakeDeps()
  const store = createAuthStore(deps, TEST_TIMEOUTS)
  store.init()
  await flush()

  await store.submitCode('00000')
  assert.equal(store.getSnapshot().phase, 'verifying')

  emitAuthInputRejected('code')

  assert.equal(store.getSnapshot().phase, 'idle')
  assert.ok(store.getSnapshot().error)
})

test('after authInputRejected, the same step can be submitted again immediately', async () => {
  const calls = []
  const { deps, emitAuthInputRejected } = createFakeDeps({
    auth: {
      checkCode: async (code) => {
        calls.push(code)
      },
    },
  })
  const store = createAuthStore(deps, TEST_TIMEOUTS)
  store.init()
  await flush()

  await store.submitCode('00000')
  emitAuthInputRejected('code')

  await store.submitCode('11111')
  assert.deepEqual(calls, ['00000', '11111'])
})

test('authInputRejected does not fire a stale verify-timeout error after it already resolved the attempt', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  return (async () => {
    const { deps, emitAuthInputRejected } = createFakeDeps()
    const store = createAuthStore(deps, TEST_TIMEOUTS)
    store.init()
    await flush()

    await store.submitCode('00000')
    emitAuthInputRejected('code')
    const rejectedError = store.getSnapshot().error

    t.mock.timers.tick(TEST_TIMEOUTS.code)

    // The stale timeout callback must not overwrite the confirmed-rejection error.
    assert.equal(store.getSnapshot().error, rejectedError)
    assert.equal(store.getSnapshot().phase, 'idle')
  })()
})

test('authFlowTerminated ends verifying immediately and blocks further submits', async () => {
  const calls = []
  const { deps, emitAuthFlowTerminated } = createFakeDeps({
    auth: {
      checkCode: async (code) => {
        calls.push(code)
      },
    },
  })
  const store = createAuthStore(deps, TEST_TIMEOUTS)
  store.init()
  await flush()

  await store.submitCode('00000')
  assert.equal(store.getSnapshot().phase, 'verifying')

  emitAuthFlowTerminated()

  assert.equal(store.getSnapshot().phase, 'idle')
  assert.ok(store.getSnapshot().error)

  await store.submitCode('11111') // must be a no-op: the flow is dead until restart
  assert.deepEqual(calls, ['00000'])
})

test('a real state change cancels a pending verify-timeout from an earlier submit (no stale error overwrite)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  return (async () => {
    const { deps, emitAuthStateChanged } = createFakeDeps()
    const store = createAuthStore(deps, TEST_TIMEOUTS)
    store.init()
    await flush()

    await store.submitCode('00000')
    assert.equal(store.getSnapshot().phase, 'verifying')

    emitAuthStateChanged('waitPassword') // progress arrives just before the timeout would fire
    assert.equal(store.getSnapshot().phase, 'idle')
    assert.equal(store.getSnapshot().error, null)

    t.mock.timers.tick(TEST_TIMEOUTS.code)

    // The stale timeout must not have clobbered the successful transition.
    assert.equal(store.getSnapshot().phase, 'idle')
    assert.equal(store.getSnapshot().error, null)
    assert.equal(store.getSnapshot().status, 'waitPassword')
  })()
})
