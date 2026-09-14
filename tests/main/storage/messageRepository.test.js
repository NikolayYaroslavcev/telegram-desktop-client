'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { openDatabase, closeDatabase } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'storage', 'db.js'),
)
const { MessageRepository } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'storage', 'messageRepository.js'),
)

function makeRepo() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'tdc-storage-repo-test-'))
  const db = openDatabase(path.join(userDataPath, 'app.db'))
  return { db, repo: new MessageRepository(db) }
}

function baseMessage(overrides = {}) {
  return {
    id: 1,
    chatId: 10,
    senderId: 5,
    text: 'hello',
    createdAt: 1000,
    replyToMessageId: undefined,
    isOutgoing: false,
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  }
}

test('upsertMessage saves a new message and it round-trips through getHistory', () => {
  const { db, repo } = makeRepo()
  try {
    repo.upsertMessage(baseMessage())
    const history = repo.getHistory(10)
    assert.equal(history.length, 1)
    assert.deepEqual(history[0], {
      id: 1,
      chatId: 10,
      senderId: 5,
      text: 'hello',
      createdAt: 1000,
      replyToMessageId: undefined,
      isOutgoing: false,
      isDeleted: false,
      deletedAt: null,
      attachment: undefined,
    })
  } finally {
    closeDatabase(db)
  }
})

test('repeated upsertMessage of the same (chatId, id) does not create a duplicate', () => {
  const { db, repo } = makeRepo()
  try {
    repo.upsertMessage(baseMessage())
    repo.upsertMessage(baseMessage())
    repo.upsertMessage(baseMessage())

    const count = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n
    assert.equal(count, 1)
  } finally {
    closeDatabase(db)
  }
})

test('repeated upsertMessage updates mutable fields correctly', () => {
  const { db, repo } = makeRepo()
  try {
    repo.upsertMessage(baseMessage({ text: 'original', createdAt: 1000, senderId: 5 }))
    repo.upsertMessage(
      baseMessage({ text: 'edited', createdAt: 1000, senderId: 5, replyToMessageId: 99 }),
    )

    const [message] = repo.getHistory(10)
    assert.equal(message.text, 'edited')
    assert.equal(message.replyToMessageId, 99)
  } finally {
    closeDatabase(db)
  }
})

test('upsertMessage does not fail or throw on a duplicate (chatId, id)', () => {
  const { db, repo } = makeRepo()
  try {
    repo.upsertMessage(baseMessage())
    assert.doesNotThrow(() => repo.upsertMessage(baseMessage({ text: 'again' })))
  } finally {
    closeDatabase(db)
  }
})

test('getHistory returns messages for a chat in stable chronological order', () => {
  const { db, repo } = makeRepo()
  try {
    repo.upsertMessage(baseMessage({ id: 3, createdAt: 3000, text: 'third' }))
    repo.upsertMessage(baseMessage({ id: 1, createdAt: 1000, text: 'first' }))
    repo.upsertMessage(baseMessage({ id: 2, createdAt: 2000, text: 'second' }))

    const history = repo.getHistory(10)
    assert.deepEqual(
      history.map((m) => m.text),
      ['first', 'second', 'third'],
    )
  } finally {
    closeDatabase(db)
  }
})

test('multiple chat ids do not mix messages', () => {
  const { db, repo } = makeRepo()
  try {
    repo.upsertMessage(baseMessage({ id: 1, chatId: 10, text: 'chat 10' }))
    repo.upsertMessage(baseMessage({ id: 1, chatId: 20, text: 'chat 20' }))

    const chat10 = repo.getHistory(10)
    const chat20 = repo.getHistory(20)
    assert.equal(chat10.length, 1)
    assert.equal(chat20.length, 1)
    assert.equal(chat10[0].text, 'chat 10')
    assert.equal(chat20[0].text, 'chat 20')
  } finally {
    closeDatabase(db)
  }
})

test('findByIds returns existing messages scoped to a chat', () => {
  const { db, repo } = makeRepo()
  try {
    repo.upsertMessage(baseMessage({ id: 1, chatId: 10, text: 'a' }))
    repo.upsertMessage(baseMessage({ id: 2, chatId: 10, text: 'b' }))
    // Same message_id in a different chat - must not be returned for chat 10.
    repo.upsertMessage(baseMessage({ id: 1, chatId: 20, text: 'different chat' }))

    const found = repo.findByIds(10, [1, 2, 999])
    assert.deepEqual(
      found.map((m) => m.text),
      ['a', 'b'],
    )
  } finally {
    closeDatabase(db)
  }
})

test('findByIds returns an empty array for an empty id list', () => {
  const { db, repo } = makeRepo()
  try {
    assert.deepEqual(repo.findByIds(10, []), [])
  } finally {
    closeDatabase(db)
  }
})

test('markDeleted does not delete the row and preserves the original text', () => {
  const { db, repo } = makeRepo()
  try {
    repo.upsertMessage(baseMessage({ text: 'will be deleted' }))
    const found = repo.markDeleted(10, 1, 5000)

    assert.equal(found, true)
    const [message] = repo.getHistory(10)
    assert.equal(message.isDeleted, true)
    assert.equal(message.text, 'will be deleted')
    assert.equal(message.deletedAt, 5000)
  } finally {
    closeDatabase(db)
  }
})

