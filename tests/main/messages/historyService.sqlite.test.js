'use strict'

// Integration tests for Task 10: `loadChatHistoryPage` against a real,
// temporary SQLite database (via the actual `openDatabase`/`MessageRepository`,
// not a fake) - same pattern as tests/main/storage/messageRepository.test.js.
// Only `TdlibService.getChatHistory` is faked; everything downstream of it
// (mapping, upsert, SQLite) is real.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { openDatabase, closeDatabase, MessageRepository } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'storage', 'index.js'),
)
const {
  loadChatHistoryPage,
  loadChatHistory,
  tryServeChatHistoryFromCache,
  refreshChatHistory,
} = require(path.join(__dirname, '..', '..', '..', 'out', 'main', 'messages', 'historyService.js'))

function makeRepo() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'tdc-history-service-test-'))
  const db = openDatabase(path.join(userDataPath, 'app.db'))
  return { db, repo: new MessageRepository(db) }
}

function tdMessage(id, chatId, overrides = {}) {
  return {
    _: 'message',
    id,
    chat_id: chatId,
    sender_id: { _: 'messageSenderUser', user_id: 7 },
    is_outgoing: false,
    date: 1000 + id,
    content: { _: 'messageText', text: { _: 'formattedText', text: `text ${id}`, entities: [] } },
    ...overrides,
  }
}

function fakeServiceReturning(rawMessages) {
  return {
    async getChatHistory() {
      return rawMessages
    },
  }
}

test('a fetched page is persisted to SQLite and readable via getHistory', async () => {
  const { db, repo } = makeRepo()
  try {
    const service = fakeServiceReturning([tdMessage(3, 10), tdMessage(2, 10), tdMessage(1, 10)])
    await loadChatHistoryPage(service, repo, 10, 0)

    const history = repo.getHistory(10)
    assert.deepEqual(
      history.map((m) => m.id),
      [1, 2, 3],
    ) // getHistory is chronological (oldest first)
  } finally {
    closeDatabase(db)
  }
})

test('reloading the same page twice does not create duplicate rows', async () => {
  const { db, repo } = makeRepo()
  try {
    const service = fakeServiceReturning([tdMessage(2, 10), tdMessage(1, 10)])
    await loadChatHistoryPage(service, repo, 10, 0)
    await loadChatHistoryPage(service, repo, 10, 0)

    const count = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n
    assert.equal(count, 2)
  } finally {
    closeDatabase(db)
  }
})

test('two pages of the same chat combine without gaps or duplicates', async () => {
  const { db, repo } = makeRepo()
  try {
    const service = {
      calls: 0,
      async getChatHistory(chatId, fromMessageId) {
        this.calls += 1
        if (fromMessageId === 0) return [tdMessage(4, 10), tdMessage(3, 10)]
        assert.equal(fromMessageId, 3) // continues from the oldest id of the previous page
        return [tdMessage(2, 10), tdMessage(1, 10)]
      },
    }

    const firstPage = await loadChatHistoryPage(service, repo, 10, 0)
    const oldestOfFirstPage = firstPage[firstPage.length - 1].id
    await loadChatHistoryPage(service, repo, 10, oldestOfFirstPage)

    const history = repo.getHistory(10)
    assert.deepEqual(
      history.map((m) => m.id),
      [1, 2, 3, 4],
    )
  } finally {
    closeDatabase(db)
  }
})

test('multiple chat ids stay isolated from each other', async () => {
  const { db, repo } = makeRepo()
  try {
    // Same TDLib message_id (1) in two different chats - identity is
    // (chat_id, message_id), so loading both must not mix or overwrite them.
    await loadChatHistoryPage(fakeServiceReturning([tdMessage(1, 10)]), repo, 10, 0)
    await loadChatHistoryPage(fakeServiceReturning([tdMessage(1, 20)]), repo, 20, 0)

    assert.deepEqual(
      repo.getHistory(10).map((m) => ({ chatId: m.chatId, id: m.id })),
      [{ chatId: 10, id: 1 }],
    )
    assert.deepEqual(
      repo.getHistory(20).map((m) => ({ chatId: m.chatId, id: m.id })),
      [{ chatId: 20, id: 1 }],
    )
  } finally {
    closeDatabase(db)
  }
})

