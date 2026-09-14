'use strict'

// Unit tests for `TdlibLifecycleService.getPrivateChats()`: a fake `tdl`
// Client (same injection pattern as lifecycle.retry.test.js) verifies the
// method delegates to `discoverPrivateChats` once the client exists, and
// fails loudly (not by returning an empty list) when it doesn't.

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

test('getPrivateChats() rejects when the TDLib client has not started yet', async () => {
  const client = createFakeClient(async () => {
    throw new Error('should not be called before start()')
  })
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await assert.rejects(
    () => service.getPrivateChats(),
    (err) => err.kind === 'client',
  )
})

test('getPrivateChats() delegates to the running client once start() has created it', async () => {
  const chat = { id: 1001, peerUserId: 42, title: 'Ada Lovelace', lastMessagePreview: undefined }
  const client = createFakeClient(async (request) => {
    if (request._ === 'getChats') return { _: 'chats', total_count: 1, chat_ids: [1001] }
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
  const result = await service.getPrivateChats()
  assert.deepEqual(result, [chat])
})
