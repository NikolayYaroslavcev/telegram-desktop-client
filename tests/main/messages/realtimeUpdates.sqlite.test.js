'use strict'

// Integration tests for Task 11: `createRealtimeUpdateRouter` against a
// real, temporary SQLite database (via the actual `openDatabase`/
// `MessageRepository`, not a fake) - same pattern as
// tests/main/messages/historyService.sqlite.test.js. Only `getChat` and the
// IPC broadcaster are faked; everything downstream of them (mapping,
// upsert/markDeleted/updateContent, SQLite) is real.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { openDatabase, closeDatabase, MessageRepository } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'storage', 'index.js'),
)
const { createRealtimeUpdateRouter } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'messages', 'realtimeUpdates.js'),
)

function makeRepo() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'tdc-realtime-updates-test-'))
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

function createFakeBroadcaster() {
  const newMessages = []
  const deletions = []
  return {
    newMessages,
    deletions,
    newMessage: (message) => newMessages.push(message),
    messageDeleted: (event) => deletions.push(event),
  }
}

function makeRouter(
  repo,
  { chatId = 10, isPrivate = true, broadcaster = createFakeBroadcaster(), now } = {},
) {
  return {
    router: createRealtimeUpdateRouter({
      getChat: async (id) =>
        isPrivate && id === chatId ? { id, peerUserId: 7, title: 'Chat' } : null,
      getMessageRepository: () => repo,
      eventBroadcaster: broadcaster,
      now,
    }),
    broadcaster,
  }
}

test('updateNewMessage persists a real row readable via getHistory', async () => {
  const { db, repo } = makeRepo()
  try {
    const { router, broadcaster } = makeRouter(repo)
    await router({ _: 'updateNewMessage', message: tdMessage(1, 10) })

    const history = repo.getHistory(10)
    assert.equal(history.length, 1)
    assert.equal(history[0].text, 'text 1')
    assert.deepEqual(
      broadcaster.newMessages.map((m) => m.id),
      [1],
    )
  } finally {
    closeDatabase(db)
  }
})

test('updateNewMessage for a non-private chat (getChat -> null) writes nothing', async () => {
  const { db, repo } = makeRepo()
  try {
    const { router, broadcaster } = makeRouter(repo, { isPrivate: false })
    await router({ _: 'updateNewMessage', message: tdMessage(1, 10) })

    assert.deepEqual(repo.getHistory(10), [])
    assert.deepEqual(broadcaster.newMessages, [])
  } finally {
    closeDatabase(db)
  }
})

test('full lifecycle: new -> content update -> delete -> duplicate delete', async () => {
  const { db, repo } = makeRepo()
  try {
    const { router, broadcaster } = makeRouter(repo, { now: () => 8000 })

    await router({ _: 'updateNewMessage', message: tdMessage(1, 10) })
    await router({
      _: 'updateMessageContent',
      chat_id: 10,
      message_id: 1,
      new_content: {
        _: 'messageText',
        text: { _: 'formattedText', text: 'edited text', entities: [] },
      },
    })
    await router({
      _: 'updateDeleteMessages',
      chat_id: 10,
      message_ids: [1],
      is_permanent: true,
      from_cache: false,
    })
    await router({
      _: 'updateDeleteMessages',
      chat_id: 10,
      message_ids: [1],
      is_permanent: true,
      from_cache: false,
    }) // duplicate delete

    const row = db.prepare('SELECT * FROM messages WHERE chat_id = 10 AND message_id = 1').get()
    assert.equal(row.text, 'edited text') // original text overwritten by the edit, then preserved through delete
    assert.notEqual(row.text, null)
    assert.equal(row.is_deleted, 1)
    assert.notEqual(row.deleted_at, null)
    assert.equal(row.deleted_at, 8000)

    const count = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n
    assert.equal(count, 1) // no duplicate rows from any step

    assert.equal(broadcaster.deletions.length, 2) // both delete deliveries produced an event
  } finally {
    closeDatabase(db)
  }
})

test('delete before a duplicate new-message delivery is not resurrected', async () => {
  const { db, repo } = makeRepo()
  try {
    const { router } = makeRouter(repo, { now: () => 123 })

    await router({ _: 'updateNewMessage', message: tdMessage(1, 10) })
    await router({
      _: 'updateDeleteMessages',
      chat_id: 10,
      message_ids: [1],
      is_permanent: true,
      from_cache: false,
    })
    // TDLib re-delivering the same "live" message after this app already tombstoned it.
    await router({ _: 'updateNewMessage', message: tdMessage(1, 10) })

    const row = db.prepare('SELECT * FROM messages WHERE chat_id = 10 AND message_id = 1').get()
    assert.equal(row.is_deleted, 1)
    assert.equal(row.deleted_at, 123)
  } finally {
    closeDatabase(db)
  }
})

