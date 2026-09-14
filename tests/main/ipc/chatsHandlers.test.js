'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { createFakeIpcMain } = require('./fixtures/fakeIpcMain')
const { registerChatsHandlers } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'ipc', 'chatsHandlers.js'),
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
    getAuthorizationState() {
      return 'ready'
    },
    async setPhoneNumber() {},
    async checkCode() {},
    async checkPassword() {},
    async getPrivateChats() {
      return []
    },
    async getChat() {
      return null
    },
    async getChatHistory() {
      return []
    },
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

test('chats.list() delegates to TdlibService.getPrivateChats() and returns its result', async () => {
  const chats = [{ id: 1, peerUserId: 42, title: 'Ada Lovelace' }]
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async getPrivateChats() {
      return chats
    },
  })
  registerChatsHandlers(ipcMain, () => service)

  const result = await ipcMain.invoke(IPC_CHANNELS.chatsList)
  assert.deepEqual(result, chats)
})

test('chats.list() fails with NOT_AUTHORIZED (not a raw TdlibServiceError) when the backend is unavailable', async () => {
  const ipcMain = createFakeIpcMain()
  registerChatsHandlers(ipcMain, () => null)

  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.chatsList), 'NOT_AUTHORIZED')
})

test('chats.list() maps a TdlibServiceError thrown by the backend to a serialized IpcError, never leaking it raw', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async getPrivateChats() {
      throw new TdlibServiceError('client', 'Failed to fetch the chat list from TDLib')
    },
  })
  registerChatsHandlers(ipcMain, () => service)

  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.chatsList), 'TDLIB_ERROR')
})

test('repeated chats.list() calls each just delegate again - no local caching/dedup state', async () => {
  const ipcMain = createFakeIpcMain()
  let calls = 0
  const service = createFakeTdlibService({
    async getPrivateChats() {
      calls += 1
      return [{ id: calls, peerUserId: calls, title: `Chat ${calls}` }]
    },
  })
  registerChatsHandlers(ipcMain, () => service)

  const first = await ipcMain.invoke(IPC_CHANNELS.chatsList)
  const second = await ipcMain.invoke(IPC_CHANNELS.chatsList)

  assert.equal(calls, 2)
  assert.notDeepEqual(first, second)
})

test('chats.open() validates chatId before calling the backend', async () => {
  const ipcMain = createFakeIpcMain()
  registerChatsHandlers(ipcMain, () => createFakeTdlibService())

  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.chatsOpen, 'not-a-number'), 'INVALID_ARGUMENT')
  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.chatsOpen, NaN), 'INVALID_ARGUMENT')
})

test('chats.open() resolves with no value when the chat is an allowed private chat', async () => {
  const ipcMain = createFakeIpcMain()
  const chat = { id: 42, peerUserId: 7, title: 'Ada Lovelace' }
  const service = createFakeTdlibService({
    async getChat(chatId) {
      return chatId === 42 ? chat : null
    },
  })
  registerChatsHandlers(ipcMain, () => service)

  const result = await ipcMain.invoke(IPC_CHANNELS.chatsOpen, 42)
  assert.equal(result, undefined)
})

test('chats.open() fails with INVALID_ARGUMENT when the chat is not an allowed private chat', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async getChat() {
      return null
    },
  })
  registerChatsHandlers(ipcMain, () => service)

  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.chatsOpen, 999), 'INVALID_ARGUMENT')
})

test('chats.open() fails with NOT_AUTHORIZED (not a raw TdlibServiceError) when the backend is unavailable', async () => {
  const ipcMain = createFakeIpcMain()
  registerChatsHandlers(ipcMain, () => null)

  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.chatsOpen, 42), 'NOT_AUTHORIZED')
})

test('chats.open() maps a TdlibServiceError thrown by getChat to a serialized IpcError, never leaking it raw', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async getChat() {
      throw new TdlibServiceError('client', 'TDLib client is not running')
    },
  })
  registerChatsHandlers(ipcMain, () => service)

  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.chatsOpen, 42), 'TDLIB_ERROR')
})
