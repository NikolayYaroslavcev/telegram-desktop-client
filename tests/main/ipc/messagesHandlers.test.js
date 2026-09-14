'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { createFakeIpcMain } = require('./fixtures/fakeIpcMain')
const { registerMessagesHandlers } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'ipc', 'messagesHandlers.js'),
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

async function expectIpcError(promise, code) {
  await assert.rejects(promise, (err) => {
    const ipcError = deserializeIpcError(err.message)
    assert.ok(ipcError, `expected a serialized IpcError, got: ${err.message}`)
    assert.equal(ipcError.code, code)
    return true
  })
}

function tdMessage(id, overrides = {}) {
  return {
    _: 'message',
    id,
    chat_id: 10,
    sender_id: { _: 'messageSenderUser', user_id: 7 },
    is_outgoing: false,
    date: 1000 + id,
    content: { _: 'messageText', text: { _: 'formattedText', text: `text ${id}`, entities: [] } },
    ...overrides,
  }
}

function privateChat(chatId, peerUserId = 7) {
  return { id: chatId, peerUserId, title: 'Chat' }
}

function createFakeTdlibService(overrides = {}) {
  return {
    async getChatHistory() {
      return []
    },
    async getChat() {
      return null
    },
    async sendText() {},
    async sendAttachment() {},
    async downloadFile() {
      return null
    },
    // Task 20 fix: default "can't refresh either" - most tests exercise a
    // downloadFile failure/`null` in isolation and don't care about the
    // fresh-id retry path, which has its own dedicated tests below.
    async refreshAttachmentFileId() {
      return null
    },
    ...overrides,
  }
}

function createFakeRepository(overrides = {}) {
  const upserted = []
  const markSyncedCalls = []
  return {
    upserted,
    markSyncedCalls,
    upsertMessage(message) {
      upserted.push(message)
    },
    findByIds() {
      return []
    },
    // Task 15 cache-first read path: defaults to "never synced, empty cache"
    // so every existing test (written before caching existed) keeps calling
    // through to TDLib exactly as before, unless a test overrides these.
    getHistory() {
      return []
    },
    isChatHistorySynced() {
      return false
    },
    markChatHistorySynced(chatId, syncedAt) {
      markSyncedCalls.push({ chatId, syncedAt })
    },
    ...overrides,
  }
}

/**
 * Fake `AttachmentIpcDeps` (see `messagesHandlers.ts`): a plain in-memory
 * registry (`allow`/`consume`, same shape as the real
 * `AttachmentSelectionRegistry`) plus stub Electron/Node primitives, so
 * these tests never touch a real dialog or filesystem.
 */
function createFakeAttachments(overrides = {}) {
  const selected = new Map()
  const registry = {
    allow(filePath, type) {
      selected.set(filePath, type)
    },
    consume(filePath) {
      const type = selected.get(filePath)
      if (type !== undefined) selected.delete(filePath)
      return type
    },
  }
  return {
    getWindow: () => null,
    async openDialog() {
      return { canceled: true, filePaths: [] }
    },
    async statFile() {
      return { size: 0 }
    },
    async readFile() {
      return Buffer.from('fake bytes')
    },
    async openPath() {
      return ''
    },
    registry,
    ...overrides,
  }
}

test('messages.getHistory() validates chatId/fromMessageId before calling the backend', async () => {
  const ipcMain = createFakeIpcMain()
  registerMessagesHandlers(
    ipcMain,
    () => createFakeTdlibService(),
    () => createFakeRepository(),
  )

  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 'x'), 'INVALID_ARGUMENT')
  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 1, 'x'), 'INVALID_ARGUMENT')
  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 1, -1), 'INVALID_ARGUMENT')
  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 1, 1.5), 'INVALID_ARGUMENT')
  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 1, NaN), 'INVALID_ARGUMENT')
})

test('messages.getHistory() defaults fromMessageId to 0 (first page) when omitted', async () => {
  const ipcMain = createFakeIpcMain()
  const calls = []
  const service = createFakeTdlibService({
    async getChatHistory(chatId, fromMessageId) {
      calls.push({ chatId, fromMessageId })
      return []
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => createFakeRepository(),
  )

  await ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10)
  assert.deepEqual(calls, [{ chatId: 10, fromMessageId: 0 }])
})

test('messages.getHistory() passes an explicit fromMessageId through to the backend', async () => {
  const ipcMain = createFakeIpcMain()
  const calls = []
  const service = createFakeTdlibService({
    async getChatHistory(chatId, fromMessageId) {
      calls.push({ chatId, fromMessageId })
      return []
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => createFakeRepository(),
  )

  await ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10, 555)
  assert.deepEqual(calls, [{ chatId: 10, fromMessageId: 555 }])
})

test('messages.getHistory() returns mapped domain messages only - no raw TDLib fields', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async getChatHistory() {
      return [tdMessage(2), tdMessage(1)]
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => createFakeRepository(),
  )

  const result = await ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10)
  assert.deepEqual(
    result.map((m) => m.id),
    [2, 1],
  )
  const KNOWN_DOMAIN_FIELDS = new Set([
    'id',
    'chatId',
    'senderId',
    'text',
    'createdAt',
    'replyToMessageId',
    'isOutgoing',
    'isDeleted',
    'deletedAt',
    'attachment',
  ])
  for (const message of result) {
    assert.equal('_' in message, false, 'must not leak the raw TDLib discriminant field')
    assert.equal('content' in message, false, 'must not leak the raw TDLib content field')
    for (const key of Object.keys(message)) {
      assert.ok(
        KNOWN_DOMAIN_FIELDS.has(key),
        `unexpected field "${key}" leaked into the domain Message`,
      )
    }
  }
})