test('an existing tombstone (is_deleted = 1) is not resurrected by re-loading history that still contains it', async () => {
  const { db, repo } = makeRepo()
  try {
    const service = fakeServiceReturning([
      tdMessage(1, 10, {
        content: { _: 'messageText', text: { _: 'formattedText', text: 'original', entities: [] } },
      }),
    ])
    await loadChatHistoryPage(service, repo, 10, 0)
    repo.markDeleted(10, 1, 5000)

    // TDLib still reports the message as live (it has no concept of this
    // app's own tombstone) - re-fetching history must not undo the delete.
    await loadChatHistoryPage(service, repo, 10, 0)

    const [message] = repo.getHistory(10)
    assert.equal(message.isDeleted, true)
    assert.equal(message.deletedAt, 5000)
  } finally {
    closeDatabase(db)
  }
})

test('a reply message persists its reply_to_message_id via the same history pipeline (Task 13)', async () => {
  const { db, repo } = makeRepo()
  try {
    const reply = tdMessage(2, 10, {
      reply_to: { _: 'messageReplyToMessage', chat_id: 10, message_id: 1 },
    })
    const service = fakeServiceReturning([reply, tdMessage(1, 10)])
    await loadChatHistoryPage(service, repo, 10, 0)

    const [target, replyRow] = repo.findByIds(10, [1, 2])
    assert.equal(target.id, 1)
    assert.equal(replyRow.replyToMessageId, 1)
  } finally {
    closeDatabase(db)
  }
})

test('an empty page persists nothing and does not throw', async () => {
  const { db, repo } = makeRepo()
  try {
    const service = fakeServiceReturning([])
    const result = await loadChatHistoryPage(service, repo, 10, 1)

    assert.deepEqual(result, [])
    assert.deepEqual(repo.getHistory(10), [])
  } finally {
    closeDatabase(db)
  }
})

// --- loadChatHistory / tryServeChatHistoryFromCache (Task 15 cache-first read path) ---

test('cache miss loads via TDLib and marks the chat synced; a second call is served from cache without contacting TDLib again', async () => {
  const { db, repo } = makeRepo()
  try {
    let tdlibCalls = 0
    const service = {
      async getChatHistory() {
        tdlibCalls += 1
        return [tdMessage(2, 10), tdMessage(1, 10)]
      },
    }

    const first = await loadChatHistory(service, repo, 10, 0)
    assert.deepEqual(
      first.map((m) => m.id),
      [2, 1],
    )
    assert.equal(tdlibCalls, 1)

    const second = await loadChatHistory(service, repo, 10, 0)
    assert.deepEqual(
      second.map((m) => m.id),
      [2, 1],
    ) // newest-first, matching TDLib's own order
    assert.equal(tdlibCalls, 1) // still 1 - the second call was a cache hit
  } finally {
    closeDatabase(db)
  }
})

test('cache hit does not touch TDLib at all (tryServeChatHistoryFromCache alone is sufficient)', async () => {
  const { db, repo } = makeRepo()
  try {
    await loadChatHistory(fakeServiceReturning([tdMessage(1, 10)]), repo, 10, 0)

    const served = tryServeChatHistoryFromCache(repo, 10)
    assert.deepEqual(
      served.map((m) => m.id),
      [1],
    )
  } finally {
    closeDatabase(db)
  }
})

test('the synced flag, and the cache it protects, survive repository/service recreation against the same database file', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'tdc-history-service-cache-test-'))
  const dbPath = path.join(userDataPath, 'app.db')

  const db1 = openDatabase(dbPath)
  const repo1 = new MessageRepository(db1)
  await loadChatHistory(fakeServiceReturning([tdMessage(2, 10), tdMessage(1, 10)]), repo1, 10, 0)
  closeDatabase(db1)

  const db2 = openDatabase(dbPath)
  try {
    const repo2 = new MessageRepository(db2)
    const failingService = {
      async getChatHistory() {
        throw new Error('must not be called - the recreated repository already has a synced cache')
      },
    }

    const history = await loadChatHistory(failingService, repo2, 10, 0)
    assert.deepEqual(
      history.map((m) => m.id),
      [2, 1],
    )
  } finally {
    closeDatabase(db2)
  }
})