test('repeated markDeleted is idempotent and keeps the first deletion timestamp', () => {
  const { db, repo } = makeRepo()
  try {
    repo.upsertMessage(baseMessage())
    repo.markDeleted(10, 1, 5000)
    const foundAgain = repo.markDeleted(10, 1, 9999)

    assert.equal(foundAgain, true)
    const [message] = repo.getHistory(10)
    assert.equal(message.isDeleted, true)
    assert.equal(message.deletedAt, 5000)
  } finally {
    closeDatabase(db)
  }
})

test('markDeleted on a message the storage never saw returns false and inserts nothing', () => {
  const { db, repo } = makeRepo()
  try {
    const found = repo.markDeleted(10, 404, 5000)
    assert.equal(found, false)
    assert.deepEqual(repo.getHistory(10), [])
  } finally {
    closeDatabase(db)
  }
})

// --- replaceMessageId (Task 12 send lifecycle) ---

test('replaceMessageId transitions a temporary row to its final id, with no duplicate left behind', () => {
  const { db, repo } = makeRepo()
  try {
    repo.upsertMessage(
      baseMessage({ id: -1, text: 'hello', createdAt: 1000, senderId: 5, isOutgoing: true }),
    )

    const existed = repo.replaceMessageId(
      10,
      -1,
      baseMessage({ id: 500, text: 'hello', createdAt: 1000, senderId: 5, isOutgoing: true }),
    )

    assert.equal(existed, true)
    const history = repo.getHistory(10)
    assert.equal(history.length, 1)
    assert.equal(history[0].id, 500)
    assert.equal(history[0].text, 'hello')

    const count = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n
    assert.equal(count, 1) // the temporary row (-1) is gone, not left as an orphan
  } finally {
    closeDatabase(db)
  }
})

test('replaceMessageId is idempotent under a repeated delivery of the same transition', () => {
  const { db, repo } = makeRepo()
  try {
    repo.upsertMessage(baseMessage({ id: -1, text: 'hello', createdAt: 1000 }))

    repo.replaceMessageId(10, -1, baseMessage({ id: 500, text: 'hello', createdAt: 1000 }))
    const existedAgain = repo.replaceMessageId(
      10,
      -1,
      baseMessage({ id: 500, text: 'hello', createdAt: 1000 }),
    )

    assert.equal(existedAgain, false) // the temp row is already gone the second time
    const count = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n
    assert.equal(count, 1)
    assert.equal(repo.getHistory(10)[0].id, 500)
  } finally {
    closeDatabase(db)
  }
})

test('replaceMessageId returns false and still writes the final message when there was no temporary row', () => {
  const { db, repo } = makeRepo()
  try {
    const existed = repo.replaceMessageId(
      10,
      -1,
      baseMessage({ id: 500, text: 'hello', createdAt: 1000 }),
    )

    assert.equal(existed, false)
    const history = repo.getHistory(10)
    assert.equal(history.length, 1)
    assert.equal(history[0].id, 500)
  } finally {
    closeDatabase(db)
  }
})

test('replaceMessageId does not touch other chats or other messages in the same chat', () => {
  const { db, repo } = makeRepo()
  try {
    repo.upsertMessage(baseMessage({ id: -1, chatId: 10, text: 'pending' }))
    repo.upsertMessage(baseMessage({ id: 2, chatId: 10, text: 'unrelated' }))
    repo.upsertMessage(baseMessage({ id: -1, chatId: 20, text: 'other chat pending' }))

    repo.replaceMessageId(10, -1, baseMessage({ id: 500, chatId: 10, text: 'pending' }))

    const chat10 = repo.getHistory(10)
    assert.deepEqual(
      chat10.map((m) => [m.id, m.text]).sort(),
      [
        [2, 'unrelated'],
        [500, 'pending'],
      ].sort(),
    )
    assert.equal(repo.getHistory(20).length, 1)
    assert.equal(repo.getHistory(20)[0].id, -1) // untouched - different chat
  } finally {
    closeDatabase(db)
  }
})

// --- deleteMessage (Task 12 send lifecycle: cleanup after a failed send) ---

test('deleteMessage hard-deletes a row and returns true', () => {
  const { db, repo } = makeRepo()
  try {
    repo.upsertMessage(baseMessage({ id: -1, text: 'never sent' }))

    const existed = repo.deleteMessage(10, -1)

    assert.equal(existed, true)
    assert.deepEqual(repo.getHistory(10), [])
    const count = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n
    assert.equal(count, 0)
  } finally {
    closeDatabase(db)
  }
})

test('deleteMessage on a row that does not exist returns false and changes nothing', () => {
  const { db, repo } = makeRepo()
  try {
    repo.upsertMessage(baseMessage({ id: 1, text: 'unrelated' }))

    const existed = repo.deleteMessage(10, 404)

    assert.equal(existed, false)
    assert.equal(repo.getHistory(10).length, 1)
  } finally {
    closeDatabase(db)
  }
})

