'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { openDatabase, closeDatabase, resolveStorageDatabasePath } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'storage', 'db.js'),
)

function makeTempUserDataPath() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tdc-storage-test-'))
}

test('resolveStorageDatabasePath nests the db under <userData>/storage, outside tdlib', () => {
  const dbPath = resolveStorageDatabasePath(
    path.join('C:', 'Users', 'test', 'AppData', 'Roaming', 'app'),
  )
  assert.equal(
    dbPath,
    path.join('C:', 'Users', 'test', 'AppData', 'Roaming', 'app', 'storage', 'app.db'),
  )
})

test('openDatabase creates the database file at the resolved runtime path', () => {
  const userDataPath = makeTempUserDataPath()
  const dbPath = resolveStorageDatabasePath(userDataPath)
  const db = openDatabase(dbPath)
  try {
    assert.equal(fs.existsSync(dbPath), true)
  } finally {
    closeDatabase(db)
  }
})

test('openDatabase creates the parent directory when it does not exist yet', () => {
  const userDataPath = makeTempUserDataPath()
  const dbPath = path.join(userDataPath, 'nested', 'does-not-exist-yet', 'app.db')
  assert.equal(fs.existsSync(path.dirname(dbPath)), false)

  const db = openDatabase(dbPath)
  try {
    assert.equal(fs.existsSync(dbPath), true)
  } finally {
    closeDatabase(db)
  }
})

test('migration creates the messages table with the required columns', () => {
  const userDataPath = makeTempUserDataPath()
  const db = openDatabase(resolveStorageDatabasePath(userDataPath))
  try {
    const columns = db
      .prepare('PRAGMA table_info(messages)')
      .all()
      .map((col) => col.name)
    assert.deepEqual(
      columns.sort(),
      [
        'id',
        'chat_id',
        'message_id',
        'sender_id',
        'text',
        'created_at',
        'reply_to_message_id',
        'is_outgoing',
        'is_deleted',
        'deleted_at',
        'attachment_type',
        'attachment_file_id',
        'attachment_size',
        'attachment_file_name',
        'attachment_local_path',
      ].sort(),
    )
  } finally {
    closeDatabase(db)
  }
})

test('migration creates the chat_history_sync table (Task 15)', () => {
  const userDataPath = makeTempUserDataPath()
  const db = openDatabase(resolveStorageDatabasePath(userDataPath))
  try {
    const columns = db
      .prepare('PRAGMA table_info(chat_history_sync)')
      .all()
      .map((col) => col.name)
    assert.deepEqual(columns.sort(), ['chat_id', 'synced_at'])
  } finally {
    closeDatabase(db)
  }
})

test('UNIQUE(chat_id, message_id) is enforced at the schema level', () => {
  const userDataPath = makeTempUserDataPath()
  const db = openDatabase(resolveStorageDatabasePath(userDataPath))
  try {
    const insert = db.prepare(
      `INSERT INTO messages (chat_id, message_id, sender_id, text, created_at, is_outgoing)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    insert.run(1, 100, 7, 'hello', 1000, 0)

    assert.throws(() => insert.run(1, 100, 7, 'duplicate', 2000, 0), /UNIQUE/)

    // Same message_id in a different chat is a different row - not a conflict.
    assert.doesNotThrow(() => insert.run(2, 100, 7, 'other chat', 1000, 0))
  } finally {
    closeDatabase(db)
  }
})

test('database closes without error and reopening preserves data', () => {
  const userDataPath = makeTempUserDataPath()
  const dbPath = resolveStorageDatabasePath(userDataPath)

  const db1 = openDatabase(dbPath)
  db1
    .prepare(
      `INSERT INTO messages (chat_id, message_id, sender_id, text, created_at, is_outgoing)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(1, 1, 1, 'persisted', 1000, 0)
  assert.doesNotThrow(() => closeDatabase(db1))

  const db2 = openDatabase(dbPath)
  try {
    const row = db2.prepare('SELECT text FROM messages WHERE chat_id = 1 AND message_id = 1').get()
    assert.equal(row.text, 'persisted')

    // Reopening must not fail or re-apply the already-applied migration.
    const migrationRows = db2.prepare('SELECT id FROM schema_migrations').all()
    assert.deepEqual(
      migrationRows.map((r) => r.id),
      [1, 2, 3],
    )
  } finally {
    closeDatabase(db2)
  }
})