test('messages.getHistory() persists every mapped message via MessageRepository.upsertMessage', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async getChatHistory() {
      return [tdMessage(3), tdMessage(2), tdMessage(1)]
    },
  })
  const repository = createFakeRepository()
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
  )

  await ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10)
  assert.deepEqual(
    repository.upserted.map((m) => m.id),
    [3, 2, 1],
  )
})

test('messages.getHistory() upserts each message immediately, before the next raw message is mapped', async () => {
  const ipcMain = createFakeIpcMain()
  const order = []
  const service = createFakeTdlibService({
    async getChatHistory() {
      return [tdMessage(3), tdMessage(2), tdMessage(1)]
    },
  })
  const repository = createFakeRepository({
    upsertMessage(message) {
      order.push(`upsert:${message.id}`)
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
  )

  await ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10)
  // Not "map everything, then write everything" - each write happens right
  // after its own message is mapped, interleaved rather than batched at the end.
  assert.deepEqual(order, ['upsert:3', 'upsert:2', 'upsert:1'])
})

test('messages.getHistory() skips unsupported content without failing the page or persisting it', async () => {
  const ipcMain = createFakeIpcMain()
  const unsupported = tdMessage(2, { content: { _: 'messageSticker' } })
  const service = createFakeTdlibService({
    async getChatHistory() {
      return [unsupported, tdMessage(1)]
    },
  })
  const repository = createFakeRepository()
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
  )

  const result = await ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10)
  assert.deepEqual(
    result.map((m) => m.id),
    [1],
  )
  assert.deepEqual(
    repository.upserted.map((m) => m.id),
    [1],
  )
})

test('messages.getHistory() handles an empty page (no more history) without error', async () => {
  const ipcMain = createFakeIpcMain()
  const repository = createFakeRepository()
  registerMessagesHandlers(
    ipcMain,
    () => createFakeTdlibService(),
    () => repository,
  )

  const result = await ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10, 1)
  assert.deepEqual(result, [])
  assert.deepEqual(repository.upserted, [])
})

test('messages.getHistory() fails with NOT_AUTHORIZED (not a raw TdlibServiceError) when the TDLib backend is unavailable', async () => {
  const ipcMain = createFakeIpcMain()
  registerMessagesHandlers(
    ipcMain,
    () => null,
    () => createFakeRepository(),
  )

  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10), 'NOT_AUTHORIZED')
})

test('messages.getHistory() fails with STORAGE_ERROR when message storage is unavailable', async () => {
  const ipcMain = createFakeIpcMain()
  registerMessagesHandlers(
    ipcMain,
    () => createFakeTdlibService(),
    () => null,
  )

  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10), 'STORAGE_ERROR')
})

test('messages.getHistory() maps a TdlibServiceError thrown by the backend to a serialized IpcError, never leaking it raw', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async getChatHistory() {
      throw new TdlibServiceError('client', 'Failed to fetch chat history from TDLib')
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => createFakeRepository(),
  )

  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10), 'TDLIB_ERROR')
})

// --- messages.getHistory cache-first read path (Task 15) ---

test('messages.getHistory() serves from cache and never calls the TDLib backend when the chat is synced', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async getChatHistory() {
      throw new Error('must not call TDLib on a cache hit')
    },
  })
  const repository = createFakeRepository({
    isChatHistorySynced: () => true,
    getHistory: () => [
      { id: 1, chatId: 10 },
      { id: 2, chatId: 10 },
    ],
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
  )

  const result = await ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10)
  assert.deepEqual(
    result.map((m) => m.id),
    [2, 1],
  ) // reversed to match TDLib's own newest-first order
})

test('messages.getHistory() serves from cache even when the TDLib backend is entirely unavailable (getTdlibService() -> null)', async () => {
  const ipcMain = createFakeIpcMain()
  const repository = createFakeRepository({
    isChatHistorySynced: () => true,
    getHistory: () => [{ id: 1, chatId: 10 }],
  })
  registerMessagesHandlers(
    ipcMain,
    () => null,
    () => repository,
  )

  const result = await ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10)
  assert.deepEqual(
    result.map((m) => m.id),
    [1],
  )
})

