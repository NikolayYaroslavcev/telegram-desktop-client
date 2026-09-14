'use strict'

// Unit tests for `TdlibLifecycleService.getChat()`/`getChatHistory()` (Task
// 10): a fake `tdl` Client (same injection pattern as lifecycle.chats.test.js)
// verifies both delegate to the running client, and fail loudly (not with an
// empty/null result) when it doesn't exist yet.

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

function createFakeClient(invoke) {
  return {
    on() {},
    login() {
      return new Promise(() => {}) // never resolves - not exercised in this suite
    },
    async close() {},
    invoke,
  }
}

test('getChat() rejects when the TDLib client has not started yet', async () => {
  const client = createFakeClient(async () => {
    throw new Error('should not be called before start()')
  })
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await assert.rejects(
    () => service.getChat(1),
    (err) => err.kind === 'client',
  )
})

test('getChat() delegates to the running client and resolves the private chat', async () => {
  const client = createFakeClient(async (request) => {
    if (request._ === 'getChat') {
      return {
        _: 'chat',
        id: 1001,
        title: 'Ada Lovelace',
        type: { _: 'chatTypePrivate', user_id: 42 },
      }
    }
    if (request._ === 'getUser') {
      return {
        _: 'user',
        id: 42,
        first_name: 'Ada',
        last_name: 'Lovelace',
        type: { _: 'userTypeRegular' },
      }
    }
    throw new Error(`unexpected invoke: ${request._}`)
  })
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await service.start()
  const chat = await service.getChat(1001)
  assert.deepEqual(chat, {
    id: 1001,
    peerUserId: 42,
    title: 'Ada Lovelace',
    lastMessagePreview: undefined,
  })
})

test('getChat() resolves null for a chat that is not an allowed private chat', async () => {
  const client = createFakeClient(async (request) => {
    if (request._ === 'getChat') {
      return {
        _: 'chat',
        id: 2001,
        title: 'Group',
        type: { _: 'chatTypeBasicGroup', basic_group_id: 5 },
      }
    }
    throw new Error(`unexpected invoke: ${request._}`)
  })
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await service.start()
  assert.equal(await service.getChat(2001), null)
})

test('getChatHistory() rejects when the TDLib client has not started yet', async () => {
  const client = createFakeClient(async () => {
    throw new Error('should not be called before start()')
  })
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await assert.rejects(
    () => service.getChatHistory(1, 0),
    (err) => err.kind === 'client',
  )
})

test('getChatHistory() delegates to the running client once start() has created it', async () => {
  const rawMessage = {
    _: 'message',
    id: 5,
    chat_id: 10,
    sender_id: { _: 'messageSenderUser', user_id: 7 },
    is_outgoing: false,
    date: 1234,
    content: { _: 'messageText', text: { _: 'formattedText', text: 'hi', entities: [] } },
  }
  const client = createFakeClient(async (request) => {
    if (request._ === 'getChatHistory') {
      assert.equal(request.chat_id, 10)
      assert.equal(request.from_message_id, 0)
      return { _: 'messages', total_count: 1, messages: [rawMessage] }
    }
    throw new Error(`unexpected invoke: ${request._}`)
  })
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await service.start()
  const result = await service.getChatHistory(10, 0)
  assert.deepEqual(result, [rawMessage])
})
