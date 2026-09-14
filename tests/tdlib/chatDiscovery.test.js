'use strict'

// Unit tests for Task 09 chat discovery: a fake TDLib client (only `invoke`,
// matching `ChatDiscoveryClient`) drives `discoverPrivateChats` directly,
// without a real/mocked TDLib native client - see
// tests/tdlib/lifecycle.integration.test.js for the real-client pattern this
// mirrors.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { discoverPrivateChats } = require(
  path.join(__dirname, '..', '..', 'out', 'main', 'tdlib', 'chatDiscovery.js'),
)
const { TdlibServiceError } = require(
  path.join(__dirname, '..', '..', 'out', 'main', 'tdlib', 'types.js'),
)

function tdUser(id, overrides = {}) {
  return {
    _: 'user',
    id,
    first_name: 'First',
    last_name: 'Last',
    type: { _: 'userTypeRegular' },
    ...overrides,
  }
}

function tdChat(id, overrides = {}) {
  return {
    _: 'chat',
    id,
    title: `Chat ${id}`,
    type: { _: 'chatTypePrivate', user_id: id },
    ...overrides,
  }
}

/**
 * `chats`: map of chat id -> td_api chat object (or `'error'` to simulate
 * getChat failing for that id). `users`: map of user id -> td_api user object
 * (or `'error'` to simulate getUser failing). `failGetChats`: simulate the
 * initial getChats call itself failing.
 */
function createFakeClient({ chatIds = [], chats = {}, users = {}, failGetChats = false } = {}) {
  return {
    async invoke(request) {
      if (request._ === 'getChats') {
        if (failGetChats) throw new Error('network down')
        return { _: 'chats', total_count: chatIds.length, chat_ids: chatIds }
      }
      if (request._ === 'getChat') {
        const chat = chats[request.chat_id]
        if (!chat || chat === 'error') throw new Error(`getChat(${request.chat_id}) failed`)
        return chat
      }
      if (request._ === 'getUser') {
        const user = users[request.user_id]
        if (!user || user === 'error') throw new Error(`getUser(${request.user_id}) failed`)
        return user
      }
      throw new Error(`unexpected invoke: ${request._}`)
    },
  }
}

test('a private user chat is included', async () => {
  const client = createFakeClient({
    chatIds: [1001],
    chats: {
      1001: tdChat(1001, { type: { _: 'chatTypePrivate', user_id: 42 }, title: 'Ada Lovelace' }),
    },
    users: { 42: tdUser(42) },
  })

  const result = await discoverPrivateChats(client)
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 1001)
})

test('a basic group chat is excluded', async () => {
  const client = createFakeClient({
    chatIds: [2001],
    chats: { 2001: tdChat(2001, { type: { _: 'chatTypeBasicGroup', basic_group_id: 5 } }) },
  })

  assert.deepEqual(await discoverPrivateChats(client), [])
})

test('a supergroup chat is excluded', async () => {
  const client = createFakeClient({
    chatIds: [3001],
    chats: {
      3001: tdChat(3001, {
        type: { _: 'chatTypeSupergroup', supergroup_id: 7, is_channel: false },
      }),
    },
  })

  assert.deepEqual(await discoverPrivateChats(client), [])
})

test('a channel chat is excluded', async () => {
  const client = createFakeClient({
    chatIds: [4001],
    chats: {
      4001: tdChat(4001, { type: { _: 'chatTypeSupergroup', supergroup_id: 8, is_channel: true } }),
    },
  })

  assert.deepEqual(await discoverPrivateChats(client), [])
})

test('a private chat whose peer is a bot is excluded', async () => {
  const client = createFakeClient({
    chatIds: [5001],
    chats: { 5001: tdChat(5001, { type: { _: 'chatTypePrivate', user_id: 99 } }) },
    users: { 99: tdUser(99, { type: { _: 'userTypeBot' } }) },
  })

  assert.deepEqual(await discoverPrivateChats(client), [])
})

test('a regular private chat maps correctly: peerUserId matches the user id, title is preserved', async () => {
  const client = createFakeClient({
    chatIds: [6001],
    chats: {
      6001: tdChat(6001, { type: { _: 'chatTypePrivate', user_id: 42 }, title: 'Ada Lovelace' }),
    },
    users: { 42: tdUser(42) },
  })

  const [chat] = await discoverPrivateChats(client)
  assert.equal(chat.id, 6001)
  assert.equal(chat.peerUserId, 42)
  assert.equal(chat.title, 'Ada Lovelace')
})