// --- reply_to_message_id (Task 13) ---

test('replaceMessageId preserves reply_to_message_id through the temporary -> final id transition', () => {
  const { db, repo } = makeRepo()
  try {
    repo.upsertMessage(baseMessage({ id: 1, chatId: 10, text: 'original' })) // reply target
    repo.upsertMessage(
      baseMessage({ id: -1, chatId: 10, text: 'a reply', isOutgoing: true, replyToMessageId: 1 }),
    )

    repo.replaceMessageId(
      10,
      -1,
      baseMessage({ id: 500, chatId: 10, text: 'a reply', isOutgoing: true, replyToMessageId: 1 }),
    )

    const [reply] = repo.findByIds(10, [500])
    assert.equal(reply.replyToMessageId, 1)
  } finally {
    closeDatabase(db)
  }
})

test('a reply to a deleted target keeps its own reply_to_message_id, and the target keeps its tombstone', () => {
  const { db, repo } = makeRepo()
  try {
    repo.upsertMessage(baseMessage({ id: 1, chatId: 10, text: 'will be deleted' }))
    repo.markDeleted(10, 1, 5000)
    repo.upsertMessage(baseMessage({ id: 2, chatId: 10, text: 'a reply', replyToMessageId: 1 }))

    const [target, reply] = repo.findByIds(10, [1, 2])
    assert.equal(target.isDeleted, true)
    assert.equal(target.text, 'will be deleted') // tombstone text preserved
    assert.equal(reply.replyToMessageId, 1)
    assert.equal(reply.isDeleted, false)
  } finally {
    closeDatabase(db)
  }
})

test('upsertMessage after markDeleted does not resurrect the tombstone', () => {
  const { db, repo } = makeRepo()
  try {
    repo.upsertMessage(baseMessage({ text: 'original' }))
    repo.markDeleted(10, 1, 5000)
    repo.upsertMessage(baseMessage({ text: 'resent by tdlib' }))

    const [message] = repo.getHistory(10)
    assert.equal(message.isDeleted, true)
    assert.equal(message.deletedAt, 5000)
  } finally {
    closeDatabase(db)
  }
})

// --- chat_history_sync (Task 15 cache-first read path) ---

test('isChatHistorySynced is false for a chat that was never marked synced', () => {
  const { db, repo } = makeRepo()
  try {
    assert.equal(repo.isChatHistorySynced(10), false)
  } finally {
    closeDatabase(db)
  }
})

test('markChatHistorySynced makes isChatHistorySynced return true for that chat only', () => {
  const { db, repo } = makeRepo()
  try {
    repo.markChatHistorySynced(10, 1000)

    assert.equal(repo.isChatHistorySynced(10), true)
    assert.equal(repo.isChatHistorySynced(20), false) // a different chat is untouched
  } finally {
    closeDatabase(db)
  }
})

test('markChatHistorySynced is idempotent and keeps the latest synced_at, not a duplicate row', () => {
  const { db, repo } = makeRepo()
  try {
    repo.markChatHistorySynced(10, 1000)
    repo.markChatHistorySynced(10, 2000)

    const rows = db.prepare('SELECT * FROM chat_history_sync WHERE chat_id = 10').all()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].synced_at, 2000)
  } finally {
    closeDatabase(db)
  }
})

test('markChatHistorySynced survives repository recreation against the same database file', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'tdc-storage-repo-test-'))
  const dbPath = path.join(userDataPath, 'app.db')

  const db1 = openDatabase(dbPath)
  new MessageRepository(db1).markChatHistorySynced(10, 1000)
  closeDatabase(db1)

  const db2 = openDatabase(dbPath)
  try {
    assert.equal(new MessageRepository(db2).isChatHistorySynced(10), true)
  } finally {
    closeDatabase(db2)
  }
})

// --- Task 18: raw driver failures must never escape as a raw better-sqlite3 error ---

const { StorageError } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'storage', 'storageError.js'),
)

test('a driver failure (operating on a closed database) is wrapped as StorageError with a fixed safe message, not the raw SQLite error', () => {
  const { db, repo } = makeRepo()
  closeDatabase(db) // any further operation now fails at the driver level

  assert.throws(
    () => repo.upsertMessage(baseMessage()),
    (err) => {
      assert.ok(err instanceof StorageError)
      assert.equal(err.message, 'Local storage operation failed')
      assert.ok(err.cause) // the original driver error is preserved for diagnostic logging, not discarded
      return true
    },
  )
})

test('read methods also wrap a driver failure as StorageError', () => {
  const { db, repo } = makeRepo()
  closeDatabase(db)

  assert.throws(
    () => repo.getHistory(10),
    (err) => err instanceof StorageError,
  )
  assert.throws(
    () => repo.findByIds(10, [1]),
    (err) => err instanceof StorageError,
  )
  assert.throws(
    () => repo.isChatHistorySynced(10),
    (err) => err instanceof StorageError,
  )
})
