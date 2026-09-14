'use strict'

// Unit tests for Task 17's network-state tracking in TdlibLifecycleService: a
// fake `tdl` Client (same injection pattern as lifecycle.chats.test.js/
// lifecycle.retry.test.js) drives `updateConnectionState` updates directly
// and verifies getNetworkState()/onUpdate() react correctly, without a real
// TDLib client.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { TdlibLifecycleService } = require(
  path.join(__dirname, '..', '..', 'out', 'main', 'tdlib', 'lifecycle.js'),
)

const FAKE_CONFIG = {
  apiId: 1,
  apiHash: 'test-placeholder-hash',
  databaseDirectory: '/tmp/unused-db',
  filesDirectory: '/tmp/unused-files',
  systemLanguageCode: 'en',
  deviceModel: 'Desktop',
  systemVersion: 'test',
  applicationVersion: 'test',
}

function createFakeClient() {
  const listeners = {}
  return {
    on(event, listener) {
      listeners[event] = listener
    },
    login() {
      return new Promise(() => {}) // never resolves - not exercised in this suite
    },
    async close() {},
    emit(update) {
      listeners.update(update)
    },
  }
}

function connectionState(kind) {
  return { _: 'updateConnectionState', state: { _: kind } }
}

test('getNetworkState() is "unknown" before start() and before any updateConnectionState is observed', () => {
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => createFakeClient())
  assert.equal(service.getNetworkState(), 'unknown')
})

test('getNetworkState() is "unknown" right after start(), before the first updateConnectionState arrives', async () => {
  const client = createFakeClient()
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await service.start()
  assert.equal(service.getNetworkState(), 'unknown')
})

test('an updateConnectionState update updates getNetworkState() and emits a typed "networkState" event', async () => {
  const client = createFakeClient()
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)
  const events = []
  service.onUpdate((event) => events.push(event))

  await service.start()
  client.emit(connectionState('connectionStateWaitingForNetwork'))

  assert.equal(service.getNetworkState(), 'waitingForNetwork')
  assert.deepEqual(
    events.filter((e) => e.kind === 'networkState'),
    [{ kind: 'networkState', status: 'waitingForNetwork' }],
  )
})

test('a full offline -> connecting -> online transition is observed in order', async () => {
  const client = createFakeClient()
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)
  const statuses = []
  service.onUpdate((event) => {
    if (event.kind === 'networkState') statuses.push(event.status)
  })

  await service.start()
  client.emit(connectionState('connectionStateWaitingForNetwork'))
  client.emit(connectionState('connectionStateConnecting'))
  client.emit(connectionState('connectionStateUpdating'))
  client.emit(connectionState('connectionStateReady'))

  assert.deepEqual(statuses, ['waitingForNetwork', 'connecting', 'updating', 'ready'])
  assert.equal(service.getNetworkState(), 'ready')
})

test('an unrecognized connectionState variant maps to "unknown" instead of throwing', async () => {
  const client = createFakeClient()
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await service.start()
  assert.doesNotThrow(() => client.emit(connectionState('connectionStateSomeFutureVariant')))
  assert.equal(service.getNetworkState(), 'unknown')
})

test('updateConnectionState is never forwarded as a "raw" event (handled specially, like updateAuthorizationState)', async () => {
  const client = createFakeClient()
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)
  const rawEvents = []
  service.onUpdate((event) => {
    if (event.kind === 'raw') rawEvents.push(event)
  })

  await service.start()
  client.emit(connectionState('connectionStateReady'))

  assert.deepEqual(rawEvents, [])
})

test('network state and authorization state are tracked independently', async () => {
  const client = createFakeClient()
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await service.start()
  client.emit(connectionState('connectionStateReady'))
  client.emit({
    _: 'updateAuthorizationState',
    authorization_state: { _: 'authorizationStateWaitPhoneNumber' },
  })

  assert.equal(service.getNetworkState(), 'ready')
  assert.equal(service.getAuthorizationState(), 'waitPhoneNumber')
})