test('messages.getHistory() falls back to cached data when TDLib fails but the chat already has cached rows', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async getChatHistory() {
      throw new TdlibServiceError('client', 'Failed to fetch chat history from TDLib')
    },
  })
  const repository = createFakeRepository({
    isChatHistorySynced: () => false, // cache miss -> must attempt TDLib first
    getHistory: () => [{ id: 7, chatId: 10 }],
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
  )

  const result = await ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10)
  assert.deepEqual(
    result.map((m) => m.id),
    [7],
  )
})

test('messages.getHistory() on a cache miss fetches via TDLib and records the chat as synced', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async getChatHistory() {
      return [tdMessage(2), tdMessage(1)]
    },
  })
  const repository = createFakeRepository()
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
  )

  await ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10)
  assert.equal(repository.markSyncedCalls.length, 1)
  assert.equal(repository.markSyncedCalls[0].chatId, 10)
})

// --- messages.getHistory forceRefresh (Task 17 reconnect recovery) ---

test('messages.getHistory(chatId, 0, true) bypasses the cache-hit fast path and calls TDLib even though the chat is synced', async () => {
  const ipcMain = createFakeIpcMain()
  let tdlibCalls = 0
  const service = createFakeTdlibService({
    async getChatHistory() {
      tdlibCalls += 1
      return [tdMessage(2), tdMessage(1)]
    },
  })
  const repository = createFakeRepository({
    isChatHistorySynced: () => true,
    getHistory: () => [
      { id: 1, chatId: 10, isDeleted: false },
      { id: 2, chatId: 10, isDeleted: false },
    ],
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
  )

  const result = await ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10, 0, true)
  assert.equal(tdlibCalls, 1)
  assert.deepEqual(
    result.map((m) => m.id).sort((a, b) => a - b),
    [1, 2],
  )
})

test('messages.getHistory(chatId, 0, true) fails with NOT_AUTHORIZED (not a raw TdlibServiceError) when the TDLib backend is unavailable', async () => {
  const ipcMain = createFakeIpcMain()
  registerMessagesHandlers(
    ipcMain,
    () => null,
    () => createFakeRepository(),
  )

  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10, 0, true),
    'NOT_AUTHORIZED',
  )
})

test('messages.getHistory() forceRefresh is ignored for an explicit pagination cursor - still a normal TDLib page fetch, not a recovery refresh', async () => {
  const ipcMain = createFakeIpcMain()
  const calls = []
  const service = createFakeTdlibService({
    async getChatHistory(chatId, fromMessageId) {
      calls.push({ chatId, fromMessageId })
      return []
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => createFakeRepository(),
  )

  await ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10, 555, true)
  assert.deepEqual(calls, [{ chatId: 10, fromMessageId: 555 }])
})

test('messages.getHistory() validates forceRefresh is a boolean when given', async () => {
  const ipcMain = createFakeIpcMain()
  registerMessagesHandlers(
    ipcMain,
    () => createFakeTdlibService(),
    () => createFakeRepository(),
  )

  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10, 0, 'yes'),
    'INVALID_ARGUMENT',
  )
  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10, 0, 1),
    'INVALID_ARGUMENT',
  )
})

test('messages.getHistory() without forceRefresh keeps serving from cache as before (Task 15 behavior unchanged)', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async getChatHistory() {
      throw new Error('must not call TDLib on a cache hit when forceRefresh is not set')
    },
  })
  const repository = createFakeRepository({
    isChatHistorySynced: () => true,
    getHistory: () => [{ id: 1, chatId: 10 }],
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
  )

  const result = await ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10, 0, false)
  assert.deepEqual(
    result.map((m) => m.id),
    [1],
  )
})

test('messages.getHistory() with an explicit fromMessageId ignores the synced cache and always calls TDLib', async () => {
  const ipcMain = createFakeIpcMain()
  const calls = []
  const service = createFakeTdlibService({
    async getChatHistory(chatId, fromMessageId) {
      calls.push({ chatId, fromMessageId })
      return []
    },
  })
  const repository = createFakeRepository({
    isChatHistorySynced: () => true,
    getHistory: () => [{ id: 999, chatId: 10 }],
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
  )

  await ipcMain.invoke(IPC_CHANNELS.messagesGetHistory, 10, 555)
  assert.deepEqual(calls, [{ chatId: 10, fromMessageId: 555 }])
})

test('messages.sendText() validates chatId/text/replyToMessageId before calling the backend', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async sendText() {
      throw new Error('must not be called for invalid input')
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => createFakeRepository(),
  )

  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesSendText, 'x', 'hi'), 'INVALID_ARGUMENT') // chatId not a number
  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesSendText, 1, 42), 'INVALID_ARGUMENT') // text not a string
  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesSendText, 1, null), 'INVALID_ARGUMENT')
  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSendText, 1, { text: 'hi' }),
    'INVALID_ARGUMENT',
  )
  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesSendText, 1, ['hi']), 'INVALID_ARGUMENT')
  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesSendText, 1, ''), 'INVALID_ARGUMENT') // empty text
  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesSendText, 1, '   '), 'INVALID_ARGUMENT') // whitespace-only text
  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSendText, 1, 'hi', 'x'),
    'INVALID_ARGUMENT',
  ) // replyToMessageId not a number
  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSendText, 1, 'hi', -1),
    'INVALID_ARGUMENT',
  ) // replyToMessageId negative
  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSendText, 1, 'hi', 1.5),
    'INVALID_ARGUMENT',
  ) // replyToMessageId not an integer
  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSendText, 1, 'hi', NaN),
    'INVALID_ARGUMENT',
  )
})