test('a mixed chat list returns only the valid private, non-bot chats', async () => {
  const client = createFakeClient({
    chatIds: [1, 2, 3, 4, 5],
    chats: {
      1: tdChat(1, { type: { _: 'chatTypePrivate', user_id: 101 }, title: 'Private OK' }),
      2: tdChat(2, { type: { _: 'chatTypeBasicGroup', basic_group_id: 1 } }),
      3: tdChat(3, { type: { _: 'chatTypeSupergroup', supergroup_id: 1, is_channel: true } }),
      4: tdChat(4, { type: { _: 'chatTypePrivate', user_id: 102 }, title: 'Bot chat' }),
      5: tdChat(5, { type: { _: 'chatTypePrivate', user_id: 103 }, title: 'Another OK' }),
    },
    users: {
      101: tdUser(101),
      102: tdUser(102, { type: { _: 'userTypeBot' } }),
      103: tdUser(103),
    },
  })

  const result = await discoverPrivateChats(client)
  assert.deepEqual(
    result.map((c) => c.id),
    [1, 5],
  )
})

test('raw TDLib objects never appear in the result - only the domain Chat shape', async () => {
  const client = createFakeClient({
    chatIds: [7001],
    chats: {
      7001: tdChat(7001, { type: { _: 'chatTypePrivate', user_id: 42 }, title: 'Ada Lovelace' }),
    },
    users: { 42: tdUser(42) },
  })

  const [chat] = await discoverPrivateChats(client)
  assert.deepEqual(
    Object.keys(chat).sort(),
    ['id', 'lastMessagePreview', 'peerUserId', 'title'].sort(),
  )
})

test('a failing initial getChats call is a hard error, surfaced as a TdlibServiceError', async () => {
  const client = createFakeClient({ failGetChats: true })

  await assert.rejects(
    () => discoverPrivateChats(client),
    (err) => err instanceof TdlibServiceError && err.kind === 'client',
  )
})

test('a chat that cannot be confirmed because getUser fails is excluded, not surfaced unconfirmed', async () => {
  const client = createFakeClient({
    chatIds: [8001],
    chats: { 8001: tdChat(8001, { type: { _: 'chatTypePrivate', user_id: 42 } }) },
    users: { 42: 'error' },
  })

  assert.deepEqual(await discoverPrivateChats(client), [])
})

test('a chat whose own getChat call fails is excluded rather than crashing the whole discovery', async () => {
  const client = createFakeClient({
    chatIds: [9001, 9002],
    chats: {
      9001: 'error',
      9002: tdChat(9002, { type: { _: 'chatTypePrivate', user_id: 55 }, title: 'Still OK' }),
    },
    users: { 55: tdUser(55) },
  })

  const result = await discoverPrivateChats(client)
  assert.deepEqual(
    result.map((c) => c.id),
    [9002],
  )
})

test("result order matches getChats' chat_ids order, regardless of per-chat resolution timing", async () => {
  const delays = { 1: 30, 2: 0, 3: 15 }
  const client = {
    async invoke(request) {
      if (request._ === 'getChats') {
        return { _: 'chats', total_count: 3, chat_ids: [1, 2, 3] }
      }
      if (request._ === 'getChat') {
        await new Promise((resolve) => setTimeout(resolve, delays[request.chat_id]))
        return tdChat(request.chat_id, {
          type: { _: 'chatTypePrivate', user_id: request.chat_id },
          title: `Chat ${request.chat_id}`,
        })
      }
      if (request._ === 'getUser') {
        return tdUser(request.user_id)
      }
      throw new Error(`unexpected invoke: ${request._}`)
    },
  }

  const result = await discoverPrivateChats(client)
  assert.deepEqual(
    result.map((c) => c.id),
    [1, 2, 3],
  )
})

test('calling discoverPrivateChats twice produces independent, consistent results with no shared state', async () => {
  const client = createFakeClient({
    chatIds: [1001],
    chats: {
      1001: tdChat(1001, { type: { _: 'chatTypePrivate', user_id: 42 }, title: 'Ada Lovelace' }),
    },
    users: { 42: tdUser(42) },
  })

  const first = await discoverPrivateChats(client)
  const second = await discoverPrivateChats(client)
  assert.deepEqual(first, second)
})
