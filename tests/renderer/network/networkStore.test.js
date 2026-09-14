'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { createNetworkStore } = require(
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    'out',
    'renderer-logic',
    'renderer',
    'network',
    'networkStore.js',
  ),
)

/** Lets pending `.then()` chains (e.g. `getState().then(...)`) settle, without relying on any timer. */
function flush() {
  return Promise.resolve()
    .then(() => {})
    .then(() => {})
}

/** A fake `{ network, events }` matching the slice of ElectronAPI the store depends on. */
function createFakeDeps(overrides = {}) {
  const listeners = new Set()
  let unsubscribeCalls = 0

  const deps = {
    network: {
      getState: async () => ({ status: 'unknown' }),
      ...overrides.network,
    },
    events: {
      onNetworkStateChanged: (cb) => {
        listeners.add(cb)
        return () => {
          unsubscribeCalls++
          listeners.delete(cb)
        }
      },
    },
  }

  return {
    deps,
    emit: (status) => {
      for (const listener of listeners) listener({ status })
    },
    getUnsubscribeCalls: () => unsubscribeCalls,
    getListenerCount: () => listeners.size,
  }
}

test('the initial snapshot is "unknown" before init() resolves anything - never a guessed "ready"', () => {
  const { deps } = createFakeDeps()
  const store = createNetworkStore(deps)

  assert.equal(store.getSnapshot().status, 'unknown')
})

test('init() loads the current state via network.getState()', async () => {
  const { deps } = createFakeDeps({ network: { getState: async () => ({ status: 'ready' }) } })
  const store = createNetworkStore(deps)

  const dispose = store.init()
  await flush()

  assert.equal(store.getSnapshot().status, 'ready')
  dispose()
})

test('init() falls back to "unknown" (never "online"/"ready") if getState() rejects', async () => {
  const { deps } = createFakeDeps({
    network: {
      getState: async () => {
        throw new Error('boom')
      },
    },
  })
  const store = createNetworkStore(deps)

  const dispose = store.init()
  await flush()

  assert.equal(store.getSnapshot().status, 'unknown')
  dispose()
})

test('subscribing to onNetworkStateChanged updates the snapshot and notifies listeners', async () => {
  const { deps, emit } = createFakeDeps()
  const store = createNetworkStore(deps)
  const dispose = store.init()
  await flush()

  let notifications = 0
  store.subscribe(() => notifications++)

  emit('waitingForNetwork')

  assert.equal(store.getSnapshot().status, 'waitingForNetwork')
  assert.equal(notifications, 1)
  dispose()
})

test('a full offline -> connecting -> online transition is reflected in the snapshot in order', async () => {
  const { deps, emit } = createFakeDeps()
  const store = createNetworkStore(deps)
  const dispose = store.init()
  await flush()

  const seen = []
  store.subscribe(() => seen.push(store.getSnapshot().status))

  emit('waitingForNetwork')
  emit('connecting')
  emit('ready')

  assert.deepEqual(seen, ['waitingForNetwork', 'connecting', 'ready'])
  dispose()
})

test("init()'s returned dispose function unsubscribes from onNetworkStateChanged exactly once", () => {
  const { deps, getUnsubscribeCalls, getListenerCount } = createFakeDeps()
  const store = createNetworkStore(deps)

  const dispose = store.init()
  assert.equal(getListenerCount(), 1)

  dispose()
  assert.equal(getUnsubscribeCalls(), 1)
  assert.equal(getListenerCount(), 0)
})

test('a late event after dispose() is not observed (no listener leak)', async () => {
  const { deps, emit } = createFakeDeps()
  const store = createNetworkStore(deps)
  const dispose = store.init()
  await flush()
  dispose()

  emit('ready') // no listener left to receive this

  assert.equal(store.getSnapshot().status, 'unknown')
})