test("a realtime message that arrives before this chat's history was ever loaded does not create a false cache hit", async () => {
  const { db, repo } = makeRepo()
  try {
    // Simulates realtimeUpdates.ts's updateNewMessage handler upserting a
    // message for a chat the user has never opened - only upsertMessage is
    // called, markChatHistorySynced never is.
    repo.upsertMessage({
      id: 42,
      chatId: 10,
      senderId: 7,
      text: 'a message that arrived before history was ever loaded',
      createdAt: 5000,
      isOutgoing: false,
      isDeleted: false,
      deletedAt: null,
    })

    let tdlibCalls = 0
    const service = {
      async getChatHistory() {
        tdlibCalls += 1
        return [tdMessage(42, 10, { date: 5000 }), tdMessage(2, 10), tdMessage(1, 10)]
      },
    }

    const history = await loadChatHistory(service, repo, 10, 0)
    assert.equal(tdlibCalls, 1) // not treated as a cache hit - TDLib was still consulted
    assert.deepEqual(
      history.map((m) => m.id).sort((a, b) => a - b),
      [1, 2, 42],
    )
    // The pre-existing row was merged (upserted), not duplicated.
    const count = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE chat_id = 10').get().n
    assert.equal(count, 3)
  } finally {
    closeDatabase(db)
  }
})

test('a tombstone survives a cache-hit read with its original text and deleted state intact', async () => {
  const { db, repo } = makeRepo()
  try {
    await loadChatHistory(
      fakeServiceReturning([
        tdMessage(1, 10, {
          content: {
            _: 'messageText',
            text: { _: 'formattedText', text: 'original', entities: [] },
          },
        }),
      ]),
      repo,
      10,
      0,
    )
    repo.markDeleted(10, 1, 5000)

    const [message] = await loadChatHistory(
      {
        async getChatHistory() {
          throw new Error('must not call TDLib on a cache hit')
        },
      },
      repo,
      10,
      0,
    )
    assert.equal(message.isDeleted, true)
    assert.equal(message.text, 'original')
    assert.equal(message.deletedAt, 5000)
  } finally {
    closeDatabase(db)
  }
})

test('reply and attachment metadata survive a cache-hit read', async () => {
  const { db, repo } = makeRepo()
  try {
    const target = tdMessage(1, 10)
    const reply = tdMessage(2, 10, {
      reply_to: { _: 'messageReplyToMessage', chat_id: 10, message_id: 1 },
    })
    const withPhoto = tdMessage(3, 10, {
      content: {
        _: 'messagePhoto',
        photo: {
          _: 'photo',
          has_stickers: false,
          sizes: [
            {
              _: 'photoSize',
              type: 'x',
              width: 1280,
              height: 1280,
              progressive_sizes: [],
              photo: { id: 55, size: 2048, local: { is_downloading_completed: false, path: '' } },
            },
          ],
        },
        caption: { _: 'formattedText', text: '', entities: [] },
        show_caption_above_media: false,
        has_spoiler: false,
        is_secret: false,
      },
    })

    await loadChatHistory(fakeServiceReturning([withPhoto, reply, target]), repo, 10, 0)

    const cached = tryServeChatHistoryFromCache(repo, 10)
    const byId = Object.fromEntries(cached.map((m) => [m.id, m]))
    assert.equal(byId[2].replyToMessageId, 1)
    assert.equal(byId[3].attachment.type, 'photo')
    assert.equal(byId[3].attachment.fileId, 55)
  } finally {
    closeDatabase(db)
  }
})

test('temp -> final id transition is visible through the cache-hit path', async () => {
  const { db, repo } = makeRepo()
  try {
    // First page load marks the chat synced.
    await loadChatHistory(fakeServiceReturning([tdMessage(1, 10)]), repo, 10, 0)

    // An outgoing send: temporary id, then TDLib confirms the final id -
    // same repository calls realtimeUpdates.ts's handlers make.
    repo.upsertMessage({
      id: -1,
      chatId: 10,
      senderId: 7,
      text: 'sent message',
      createdAt: 6000,
      isOutgoing: true,
      isDeleted: false,
      deletedAt: null,
    })
    repo.replaceMessageId(10, -1, {
      id: 999,
      chatId: 10,
      senderId: 7,
      text: 'sent message',
      createdAt: 6000,
      isOutgoing: true,
      isDeleted: false,
      deletedAt: null,
    })

    const cached = tryServeChatHistoryFromCache(repo, 10)
    assert.deepEqual(
      cached.map((m) => m.id).sort((a, b) => a - b),
      [1, 999],
    )
    assert.equal(
      cached.some((m) => m.id === -1),
      false,
    ) // no leftover temporary row
  } finally {
    closeDatabase(db)
  }
})

