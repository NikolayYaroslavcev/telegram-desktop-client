'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { createFakeIpcMain } = require('./fixtures/fakeIpcMain')
const { registerAuthHandlers } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'ipc', 'authHandlers.js'),
)
const { IPC_CHANNELS } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'shared', 'ipc', 'channels.js'),
)
const { deserializeIpcError } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'shared', 'ipc', 'errors.js'),
)
const { TdlibServiceError } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'tdlib', 'types.js'),
)

function createFakeTdlibService(overrides = {}) {
  return {
    status: 'waitPhoneNumber',
    getAuthorizationState() {
      return this.status
    },
    async setPhoneNumber() {},
    async checkCode() {},
    async checkPassword() {},
    ...overrides,
  }
}

async function expectIpcError(promise, code) {
  await assert.rejects(promise, (err) => {
    const ipcError = deserializeIpcError(err.message)
    assert.ok(ipcError, `expected a serialized IpcError, got: ${err.message}`)
    assert.equal(ipcError.code, code)
    return true
  })
}

test('auth.getState() delegates to the real TdlibService (Task 04 backend)', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({ status: 'ready' })
  registerAuthHandlers(ipcMain, () => service)

  const result = await ipcMain.invoke(IPC_CHANNELS.authGetState)
  assert.deepEqual(result, { status: 'ready' })
})

test('auth.getState() returns "unknown" when the TDLib backend never started', async () => {
  const ipcMain = createFakeIpcMain()
  registerAuthHandlers(ipcMain, () => null)

  const result = await ipcMain.invoke(IPC_CHANNELS.authGetState)
  assert.deepEqual(result, { status: 'unknown' })
})

test('auth.setPhoneNumber() validates its argument before calling the backend', async () => {
  const ipcMain = createFakeIpcMain()
  let called = false
  const service = createFakeTdlibService({
    async setPhoneNumber() {
      called = true
    },
  })
  registerAuthHandlers(ipcMain, () => service)

  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.authSetPhoneNumber, 12345), 'INVALID_ARGUMENT')
  assert.equal(called, false)

  await ipcMain.invoke(IPC_CHANNELS.authSetPhoneNumber, '+10000000000')
  assert.equal(called, true)
})

test('auth.checkCode()/checkPassword() validate their arguments', async () => {
  const ipcMain = createFakeIpcMain()
  registerAuthHandlers(ipcMain, () => createFakeTdlibService())

  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.authCheckCode, null), 'INVALID_ARGUMENT')
  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.authCheckPassword, {}), 'INVALID_ARGUMENT')
})

test('auth.* fails with NOT_AUTHORIZED (not a raw TdlibServiceError) when the backend is unavailable', async () => {
  const ipcMain = createFakeIpcMain()
  registerAuthHandlers(ipcMain, () => null)

  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.authSetPhoneNumber, '+10000000000'),
    'NOT_AUTHORIZED',
  )
})

test('auth.* maps a TdlibServiceError thrown by the backend to a serialized IpcError, never leaking it raw', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async checkCode() {
      throw new TdlibServiceError('authorization', 'TDLib is not currently waiting for code')
    },
  })
  registerAuthHandlers(ipcMain, () => service)

  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.authCheckCode, '123456'), 'NOT_ALLOWED')
})