test('messages.sendText() rejects a chatId that does not resolve to an allowed private chat, without sending anything', async () => {
  const ipcMain = createFakeIpcMain()
  let sendCalled = false
  const service = createFakeTdlibService({
    async getChat() {
      return null // not private / group / channel / bot / unknown
    },
    async sendText() {
      sendCalled = true
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => createFakeRepository(),
  )

  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesSendText, 1, 'hi'), 'INVALID_ARGUMENT')
  assert.equal(sendCalled, false)
})

test('messages.sendText() sends plain text, unmodified, to a valid private chat', async () => {
  const ipcMain = createFakeIpcMain()
  const calls = []
  const service = createFakeTdlibService({
    async getChat(chatId) {
      return privateChat(chatId)
    },
    async sendText(chatId, text) {
      calls.push({ chatId, text })
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => createFakeRepository(),
  )

  const result = await ipcMain.invoke(IPC_CHANNELS.messagesSendText, 10, '  hello there  ')
  assert.equal(result, undefined) // contract is Promise<void> - no raw TDLib message returned
  assert.deepEqual(calls, [{ chatId: 10, text: '  hello there  ' }]) // untouched - no hidden trim/mutation
})

test('messages.sendText() forwards a valid replyToMessageId to the backend once the target is confirmed local to the chat', async () => {
  const ipcMain = createFakeIpcMain()
  const calls = []
  const service = createFakeTdlibService({
    async getChat(chatId) {
      return privateChat(chatId)
    },
    async sendText(chatId, text, replyToMessageId) {
      calls.push([chatId, text, replyToMessageId])
    },
  })
  const repository = createFakeRepository({
    findByIds(chatId, ids) {
      assert.deepEqual([chatId, ids], [10, [99]])
      return [{ id: 99, chatId: 10 }]
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
  )

  await ipcMain.invoke(IPC_CHANNELS.messagesSendText, 10, 'hi', 99)
  assert.deepEqual(calls, [[10, 'hi', 99]])
})

test('messages.sendText() omits replyToMessageId from the backend call when not given', async () => {
  const ipcMain = createFakeIpcMain()
  const calls = []
  const service = createFakeTdlibService({
    async getChat(chatId) {
      return privateChat(chatId)
    },
    async sendText(chatId, text, replyToMessageId) {
      calls.push([chatId, text, replyToMessageId])
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => createFakeRepository(),
  )

  await ipcMain.invoke(IPC_CHANNELS.messagesSendText, 10, 'hi')
  assert.deepEqual(calls, [[10, 'hi', undefined]])
})

test('messages.sendText() rejects a replyToMessageId with no local message in this chat, without sending anything', async () => {
  const ipcMain = createFakeIpcMain()
  let sendCalled = false
  const service = createFakeTdlibService({
    async getChat(chatId) {
      return privateChat(chatId)
    },
    async sendText() {
      sendCalled = true
    },
  })
  const repository = createFakeRepository({
    findByIds() {
      return [] // never seen locally
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
  )

  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSendText, 10, 'hi', 404),
    'INVALID_ARGUMENT',
  )
  assert.equal(sendCalled, false)
})

test('messages.sendText() rejects a replyToMessageId that belongs to a different chat, without sending anything', async () => {
  const ipcMain = createFakeIpcMain()
  let sendCalled = false
  const service = createFakeTdlibService({
    async getChat(chatId) {
      return privateChat(chatId)
    },
    async sendText() {
      sendCalled = true
    },
  })
  // Simulates real MessageRepository.findByIds semantics: scoped by
  // (chatId, messageId), so a message that exists only under a different
  // chat id is invisible to this lookup - same as "missing" from here.
  const repository = createFakeRepository({
    findByIds(chatId, ids) {
      const store = { 20: [{ id: 99, chatId: 20 }] }
      return (store[chatId] ?? []).filter((m) => ids.includes(m.id))
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
  )

  // replyToMessageId 99 exists, but only in chat 20 - this call targets chat 10.
  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSendText, 10, 'hi', 99),
    'INVALID_ARGUMENT',
  )
  assert.equal(sendCalled, false)
})

test('messages.sendText() fails with STORAGE_ERROR when a replyToMessageId is given but message storage is unavailable', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async getChat(chatId) {
      return privateChat(chatId)
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => null,
  )

  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesSendText, 10, 'hi', 99), 'STORAGE_ERROR')
})

test('messages.sendText() maps a TdlibServiceError from the backend to TDLIB_ERROR, never leaking it raw', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async getChat(chatId) {
      return privateChat(chatId)
    },
    async sendText() {
      throw new TdlibServiceError('client', 'Failed to send the message via TDLib')
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => createFakeRepository(),
  )

  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesSendText, 10, 'hi'), 'TDLIB_ERROR')
})

