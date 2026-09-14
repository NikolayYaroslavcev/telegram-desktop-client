'use strict'

// Unit tests for Task 10's `loadChatHistoryPage`: a fake `TdlibService` (only
// `getChatHistory`) and a fake `MessageRepository` (only `upsertMessage`)
// drive the orchestration function directly, without TDLib or SQLite.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  loadChatHistoryPage,
  loadChatHistory,
  tryServeChatHistoryFromCache,
  refreshChatHistory,
} = require(path.join(__dirname, '..', '..', '..', 'out', 'main', 'messages', 'historyService.js'))

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

function createFakeRepository() {
  const upserted = []
  return { upserted, upsertMessage: (message) => upserted.push(message) }
}

test('maps every raw TDLib message to a domain Message', async () => {
  const service = {
    async getChatHistory() {
      return [tdMessage(2), tdMessage(1)]
    },
  }
  const repository = createFakeRepository()

  const result = await loadChatHistoryPage(service, repository, 10, 0)
  assert.deepEqual(
    result.map((m) => ({ id: m.id, text: m.text })),
    [
      { id: 2, text: 'text 2' },
      { id: 1, text: 'text 1' },
    ],
  )
})

test('upserts each mapped message immediately, in TDLib order, before mapping the next raw message', async () => {
  const order = []
  const service = {
    async getChatHistory() {
      return [tdMessage(3), tdMessage(2), tdMessage(1)]
    },
  }
  const repository = {
    upsertMessage(message) {
      order.push(message.id)
    },
  }

  await loadChatHistoryPage(service, repository, 10, 0)
  assert.deepEqual(order, [3, 2, 1])
})

test('a message the mapper rejects is neither returned nor persisted, and does not stop the rest of the page', async () => {
  const service = {
    async getChatHistory() {
      return [tdMessage(3, { content: { _: 'messageSticker' } }), tdMessage(2), tdMessage(1)]
    },
  }
  const repository = createFakeRepository()

  const result = await loadChatHistoryPage(service, repository, 10, 0)
  assert.deepEqual(
    result.map((m) => m.id),
    [2, 1],
  )
  assert.deepEqual(
    repository.upserted.map((m) => m.id),
    [2, 1],
  )
})

test('a message from a non-user sender is dropped without persisting or throwing', async () => {
  const service = {
    async getChatHistory() {
      return [tdMessage(1, { sender_id: { _: 'messageSenderChat', chat_id: 999 } })]
    },
  }
  const repository = createFakeRepository()

  const result = await loadChatHistoryPage(service, repository, 10, 0)
  assert.deepEqual(result, [])
  assert.deepEqual(repository.upserted, [])
})

test('an empty page from TDLib results in no messages returned or persisted', async () => {
  const service = {
    async getChatHistory() {
      return []
    },
  }
  const repository = createFakeRepository()

  const result = await loadChatHistoryPage(service, repository, 10, 1)
  assert.deepEqual(result, [])
  assert.deepEqual(repository.upserted, [])
})

test('passes chatId and fromMessageId through to TdlibService.getChatHistory unchanged', async () => {
  const calls = []
  const service = {
    async getChatHistory(chatId, fromMessageId) {
      calls.push({ chatId, fromMessageId })
      return []
    },
  }

  await loadChatHistoryPage(service, createFakeRepository(), 42, 777)
  assert.deepEqual(calls, [{ chatId: 42, fromMessageId: 777 }])
})

// --- tryServeChatHistoryFromCache / loadChatHistory (Task 15 cache-first read path) ---

function createFakeCacheRepository({
  synced = false,
  cached = [],
  throwOnSynced,
  throwOnHistory,
} = {}) {
  const upserted = []
  const syncedCalls = []
  const markSyncedCalls = []
  return {
    upserted,
    syncedCalls,
    markSyncedCalls,
    upsertMessage(message) {
      upserted.push(message)
    },
    getHistory() {
      if (throwOnHistory) throw new Error('sqlite read failed')
      return cached
    },
    isChatHistorySynced(chatId) {
      syncedCalls.push(chatId)
      if (throwOnSynced) throw new Error('sqlite read failed')
      return synced
    },
    markChatHistorySynced(chatId, syncedAt) {
      markSyncedCalls.push({ chatId, syncedAt })
    },
  }
}

test('tryServeChatHistoryFromCache returns null when the chat was never marked synced', () => {
  const repository = createFakeCacheRepository({ synced: false })
  assert.equal(tryServeChatHistoryFromCache(repository, 10), null)
})

test('tryServeChatHistoryFromCache returns the cached rows reversed (newest-first) when synced', () => {
  const repository = createFakeCacheRepository({
    synced: true,
    cached: [{ id: 1 }, { id: 2 }, { id: 3 }], // getHistory's own order: oldest-first
  })
  const result = tryServeChatHistoryFromCache(repository, 10)
  assert.deepEqual(
    result.map((m) => m.id),
    [3, 2, 1],
  )
})

test('tryServeChatHistoryFromCache returns null, not a throw, when isChatHistorySynced fails', () => {
  const repository = createFakeCacheRepository({ throwOnSynced: true })
  assert.doesNotThrow(() => tryServeChatHistoryFromCache(repository, 10))
  assert.equal(tryServeChatHistoryFromCache(repository, 10), null)
})

test('tryServeChatHistoryFromCache returns null, not a throw, when getHistory fails after a synced hit', () => {
  const repository = createFakeCacheRepository({ synced: true, throwOnHistory: true })
  assert.equal(tryServeChatHistoryFromCache(repository, 10), null)
})

