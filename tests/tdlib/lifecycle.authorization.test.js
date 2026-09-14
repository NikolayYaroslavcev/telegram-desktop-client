'use strict'

// Unit tests for Task 07/19's full authorization state machine on
// TdlibLifecycleService: a fake `tdl` Client (same injection pattern as
// lifecycle.retry.test.js/lifecycle.network.test.js) drives real
// `updateAuthorizationState` updates *and* the getPhoneNumber/getAuthCode/
// getPassword login() callbacks together, so this verifies the sequence
// waitPhoneNumber -> waitCode -> waitPassword -> ready end to end - not just
// each transition in isolation - plus the "wrong step"/"nothing pending"
// rejection paths and an unrecognized future state, all without a real
// TDLib client or credentials.

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

function authorizationState(kind) {
  return { _: 'updateAuthorizationState', authorization_state: { _: kind } }
}

/** Fake `tdl` Client: captures login()'s callback bundle and lets a test push `updateAuthorizationState` updates directly, like the real client would alongside those callbacks. */
function createFakeClient() {
  const listeners = {}
  let loginArg = null
  return {
    on(event, listener) {
      listeners[event] = listener
    },
    login(arg) {
      loginArg = arg
      return new Promise(() => {}) // this suite never needs login() itself to settle
    },
    async close() {},
    emit(update) {
      listeners.update(update)
    },
    getLoginArg: () => loginArg,
  }
}

function startService() {
  const client = createFakeClient()
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)
  const events = []
  service.onUpdate((event) => events.push(event))
  return { client, service, events }
}

test('full happy path: waitPhoneNumber -> waitCode -> waitPassword -> ready, in order', async () => {
  const { client, service, events } = startService()
  await service.start()

  client.emit(authorizationState('authorizationStateWaitPhoneNumber'))
  assert.equal(service.getAuthorizationState(), 'waitPhoneNumber')
  const phonePrompt = client.getLoginArg().getPhoneNumber(false)
  await service.setPhoneNumber('+10000000000')
  await phonePrompt

  client.emit(authorizationState('authorizationStateWaitCode'))
  assert.equal(service.getAuthorizationState(), 'waitCode')
  const codePrompt = client.getLoginArg().getAuthCode(false)
  await service.checkCode('123456')
  await codePrompt

  client.emit(authorizationState('authorizationStateWaitPassword'))
  assert.equal(service.getAuthorizationState(), 'waitPassword')
  const passwordPrompt = client.getLoginArg().getPassword('hint', false)
  await service.checkPassword('correct horse battery staple')
  await passwordPrompt

  client.emit(authorizationState('authorizationStateReady'))
  assert.equal(service.getAuthorizationState(), 'ready')

  assert.deepEqual(
    events.filter((e) => e.kind === 'authorizationState').map((e) => e.status),
    ['waitPhoneNumber', 'waitCode', 'waitPassword', 'ready'],
  )
})

test('a 2FA-less account skips straight from waitCode to ready (no waitPassword step)', async () => {
  const { client, service, events } = startService()
  await service.start()

  client.emit(authorizationState('authorizationStateWaitPhoneNumber'))
  const phonePrompt = client.getLoginArg().getPhoneNumber(false)
  await service.setPhoneNumber('+10000000000')
  await phonePrompt

  client.emit(authorizationState('authorizationStateWaitCode'))
  const codePrompt = client.getLoginArg().getAuthCode(false)
  await service.checkCode('123456')
  await codePrompt

  client.emit(authorizationState('authorizationStateReady'))

  assert.equal(service.getAuthorizationState(), 'ready')
  assert.deepEqual(
    events.filter((e) => e.kind === 'authorizationState').map((e) => e.status),
    ['waitPhoneNumber', 'waitCode', 'ready'],
  )
})

test('checkPassword() while TDLib is waiting for code (wrong step) rejects and does not resolve the pending code prompt', async () => {
  const { client, service } = startService()
  await service.start()
  client.emit(authorizationState('authorizationStateWaitCode'))
  const codePrompt = client.getLoginArg().getAuthCode(false)

  await assert.rejects(
    () => service.checkPassword('whatever'),
    (err) =>
      err.kind === 'authorization' && /not currently waiting for password/i.test(err.message),
  )

  // The pending code prompt is still open - a correct checkCode() still resolves it.
  await service.checkCode('123456')
  await codePrompt
})

test('checkCode() with nothing pending (before any prompt was requested) rejects instead of hanging', async () => {
  const { service } = startService()
  await service.start()

  await assert.rejects(
    () => service.checkCode('123456'),
    (err) => err.kind === 'authorization' && /not currently waiting for code/i.test(err.message),
  )
})

test('setPhoneNumber() after authorizationStateReady (nothing pending anymore) rejects, not silently ignored', async () => {
  const { client, service } = startService()
  await service.start()
  client.emit(authorizationState('authorizationStateReady'))

  await assert.rejects(
    () => service.setPhoneNumber('+10000000000'),
    (err) => err.kind === 'authorization',
  )
})

test('a terminal authorizationStateClosed is reflected by getAuthorizationState()', async () => {
  const { client, service, events } = startService()
  await service.start()
  client.emit(authorizationState('authorizationStateReady'))

  client.emit(authorizationState('authorizationStateClosed'))

  assert.equal(service.getAuthorizationState(), 'closed')
  assert.deepEqual(
    events.filter((e) => e.kind === 'authorizationState').map((e) => e.status),
    ['ready', 'closed'],
  )
})

test('an unrecognized future authorizationState maps to "unknown" without throwing and is still observable', async () => {
  const { client, service, events } = startService()
  await service.start()

  assert.doesNotThrow(() =>
    client.emit(authorizationState('authorizationStateSomeFutureTdlibVersion')),
  )

  assert.equal(service.getAuthorizationState(), 'unknown')
  assert.deepEqual(
    events.filter((e) => e.kind === 'authorizationState').map((e) => e.status),
    ['unknown'],
  )
})
