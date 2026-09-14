'use strict'

// Unit tests for Task 10 history fetching: a fake TDLib client (only
// `invoke`, matching `MessageHistoryClient`) drives `fetchChatHistoryPage`
// directly - same pattern as tests/tdlib/chatDiscovery.test.js.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { fetchChatHistoryPage, fetchMessage } = require(
  path.join(__dirname, '..', '..', 'out', 'main', 'tdlib', 'messageHistory.js'),
)
const { TdlibServiceError } = require(
  path.join(__dirname, '..', '..', 'out', 'main', 'tdlib', 'types.js'),
)

function tdMessage(id) {
  return {
    _: 'message',
    id,
    chat_id: 10,
    sender_id: { _: 'messageSenderUser', user_id: 7 },
    is_outgoing: false,
    date: 1000 + id,
    content: { _: 'messageText', text: { _: 'formattedText', text: `text ${id}`, entities: [] } },
  }
}

test('the first page request uses fromMessageId 0, offset 0, and a positive limit', async () => {
  const calls = []
  const client = {
    async invoke(request) {
      calls.push(request)
      return { _: 'messages', total_count: 0, messages: [] }
    },
  }

  await fetchChatHistoryPage(client, 10, 0)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]._, 'getChatHistory')
  assert.equal(calls[0].chat_id, 10)
  assert.equal(calls[0].from_message_id, 0)
  assert.equal(calls[0].offset, 0)
  assert.ok(Number.isInteger(calls[0].limit) && calls[0].limit > 0 && calls[0].limit <= 100)
  assert.equal(calls[0].only_local, false)
})

test('a later page passes the given fromMessageId through unchanged, still with offset 0', async () => {
  const calls = []
  const client = {
    async invoke(request) {
      calls.push(request)
      return { _: 'messages', total_count: 0, messages: [] }
    },
  }

  await fetchChatHistoryPage(client, 10, 555)
  assert.equal(calls[0].from_message_id, 555)
  assert.equal(calls[0].offset, 0)
})

test('returns raw messages in the order TDLib returned them - no re-sorting', async () => {
  const client = {
    async invoke() {
      return {
        _: 'messages',
        total_count: 3,
        messages: [tdMessage(30), tdMessage(20), tdMessage(10)],
      }
    },
  }

  const result = await fetchChatHistoryPage(client, 10, 0)
  assert.deepEqual(
    result.map((m) => m.id),
    [30, 20, 10],
  )
})

test('an empty page (no more history) is returned as an empty array, not an error', async () => {
  const client = {
    async invoke() {
      return { _: 'messages', total_count: 0, messages: [] }
    },
  }

  assert.deepEqual(await fetchChatHistoryPage(client, 10, 1), [])
})

test('null entries in the TDLib response are dropped', async () => {
  const client = {
    async invoke() {
      return { _: 'messages', total_count: 3, messages: [tdMessage(3), null, tdMessage(1)] }
    },
  }

  const result = await fetchChatHistoryPage(client, 10, 0)
  assert.deepEqual(
    result.map((m) => m.id),
    [3, 1],
  )
})

test('a TDLib invoke failure is wrapped as a TdlibServiceError, never thrown raw', async () => {
  const client = {
    async invoke() {
      throw new Error('network down')
    },
  }

  await assert.rejects(
    () => fetchChatHistoryPage(client, 10, 0),
    (err) => err instanceof TdlibServiceError && err.kind === 'client',
  )
})

test('repeated calls with the same fromMessageId (re-requesting the same page) are independent and consistent', async () => {
  const client = {
    async invoke() {
      return { _: 'messages', total_count: 1, messages: [tdMessage(5)] }
    },
  }

  const first = await fetchChatHistoryPage(client, 10, 6)
  const second = await fetchChatHistoryPage(client, 10, 6)
  assert.deepEqual(first, second)
})

// --- fetchMessage (Task 20 fix: re-resolving a stale attachment fileId) ---

test('fetchMessage sends a getMessage request for the given chat/message id', async () => {
  const calls = []
  const client = {
    async invoke(request) {
      calls.push(request)
      return tdMessage(5)
    },
  }

  await fetchMessage(client, 10, 5)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]._, 'getMessage')
  assert.equal(calls[0].chat_id, 10)
  assert.equal(calls[0].message_id, 5)
})

test('fetchMessage returns the message TDLib resolves', async () => {
  const client = {
    async invoke() {
      return tdMessage(5)
    },
  }

  const result = await fetchMessage(client, 10, 5)
  assert.equal(result.id, 5)
})

test('fetchMessage returns null (not a throw) when TDLib rejects the request - an expected "no longer resolvable" outcome', async () => {
  const client = {
    async invoke() {
      throw new Error('MESSAGE_NOT_FOUND')
    },
  }

  assert.equal(await fetchMessage(client, 10, 5), null)
})