test('loadChatHistory(fromMessageId: 0) serves from cache and never calls TDLib when the chat is synced', async () => {
  const repository = createFakeCacheRepository({ synced: true, cached: [{ id: 1 }, { id: 2 }] })
  const service = {
    async getChatHistory() {
      throw new Error('must not call TDLib on a cache hit')
    },
  }

  const result = await loadChatHistory(service, repository, 10, 0)
  assert.deepEqual(
    result.map((m) => m.id),
    [2, 1],
  )
})

test('loadChatHistory(fromMessageId: 0) fetches via TDLib on a cache miss, then marks the chat synced', async () => {
  const repository = createFakeCacheRepository({ synced: false })
  const service = {
    async getChatHistory() {
      return [tdMessage(2), tdMessage(1)]
    },
  }

  const result = await loadChatHistory(service, repository, 10, 0)
  assert.deepEqual(
    result.map((m) => m.id),
    [2, 1],
  )
  assert.deepEqual(
    repository.upserted.map((m) => m.id),
    [2, 1],
  )
  assert.equal(repository.markSyncedCalls.length, 1)
  assert.equal(repository.markSyncedCalls[0].chatId, 10)
})

test('loadChatHistory ignores the synced flag and always calls TDLib for an explicit pagination cursor', async () => {
  const repository = createFakeCacheRepository({ synced: true, cached: [{ id: 999 }] })
  const calls = []
  const service = {
    async getChatHistory(chatId, fromMessageId) {
      calls.push({ chatId, fromMessageId })
      return [tdMessage(1)]
    },
  }

  const result = await loadChatHistory(service, repository, 10, 555)
  assert.deepEqual(calls, [{ chatId: 10, fromMessageId: 555 }])
  assert.deepEqual(
    result.map((m) => m.id),
    [1],
  )
  assert.equal(repository.markSyncedCalls.length, 0) // not the first page - sync state is untouched
})

test('loadChatHistory(fromMessageId: 0) falls back to cached rows when the TDLib fetch fails and cache has data', async () => {
  const repository = createFakeCacheRepository({ synced: false, cached: [{ id: 5 }] })
  const service = {
    async getChatHistory() {
      throw new Error('TDLib unreachable')
    },
  }

  const result = await loadChatHistory(service, repository, 10, 0)
  assert.deepEqual(
    result.map((m) => m.id),
    [5],
  )
})

test('loadChatHistory(fromMessageId: 0) rethrows the TDLib error when the fetch fails and the cache is empty', async () => {
  const repository = createFakeCacheRepository({ synced: false, cached: [] })
  const service = {
    async getChatHistory() {
      throw new Error('TDLib unreachable')
    },
  }

  await assert.rejects(() => loadChatHistory(service, repository, 10, 0), /TDLib unreachable/)
})

test('loadChatHistory does not fall back to cache for an explicit pagination cursor when TDLib fails', async () => {
  const repository = createFakeCacheRepository({ synced: true, cached: [{ id: 999 }] })
  const service = {
    async getChatHistory() {
      throw new Error('TDLib unreachable')
    },
  }

  await assert.rejects(() => loadChatHistory(service, repository, 10, 555), /TDLib unreachable/)
})

// --- refreshChatHistory (Task 17 reconnect recovery) ---

test('refreshChatHistory always calls TDLib, even when the chat is already marked synced', async () => {
  const repository = createFakeCacheRepository({ synced: true, cached: [{ id: 1 }] })
  let tdlibCalls = 0
  const service = {
    async getChatHistory() {
      tdlibCalls += 1
      return [tdMessage(2), tdMessage(1)]
    },
  }

  await refreshChatHistory(service, repository, 10)
  assert.equal(tdlibCalls, 1)
  assert.deepEqual(repository.syncedCalls, []) // never consults the cache-hit fast path at all
})

test('refreshChatHistory upserts every fetched message and (re-)marks the chat synced', async () => {
  const repository = createFakeCacheRepository({ synced: false })
  const service = {
    async getChatHistory() {
      return [tdMessage(2), tdMessage(1)]
    },
  }

  await refreshChatHistory(service, repository, 10)
  assert.deepEqual(
    repository.upserted.map((m) => m.id),
    [2, 1],
  )
  assert.equal(repository.markSyncedCalls.length, 1)
  assert.equal(repository.markSyncedCalls[0].chatId, 10)
})

test('refreshChatHistory returns the freshly re-read cache, not the raw TDLib-mapped page', async () => {
  // The fake repository's getHistory() is independent of what was upserted -
  // this proves refreshChatHistory reads storage back rather than just
  // returning loadChatHistoryPage's own return value, which is what
  // protects an existing tombstone from being resurrected (see the sqlite
  // integration test for the real, storage-backed version of this).
  const cachedTruth = [{ id: 1, isDeleted: true, deletedAt: 5000, text: 'original' }]
  const repository = createFakeCacheRepository({ synced: true, cached: cachedTruth })
  const service = {
    async getChatHistory() {
      return [tdMessage(1)]
    },
  }

  const result = await refreshChatHistory(service, repository, 10)
  assert.deepEqual(result, cachedTruth)
})

test('refreshChatHistory propagates a TDLib failure rather than silently returning stale data', async () => {
  const repository = createFakeCacheRepository({ synced: true, cached: [{ id: 1 }] })
  const service = {
    async getChatHistory() {
      throw new Error('TDLib unreachable')
    },
  }

  await assert.rejects(() => refreshChatHistory(service, repository, 10), /TDLib unreachable/)
})