test('messages.sendText() fails with NOT_AUTHORIZED when the TDLib backend is unavailable', async () => {
  const ipcMain = createFakeIpcMain()
  registerMessagesHandlers(
    ipcMain,
    () => null,
    () => createFakeRepository(),
  )

  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesSendText, 10, 'hi'), 'NOT_AUTHORIZED')
})

// --- messages.sendAttachment (Task 14) ---

test('messages.sendAttachment() validates chatId/filePath/replyToMessageId before checking anything else', async () => {
  const ipcMain = createFakeIpcMain()
  registerMessagesHandlers(
    ipcMain,
    () => createFakeTdlibService(),
    () => createFakeRepository(),
    createFakeAttachments(),
  )

  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSendAttachment, 'x', '/tmp/a.png'),
    'INVALID_ARGUMENT',
  )
  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSendAttachment, 1, 42),
    'INVALID_ARGUMENT',
  ) // filePath not a string
  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSendAttachment, 1, ''),
    'INVALID_ARGUMENT',
  ) // empty filePath
  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSendAttachment, 1, '/tmp/a.png', 'x'),
    'INVALID_ARGUMENT',
  )
  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSendAttachment, 1, '/tmp/a.png', -1),
    'INVALID_ARGUMENT',
  )
})

test('messages.sendAttachment() rejects a filePath that was never returned by selectAttachmentFile, without sending anything', async () => {
  const ipcMain = createFakeIpcMain()
  let sendCalled = false
  const service = createFakeTdlibService({
    async getChat(chatId) {
      return privateChat(chatId)
    },
    async sendAttachment() {
      sendCalled = true
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => createFakeRepository(),
    createFakeAttachments(),
  )

  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSendAttachment, 10, '/etc/passwd'),
    'INVALID_ARGUMENT',
  )
  assert.equal(sendCalled, false)
})

test('messages.sendAttachment() rejects a chatId that does not resolve to an allowed private chat, without sending anything, and does not consume the registered path', async () => {
  const ipcMain = createFakeIpcMain()
  let sendCalled = false
  const attachments = createFakeAttachments()
  attachments.registry.allow('/tmp/a.png', 'photo')
  const service = createFakeTdlibService({
    async getChat() {
      return null
    },
    async sendAttachment() {
      sendCalled = true
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => createFakeRepository(),
    attachments,
  )

  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSendAttachment, 1, '/tmp/a.png'),
    'INVALID_ARGUMENT',
  )
  assert.equal(sendCalled, false)
})

test('messages.sendAttachment() sends the registered type ("photo") to a valid private chat', async () => {
  const ipcMain = createFakeIpcMain()
  const attachments = createFakeAttachments()
  attachments.registry.allow('C:\\pictures\\cat.jpg', 'photo')
  const calls = []
  const service = createFakeTdlibService({
    async getChat(chatId) {
      return privateChat(chatId)
    },
    async sendAttachment(chatId, type, filePath, replyToMessageId) {
      calls.push({ chatId, type, filePath, replyToMessageId })
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => createFakeRepository(),
    attachments,
  )

  const result = await ipcMain.invoke(
    IPC_CHANNELS.messagesSendAttachment,
    10,
    'C:\\pictures\\cat.jpg',
  )
  assert.equal(result, undefined)
  assert.deepEqual(calls, [
    { chatId: 10, type: 'photo', filePath: 'C:\\pictures\\cat.jpg', replyToMessageId: undefined },
  ])
})

test('messages.sendAttachment() sends the registered type ("document") and forwards a valid replyToMessageId', async () => {
  const ipcMain = createFakeIpcMain()
  const attachments = createFakeAttachments()
  attachments.registry.allow('/tmp/report.pdf', 'document')
  const calls = []
  const service = createFakeTdlibService({
    async getChat(chatId) {
      return privateChat(chatId)
    },
    async sendAttachment(chatId, type, filePath, replyToMessageId) {
      calls.push({ chatId, type, filePath, replyToMessageId })
    },
  })
  const repository = createFakeRepository({
    findByIds(chatId, ids) {
      assert.deepEqual([chatId, ids], [10, [99]])
      return [{ id: 99, chatId: 10 }]
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
    attachments,
  )

  await ipcMain.invoke(IPC_CHANNELS.messagesSendAttachment, 10, '/tmp/report.pdf', 99)
  assert.deepEqual(calls, [
    { chatId: 10, type: 'document', filePath: '/tmp/report.pdf', replyToMessageId: 99 },
  ])
})

test('messages.sendAttachment() rejects a replyToMessageId with no local message in this chat, without sending anything', async () => {
  const ipcMain = createFakeIpcMain()
  const attachments = createFakeAttachments()
  attachments.registry.allow('/tmp/a.png', 'photo')
  let sendCalled = false
  const service = createFakeTdlibService({
    async getChat(chatId) {
      return privateChat(chatId)
    },
    async sendAttachment() {
      sendCalled = true
    },
  })
  const repository = createFakeRepository({ findByIds: () => [] })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
    attachments,
  )

  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSendAttachment, 10, '/tmp/a.png', 404),
    'INVALID_ARGUMENT',
  )
  assert.equal(sendCalled, false)
})

test('messages.sendAttachment() a filePath can only be used once - a second send with the same path is rejected', async () => {
  const ipcMain = createFakeIpcMain()
  const attachments = createFakeAttachments()
  attachments.registry.allow('/tmp/a.png', 'photo')
  const service = createFakeTdlibService({
    async getChat(chatId) {
      return privateChat(chatId)
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => createFakeRepository(),
    attachments,
  )

  await ipcMain.invoke(IPC_CHANNELS.messagesSendAttachment, 10, '/tmp/a.png')
  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSendAttachment, 10, '/tmp/a.png'),
    'INVALID_ARGUMENT',
  )
})

test('messages.sendAttachment() maps a TdlibServiceError from the backend to TDLIB_ERROR, never leaking it raw', async () => {
  const ipcMain = createFakeIpcMain()
  const attachments = createFakeAttachments()
  attachments.registry.allow('/tmp/a.png', 'photo')
  const service = createFakeTdlibService({
    async getChat(chatId) {
      return privateChat(chatId)
    },
    async sendAttachment() {
      throw new TdlibServiceError('client', 'Failed to send the attachment via TDLib')
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => createFakeRepository(),
    attachments,
  )

  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSendAttachment, 10, '/tmp/a.png'),
    'TDLIB_ERROR',
  )
})

// --- messages.selectAttachmentFile (Task 14) ---

test('messages.selectAttachmentFile() rejects an unsupported attachment type', async () => {
  const ipcMain = createFakeIpcMain()
  registerMessagesHandlers(
    ipcMain,
    () => createFakeTdlibService(),
    () => createFakeRepository(),
    createFakeAttachments(),
  )

  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSelectAttachmentFile, 'video'),
    'INVALID_ARGUMENT',
  )
  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSelectAttachmentFile, 42),
    'INVALID_ARGUMENT',
  )
  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesSelectAttachmentFile),
    'INVALID_ARGUMENT',
  )
})

