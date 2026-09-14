'use strict'

// Unit tests for the retry/rejection signal added on top of the login
// bridge: a fake `tdl` Client (injected via the lifecycle's client-factory
// constructor param) lets these drive `getPhoneNumber`/`getAuthCode`/
// `getPassword(retry)` and `client.login()`'s own rejection directly,
// without a real TDLib native client or network/credentials - see
// tests/tdlib/lifecycle.integration.test.js for the real-client coverage.

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

function flush() {
  return Promise.resolve()
    .then(() => {})
    .then(() => {})
}

/** Minimal fake of tdl's `Client`: captures the login() details object and lets a test settle login()'s own promise directly. */
function createFakeClient() {
  let loginArg = null
  let settleLogin
  const loginPromise = new Promise((_resolve, reject) => {
    settleLogin = reject // this suite only ever needs to simulate login() rejecting
  })
  // Swallow the default unhandled-rejection warning until a test awaits it.
  loginPromise.catch(() => {})

  return {
    on() {},
    login(arg) {
      loginArg = arg
      return loginPromise
    },
    async close() {},
    getLoginArg: () => loginArg,
    rejectLogin: (err) => settleLogin(err),
  }
}

function startService() {
  const client = createFakeClient()
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)
  const events = []
  service.onUpdate((event) => events.push(event))
  return { client, service, events }
}

test('retry === true for phone emits authInputRejected(phone)', async () => {
  const { client, service, events } = startService()
  await service.start()

  const arg = client.getLoginArg()
  const pending = arg.getPhoneNumber(true)

  assert.deepEqual(
    events.filter((e) => e.kind === 'authInputRejected'),
    [{ kind: 'authInputRejected', step: 'phone' }],
  )

  await service.setPhoneNumber('+10000000000')
  await pending
})

test('retry === true for code emits authInputRejected(code)', async () => {
  const { client, service, events } = startService()
  await service.start()

  const arg = client.getLoginArg()
  const pending = arg.getAuthCode(true)

  assert.deepEqual(
    events.filter((e) => e.kind === 'authInputRejected'),
    [{ kind: 'authInputRejected', step: 'code' }],
  )

  await service.checkCode('000000')
  await pending
})

test('retry === true for password emits authInputRejected(password)', async () => {
  const { client, service, events } = startService()
  await service.start()

  const arg = client.getLoginArg()
  const pending = arg.getPassword('hint', true)

  assert.deepEqual(
    events.filter((e) => e.kind === 'authInputRejected'),
    [{ kind: 'authInputRejected', step: 'password' }],
  )

  await service.checkPassword('correct horse battery staple')
  await pending
})

test('retry === false does not emit authInputRejected', async () => {
  const { client, service, events } = startService()
  await service.start()

  const arg = client.getLoginArg()
  const pending = arg.getAuthCode(false)

  assert.deepEqual(
    events.filter((e) => e.kind === 'authInputRejected'),
    [],
  )

  await service.checkCode('123456')
  await pending
})

test('a non-retryable login() rejection emits authFlowTerminated and permanently kills further submits', async () => {
  const { client, service, events } = startService()
  await service.start()

  const arg = client.getLoginArg()
  const pending = arg.getAuthCode(false)
  await service.checkCode('123456')
  await pending

  client.rejectLogin(new Error('FLOOD_WAIT_60'))
  await flush()

  assert.ok(events.some((e) => e.kind === 'authFlowTerminated'))

  await assert.rejects(
    () => service.checkCode('000000'),
    (err) => err.kind === 'authorization' && /terminated/i.test(err.message),
  )
})
