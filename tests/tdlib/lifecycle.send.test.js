'use strict'

// Unit tests for `TdlibLifecycleService.sendText()` (Task 12): a fake `tdl`
// Client (same injection pattern as lifecycle.history.test.js) verifies it
// delegates to the running client, and fails loudly (not silently) when it
// doesn't exist yet.

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

test('sendText() rejects when the TDLib client has not started yet', async () => {
  const client = createFakeClient(async () => {
    throw new Error('should not be called before start()')
  })
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await assert.rejects(
    () => service.sendText(1, 'hi'),
    (err) => err.kind === 'client',
  )
})

test('sendText() delegates to the running client once start() has created it', async () => {
  const calls = []
  const client = createFakeClient(async (request) => {
    if (request._ === 'sendMessage') {
      calls.push(request)
      return { _: 'message', id: 1, chat_id: request.chat_id }
    }
    throw new Error(`unexpected invoke: ${request._}`)
  })
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await service.start()
  await service.sendText(10, 'hello')

  assert.equal(calls.length, 1)
  assert.equal(calls[0].chat_id, 10)
  assert.equal(calls[0].input_message_content._, 'inputMessageText')
  assert.equal(calls[0].input_message_content.text.text, 'hello')
})

test('sendText() forwards replyToMessageId as inputMessageReplyToMessage', async () => {
  const calls = []
  const client = createFakeClient(async (request) => {
    if (request._ === 'sendMessage') {
      calls.push(request)
      return { _: 'message', id: 1, chat_id: request.chat_id }
    }
    throw new Error(`unexpected invoke: ${request._}`)
  })
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await service.start()
  await service.sendText(10, 'hello', 42)

  assert.deepEqual(calls[0].reply_to, { _: 'inputMessageReplyToMessage', message_id: 42 })
})

test('sendText() wraps a TDLib invoke failure as a TdlibServiceError', async () => {
  const client = createFakeClient(async (request) => {
    if (request._ === 'sendMessage') {
      throw new Error('flood wait')
    }
    throw new Error(`unexpected invoke: ${request._}`)
  })
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await service.start()
  await assert.rejects(
    () => service.sendText(10, 'hi'),
    (err) => err.kind === 'client',
  )
})