test('messages.selectAttachmentFile() returns null when the dialog is cancelled', async () => {
  const ipcMain = createFakeIpcMain()
  const attachments = createFakeAttachments({
    openDialog: async () => ({ canceled: true, filePaths: [] }),
  })
  registerMessagesHandlers(
    ipcMain,
    () => createFakeTdlibService(),
    () => createFakeRepository(),
    attachments,
  )

  const result = await ipcMain.invoke(IPC_CHANNELS.messagesSelectAttachmentFile, 'photo')
  assert.equal(result, null)
})

test('messages.selectAttachmentFile() returns the picked file and registers it for a subsequent sendAttachment', async () => {
  const ipcMain = createFakeIpcMain()
  const attachments = createFakeAttachments({
    openDialog: async () => ({ canceled: false, filePaths: ['/tmp/cat.jpg'] }),
    statFile: async () => ({ size: 999 }),
  })
  const service = createFakeTdlibService({
    async getChat(chatId) {
      return privateChat(chatId)
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => createFakeRepository(),
    attachments,
  )

  const result = await ipcMain.invoke(IPC_CHANNELS.messagesSelectAttachmentFile, 'photo')
  assert.deepEqual(result, { filePath: '/tmp/cat.jpg', fileName: 'cat.jpg', size: 999 })

  // No INVALID_ARGUMENT ("never selected") - proves the registry was actually populated.
  await ipcMain.invoke(IPC_CHANNELS.messagesSendAttachment, 10, '/tmp/cat.jpg')
})

// --- messages.downloadAttachment (Task 14) ---

function messageWithPhotoAttachment(overrides = {}) {
  return {
    id: 5,
    chatId: 10,
    attachment: {
      type: 'photo',
      fileId: 55,
      size: 2048,
      fileName: undefined,
      localPath: undefined,
    },
    ...overrides,
  }
}

test('messages.downloadAttachment() validates chatId/messageId', async () => {
  const ipcMain = createFakeIpcMain()
  registerMessagesHandlers(
    ipcMain,
    () => createFakeTdlibService(),
    () => createFakeRepository(),
    createFakeAttachments(),
  )

  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesDownloadAttachment, 'x', 5),
    'INVALID_ARGUMENT',
  )
  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesDownloadAttachment, 10, -1),
    'INVALID_ARGUMENT',
  )
  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesDownloadAttachment, 10, 1.5),
    'INVALID_ARGUMENT',
  )
})