test('updateDeleteMessages for a message never seen locally is idempotent and does not crash', async () => {
  const { db, repo } = makeRepo()
  try {
    const { router, broadcaster } = makeRouter(repo)

    await assert.doesNotReject(() =>
      router({
        _: 'updateDeleteMessages',
        chat_id: 10,
        message_ids: [404],
        is_permanent: true,
        from_cache: false,
      }),
    )

    assert.deepEqual(repo.getHistory(10), [])
    assert.deepEqual(broadcaster.deletions, [])
  } finally {
    closeDatabase(db)
  }
})

test('send lifecycle: pending new message -> send succeeded -> exactly one canonical row, no duplicates', async () => {
  const { db, repo } = makeRepo()
  try {
    const { router, broadcaster } = makeRouter(repo)

    await router({
      _: 'updateNewMessage',
      message: tdMessage(-1, 10, {
        sending_state: { _: 'messageSendingStatePending', sending_id: 1 },
        is_outgoing: true,
      }),
    })
    assert.deepEqual(broadcaster.newMessages, []) // pending send is stored, not shown yet

    await router({
      _: 'updateMessageSendSucceeded',
      message: tdMessage(555, 10, { is_outgoing: true }),
      old_message_id: -1,
    })

    const rows = db.prepare('SELECT * FROM messages WHERE chat_id = 10').all()
    assert.equal(rows.length, 1) // no duplicate rows across the temp -> final transition
    assert.equal(rows[0].message_id, 555)
    assert.equal(rows[0].text, 'text 555')

    const history = repo.getHistory(10)
    assert.equal(history.length, 1)
    assert.equal(history[0].id, 555)
    assert.deepEqual(
      broadcaster.newMessages.map((m) => m.id),
      [555],
    ) // exactly one event, for the final message
  } finally {
    closeDatabase(db)
  }
})

test('send lifecycle: a failed send leaves no row behind at all', async () => {
  const { db, repo } = makeRepo()
  try {
    const { router, broadcaster } = makeRouter(repo)

    await router({
      _: 'updateNewMessage',
      message: tdMessage(-2, 10, {
        sending_state: { _: 'messageSendingStatePending', sending_id: 2 },
        is_outgoing: true,
      }),
    })
    await router({
      _: 'updateMessageSendFailed',
      message: tdMessage(-2, 10, { is_outgoing: true }),
      old_message_id: -2,
      error: { _: 'error', code: 400, message: 'CHAT_WRITE_FORBIDDEN' },
    })

    const count = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE chat_id = 10').get().n
    assert.equal(count, 0)
    assert.deepEqual(broadcaster.newMessages, [])
  } finally {
    closeDatabase(db)
  }
})

test('send lifecycle does not interfere with an unrelated real-time message in the same chat', async () => {
  const { db, repo } = makeRepo()
  try {
    const { router, broadcaster } = makeRouter(repo)

    await router({
      _: 'updateNewMessage',
      message: tdMessage(-1, 10, {
        sending_state: { _: 'messageSendingStatePending', sending_id: 1 },
        is_outgoing: true,
      }),
    })
    await router({ _: 'updateNewMessage', message: tdMessage(2, 10, { is_outgoing: false }) }) // incoming reply, no sending_state
    await router({
      _: 'updateMessageSendSucceeded',
      message: tdMessage(555, 10, { is_outgoing: true }),
      old_message_id: -1,
    })

    const history = repo.getHistory(10)
    assert.deepEqual(
      history.map((m) => m.id).sort((a, b) => a - b),
      [2, 555],
    )
    assert.deepEqual(
      broadcaster.newMessages.map((m) => m.id).sort((a, b) => a - b),
      [2, 555],
    )
  } finally {
    closeDatabase(db)
  }
})

test('updateNewMessage persists reply_to_message_id for an incoming reply (Task 13)', async () => {
  const { db, repo } = makeRepo()
  try {
    const { router, broadcaster } = makeRouter(repo)

    await router({ _: 'updateNewMessage', message: tdMessage(1, 10) }) // reply target
    await router({
      _: 'updateNewMessage',
      message: tdMessage(2, 10, {
        reply_to: { _: 'messageReplyToMessage', chat_id: 10, message_id: 1 },
      }),
    })

    const [, reply] = repo.findByIds(10, [1, 2])
    assert.equal(reply.replyToMessageId, 1)
    assert.deepEqual(
      broadcaster.newMessages.map((m) => m.id),
      [1, 2],
    )
  } finally {
    closeDatabase(db)
  }
})

