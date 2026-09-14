'use strict'

// Unit tests for Task 17's network.getState() IPC handler - same shape as
// tests/main/ipc/authHandlers.test.js's auth.getState() coverage.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { createFakeIpcMain } = require('./fixtures/fakeIpcMain')
const { registerNetworkHandlers } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'ipc', 'networkHandlers.js'),
)
const { IPC_CHANNELS } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'shared', 'ipc', 'channels.js'),
)

function createFakeTdlibService(status) {
  return { getNetworkState: () => status }
}

test('network.getState() delegates to the real TdlibService', async () => {
  const ipcMain = createFakeIpcMain()
  registerNetworkHandlers(ipcMain, () => createFakeTdlibService('ready'))

  const result = await ipcMain.invoke(IPC_CHANNELS.networkGetState)
  assert.deepEqual(result, { status: 'ready' })
})

test('network.getState() returns "unknown" when the TDLib backend never started - never a guessed "ready"', async () => {
  const ipcMain = createFakeIpcMain()
  registerNetworkHandlers(ipcMain, () => null)

  const result = await ipcMain.invoke(IPC_CHANNELS.networkGetState)
  assert.deepEqual(result, { status: 'unknown' })
})

test('network.getState() reflects whatever the backend currently reports, including "unknown" before the first update', async () => {
  const ipcMain = createFakeIpcMain()
  registerNetworkHandlers(ipcMain, () => createFakeTdlibService('unknown'))

  const result = await ipcMain.invoke(IPC_CHANNELS.networkGetState)
  assert.deepEqual(result, { status: 'unknown' })
})