// --- refreshChatHistory (Task 17 reconnect recovery) against real SQLite ---

test('refreshChatHistory: an existing tombstone is not resurrected by a reconnect refresh, even though TDLib still reports the message as live', async () => {
  const { db, repo } = makeRepo()
  try {
    const service = fakeServiceReturning([
      tdMessage(1, 10, {
        content: { _: 'messageText', text: { _: 'formattedText', text: 'original', entities: [] } },
      }),
    ])
    await loadChatHistory(service, repo, 10, 0) // initial open: marks chat synced
    repo.markDeleted(10, 1, 5000)

    // Reconnect: TDLib still has no concept of this app's own tombstone and
    // returns the message as live content - the refresh must not undo the delete.
    const refreshed = await refreshChatHistory(service, repo, 10)

    assert.equal(refreshed.length, 1)
    assert.equal(refreshed[0].isDeleted, true)
    assert.equal(refreshed[0].deletedAt, 5000)
    assert.equal(refreshed[0].text, 'original')
  } finally {
    closeDatabase(db)
  }
})

test('refreshChatHistory: a message missed while offline is caught up and merged without duplicating existing rows', async () => {
  const { db, repo } = makeRepo()
  try {
    await loadChatHistory(fakeServiceReturning([tdMessage(1, 10)]), repo, 10, 0)

    // While offline, the peer sent message 2 - TDLib now reports it on reconnect.
    const refreshed = await refreshChatHistory(
      fakeServiceReturning([tdMessage(2, 10), tdMessage(1, 10)]),
      repo,
      10,
    )

    assert.deepEqual(
      refreshed.map((m) => m.id).sort((a, b) => a - b),
      [1, 2],
    )
    const count = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE chat_id = 10').get().n
    assert.equal(count, 2) // no duplicate row for message 1
  } finally {
    closeDatabase(db)
  }
})

test('refreshChatHistory: a repeated reconnect refresh is idempotent (no duplicate rows, no re-resurrected tombstone)', async () => {
  const { db, repo } = makeRepo()
  try {
    const service = fakeServiceReturning([tdMessage(1, 10)])
    await loadChatHistory(service, repo, 10, 0)
    repo.markDeleted(10, 1, 5000)

    await refreshChatHistory(service, repo, 10)
    await refreshChatHistory(service, repo, 10)

    const rows = repo.getHistory(10)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].isDeleted, true)
    assert.equal(rows[0].deletedAt, 5000)
  } finally {
    closeDatabase(db)
  }
})

test("refreshChatHistory: reconnecting on one chat does not touch another chat's cached rows", async () => {
  const { db, repo } = makeRepo()
  try {
    await loadChatHistory(fakeServiceReturning([tdMessage(1, 10)]), repo, 10, 0)
    await loadChatHistory(fakeServiceReturning([tdMessage(1, 20)]), repo, 20, 0)

    // Only chat 10 is "open" and refreshed - proves no mass refresh of every
    // chat happens as a side effect (Task 17's "no mass resync" constraint).
    await refreshChatHistory(fakeServiceReturning([tdMessage(1, 10)]), repo, 10)

    assert.deepEqual(
      repo.getHistory(20).map((m) => m.id),
      [1],
    )
  } finally {
    closeDatabase(db)
  }
})

test('an explicit pagination cursor always calls TDLib and never returns a duplicate row after merging with a cache hit', async () => {
  const { db, repo } = makeRepo()
  try {
    // First page (newest) - marks the chat synced.
    await loadChatHistory(fakeServiceReturning([tdMessage(4, 10), tdMessage(3, 10)]), repo, 10, 0)

    // Older page, explicit cursor - always goes to TDLib per Task 10's contract.
    await loadChatHistory(fakeServiceReturning([tdMessage(2, 10), tdMessage(1, 10)]), repo, 10, 3)

    const history = repo.getHistory(10)
    assert.deepEqual(
      history.map((m) => m.id),
      [1, 2, 3, 4],
    )
    const count = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n
    assert.equal(count, 4) // no duplicates
  } finally {
    closeDatabase(db)
  }
})