test('send lifecycle: replaceMessageId keeps reply_to_message_id through temp -> final id (Task 13)', async () => {
  const { db, repo } = makeRepo()
  try {
    const { router } = makeRouter(repo)

    await router({ _: 'updateNewMessage', message: tdMessage(1, 10) }) // reply target
    await router({
      _: 'updateNewMessage',
      message: tdMessage(-1, 10, {
        sending_state: { _: 'messageSendingStatePending', sending_id: 1 },
        is_outgoing: true,
        reply_to: { _: 'messageReplyToMessage', chat_id: 10, message_id: 1 },
      }),
    })
    await router({
      _: 'updateMessageSendSucceeded',
      message: tdMessage(555, 10, {
        is_outgoing: true,
        reply_to: { _: 'messageReplyToMessage', chat_id: 10, message_id: 1 },
      }),
      old_message_id: -1,
    })

    const [, finalReply] = repo.findByIds(10, [1, 555])
    assert.equal(finalReply.id, 555)
    assert.equal(finalReply.replyToMessageId, 1)
  } finally {
    closeDatabase(db)
  }
})

// --- Task 15/19: a realtime update must never mark a chat as history-synced ---
// (only historyService.ts's first-page TDLib fetch may do that) - otherwise a
// single incoming message for a chat the user has never opened would make a
// later messages.getHistory() serve that one row from "cache" and never
// backfill the rest of the chat's history.

test('updateNewMessage for a chat that was never synced still reports isChatHistorySynced() === false afterwards', async () => {
  const { db, repo } = makeRepo()
  try {
    const { router } = makeRouter(repo)

    await router({ _: 'updateNewMessage', message: tdMessage(1, 10) })

    assert.equal(repo.isChatHistorySynced(10), false)
  } finally {
    closeDatabase(db)
  }
})

test('updateMessageContent and updateDeleteMessages also never flip isChatHistorySynced() to true', async () => {
  const { db, repo } = makeRepo()
  try {
    const { router } = makeRouter(repo, { now: () => 1 })

    await router({ _: 'updateNewMessage', message: tdMessage(1, 10) })
    await router({
      _: 'updateMessageContent',
      chat_id: 10,
      message_id: 1,
      new_content: { _: 'messageText', text: { _: 'formattedText', text: 'edited', entities: [] } },
    })
    await router({
      _: 'updateDeleteMessages',
      chat_id: 10,
      message_ids: [1],
      is_permanent: true,
      from_cache: false,
    })

    assert.equal(repo.isChatHistorySynced(10), false)
  } finally {
    closeDatabase(db)
  }
})

test('a chat already marked synced by a real history fetch is not affected by a later realtime message', async () => {
  const { db, repo } = makeRepo()
  try {
    repo.markChatHistorySynced(10, 1000) // simulates a completed historyService.ts first-page fetch
    const { router } = makeRouter(repo)

    await router({ _: 'updateNewMessage', message: tdMessage(2, 10) })

    assert.equal(repo.isChatHistorySynced(10), true) // unchanged - still synced, not reset by the realtime path
  } finally {
    closeDatabase(db)
  }
})

test('two chat ids stay isolated across new/update/delete', async () => {
  const { db, repo } = makeRepo()
  try {
    const broadcaster = createFakeBroadcaster()
    const router = createRealtimeUpdateRouter({
      getChat: async (id) => ({ id, peerUserId: 7, title: 'Chat' }),
      getMessageRepository: () => repo,
      eventBroadcaster: broadcaster,
      now: () => 1,
    })

    await router({ _: 'updateNewMessage', message: tdMessage(1, 10) })
    await router({ _: 'updateNewMessage', message: tdMessage(1, 20) })
    await router({
      _: 'updateDeleteMessages',
      chat_id: 10,
      message_ids: [1],
      is_permanent: true,
      from_cache: false,
    })

    const chat10 = db.prepare('SELECT * FROM messages WHERE chat_id = 10 AND message_id = 1').get()
    const chat20 = db.prepare('SELECT * FROM messages WHERE chat_id = 20 AND message_id = 1').get()
    assert.equal(chat10.is_deleted, 1)
    assert.equal(chat20.is_deleted, 0)
  } finally {
    closeDatabase(db)
  }
})