test('messages.downloadAttachment() rejects a messageId with no local message, or no attachment - renderer cannot name an arbitrary file/fileId this way', async () => {
  const ipcMain = createFakeIpcMain()
  const repository = createFakeRepository({
    findByIds(chatId, ids) {
      if (ids[0] === 5) return [{ id: 5, chatId: 10, attachment: undefined }] // exists, but a text message
      return [] // never seen
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => createFakeTdlibService(),
    () => repository,
    createFakeAttachments(),
  )

  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesDownloadAttachment, 10, 5),
    'INVALID_ARGUMENT',
  )
  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesDownloadAttachment, 10, 404),
    'INVALID_ARGUMENT',
  )
})

test("messages.downloadAttachment() downloads by the attachment's fileId via TDLib", async () => {
  const ipcMain = createFakeIpcMain()
  const calls = []
  const service = createFakeTdlibService({
    async downloadFile(fileId) {
      calls.push(fileId)
      return { localPath: '/cache/photo.jpg', size: 2048 }
    },
  })
  const repository = createFakeRepository({ findByIds: () => [messageWithPhotoAttachment()] })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
    createFakeAttachments(),
  )

  await ipcMain.invoke(IPC_CHANNELS.messagesDownloadAttachment, 10, 5)
  assert.deepEqual(calls, [55])
})

test('messages.downloadAttachment() returns a base64 previewDataUrl for a photo, read via the injected readFile - never a filesystem path', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async downloadFile() {
      return { localPath: '/cache/photo.jpg', size: 3 }
    },
  })
  const repository = createFakeRepository({ findByIds: () => [messageWithPhotoAttachment()] })
  const attachments = createFakeAttachments({ readFile: async () => Buffer.from([1, 2, 3]) })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
    attachments,
  )

  const result = await ipcMain.invoke(IPC_CHANNELS.messagesDownloadAttachment, 10, 5)
  assert.equal(
    result.previewDataUrl,
    `data:image/jpeg;base64,${Buffer.from([1, 2, 3]).toString('base64')}`,
  )
  assert.equal('localPath' in result, false) // never a raw filesystem path
})

test('messages.downloadAttachment() returns no previewDataUrl for a document (no preview)', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async downloadFile() {
      return { localPath: '/cache/report.pdf', size: 10 }
    },
  })
  const repository = createFakeRepository({
    findByIds: () => [
      {
        id: 5,
        chatId: 10,
        attachment: { type: 'document', fileId: 77, size: 10, fileName: 'report.pdf' },
      },
    ],
  })
  const attachments = createFakeAttachments({
    readFile: async () => {
      throw new Error('must not read bytes for a document')
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
    attachments,
  )

  const result = await ipcMain.invoke(IPC_CHANNELS.messagesDownloadAttachment, 10, 5)
  assert.deepEqual(result, {})
})

test('messages.downloadAttachment() fails safely with NOT_FOUND when TDLib reports the download did not complete', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async downloadFile() {
      return null
    },
  })
  const repository = createFakeRepository({ findByIds: () => [messageWithPhotoAttachment()] })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
    createFakeAttachments(),
  )

  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesDownloadAttachment, 10, 5), 'NOT_FOUND')
})

test('messages.downloadAttachment() maps a readFile failure to FILESYSTEM_ERROR, never leaking the raw fs error or the local path', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async downloadFile() {
      return {
        localPath: 'C:\\Users\\alice\\AppData\\Roaming\\app\\tdlib\\files\\photo.jpg',
        size: 3,
      }
    },
  })
  const repository = createFakeRepository({ findByIds: () => [messageWithPhotoAttachment()] })
  const rawFsError = new Error(
    "ENOENT: no such file or directory, open 'C:\\Users\\alice\\AppData\\...'",
  )
  rawFsError.code = 'ENOENT'
  const attachments = createFakeAttachments({
    readFile: async () => {
      throw rawFsError
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
    attachments,
  )

  await assert.rejects(ipcMain.invoke(IPC_CHANNELS.messagesDownloadAttachment, 10, 5), (err) => {
    const ipcError = deserializeIpcError(err.message)
    assert.equal(ipcError.code, 'FILESYSTEM_ERROR')
    assert.ok(!ipcError.message.includes('alice'))
    assert.ok(!ipcError.message.includes('AppData'))
    return true
  })
})

test('messages.downloadAttachment() maps a TdlibServiceError from the backend to TDLIB_ERROR, never leaking it raw', async () => {
  const ipcMain = createFakeIpcMain()
  const service = createFakeTdlibService({
    async downloadFile() {
      throw new TdlibServiceError('client', 'Failed to download the file via TDLib')
    },
  })
  const repository = createFakeRepository({ findByIds: () => [messageWithPhotoAttachment()] })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
    createFakeAttachments(),
  )

  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesDownloadAttachment, 10, 5),
    'TDLIB_ERROR',
  )
})

test('messages.downloadAttachment() retries with a freshly re-resolved fileId when the cached one is stale, and succeeds (Task 20)', async () => {
  const ipcMain = createFakeIpcMain()
  const downloadCalls = []
  const service = createFakeTdlibService({
    async downloadFile(fileId) {
      downloadCalls.push(fileId)
      if (fileId === 55) throw new TdlibServiceError('client', 'File not found')
      return { localPath: '/cache/photo.jpg', size: 2048 }
    },
    async refreshAttachmentFileId() {
      return 99
    },
  })
  const repository = createFakeRepository({ findByIds: () => [messageWithPhotoAttachment()] })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
    createFakeAttachments(),
  )

  await ipcMain.invoke(IPC_CHANNELS.messagesDownloadAttachment, 10, 5)

  assert.deepEqual(downloadCalls, [55, 99])
})

test('messages.downloadAttachment() gives up (does not loop) when the refreshed fileId is the same stale one', async () => {
  const ipcMain = createFakeIpcMain()
  const downloadCalls = []
  const service = createFakeTdlibService({
    async downloadFile(fileId) {
      downloadCalls.push(fileId)
      throw new TdlibServiceError('client', 'File not found')
    },
    async refreshAttachmentFileId() {
      return 55 // same id the cache already had - refreshing didn't help
    },
  })
  const repository = createFakeRepository({ findByIds: () => [messageWithPhotoAttachment()] })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
    createFakeAttachments(),
  )

  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesDownloadAttachment, 10, 5),
    'TDLIB_ERROR',
  )
  assert.deepEqual(downloadCalls, [55])
})

// --- messages.openAttachment (Task 14) ---

test('messages.openAttachment() rejects a messageId with no local message or no attachment', async () => {
  const ipcMain = createFakeIpcMain()
  const repository = createFakeRepository({ findByIds: () => [] })
  registerMessagesHandlers(
    ipcMain,
    () => createFakeTdlibService(),
    () => repository,
    createFakeAttachments(),
  )

  await expectIpcError(
    ipcMain.invoke(IPC_CHANNELS.messagesOpenAttachment, 10, 404),
    'INVALID_ARGUMENT',
  )
})

test('messages.openAttachment() downloads (or reuses) the file, then opens the resolved path via the injected openPath - never a renderer-supplied path', async () => {
  const ipcMain = createFakeIpcMain()
  const openPathCalls = []
  const service = createFakeTdlibService({
    async downloadFile() {
      return { localPath: '/cache/report.pdf', size: 10 }
    },
  })
  const repository = createFakeRepository({
    findByIds: () => [
      {
        id: 5,
        chatId: 10,
        attachment: { type: 'document', fileId: 77, size: 10, fileName: 'report.pdf' },
      },
    ],
  })
  const attachments = createFakeAttachments({
    async openPath(filePath) {
      openPathCalls.push(filePath)
      return ''
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
    attachments,
  )

  const result = await ipcMain.invoke(IPC_CHANNELS.messagesOpenAttachment, 10, 5)
  assert.equal(result, undefined)
  assert.deepEqual(openPathCalls, ['/cache/report.pdf'])
})

test('messages.openAttachment() also retries with a freshly re-resolved fileId when the cached one is stale (Task 20)', async () => {
  const ipcMain = createFakeIpcMain()
  const downloadCalls = []
  const service = createFakeTdlibService({
    async downloadFile(fileId) {
      downloadCalls.push(fileId)
      if (fileId === 77) throw new TdlibServiceError('client', 'File not found')
      return { localPath: '/cache/report.pdf', size: 10 }
    },
    async refreshAttachmentFileId() {
      return 88
    },
  })
  const repository = createFakeRepository({
    findByIds: () => [
      {
        id: 5,
        chatId: 10,
        attachment: { type: 'document', fileId: 77, size: 10, fileName: 'report.pdf' },
      },
    ],
  })
  const attachments = createFakeAttachments({ async openPath() { return '' } })
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
    attachments,
  )

  await ipcMain.invoke(IPC_CHANNELS.messagesOpenAttachment, 10, 5)

  assert.deepEqual(downloadCalls, [77, 88])
})

test('messages.openAttachment() fails with FILESYSTEM_ERROR when shell.openPath reports an error, and with NOT_FOUND when the download did not complete', async () => {
  const ipcMain = createFakeIpcMain()
  const repository = createFakeRepository({ findByIds: () => [messageWithPhotoAttachment()] })

  const failingOpen = createFakeAttachments({
    getWindow: () => null,
    async openPath() {
      return 'no application found to open this file'
    },
  })
  const serviceOk = createFakeTdlibService({
    async downloadFile() {
      return { localPath: '/cache/photo.jpg', size: 2 }
    },
  })
  const ipcMain2 = createFakeIpcMain()
  registerMessagesHandlers(
    ipcMain2,
    () => serviceOk,
    () => repository,
    failingOpen,
  )
  await expectIpcError(
    ipcMain2.invoke(IPC_CHANNELS.messagesOpenAttachment, 10, 5),
    'FILESYSTEM_ERROR',
  )

  const serviceNotDownloaded = createFakeTdlibService({
    async downloadFile() {
      return null
    },
  })
  registerMessagesHandlers(
    ipcMain,
    () => serviceNotDownloaded,
    () => repository,
    createFakeAttachments(),
  )
  await expectIpcError(ipcMain.invoke(IPC_CHANNELS.messagesOpenAttachment, 10, 5), 'NOT_FOUND')
})
