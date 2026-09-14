'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { classifyAndLogIpcError } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'ipc', 'errorMapping.js'),
)
const { IpcHandlerError } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'shared', 'ipc', 'errors.js'),
)
const { TdlibServiceError } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'tdlib', 'types.js'),
)
const { StorageError } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'storage', 'storageError.js'),
)
const { FilesystemError } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'attachments', 'filesystemError.js'),
)

function withConsoleErrorSpy(fn) {
  const original = console.error
  const calls = []
  console.error = (...args) => calls.push(args)
  let result
  try {
    result = fn()
  } finally {
    console.error = original
  }
  return { result, calls }
}

test('classifyAndLogIpcError passes an IpcHandlerError through unchanged and does not log it again', () => {
  const { result, calls } = withConsoleErrorSpy(() =>
    classifyAndLogIpcError(
      new IpcHandlerError('INVALID_ARGUMENT', '"chatId" must be a finite number'),
      'test.op',
    ),
  )
  assert.deepEqual(result, {
    code: 'INVALID_ARGUMENT',
    message: '"chatId" must be a finite number',
  })
  assert.equal(calls.length, 0)
})

test('classifyAndLogIpcError maps TdlibServiceError kind "client" to TDLIB_ERROR and logs diagnostics', () => {
  const { result, calls } = withConsoleErrorSpy(() =>
    classifyAndLogIpcError(
      new TdlibServiceError('client', 'Failed to send the message via TDLib'),
      'messages.sendText',
    ),
  )
  assert.deepEqual(result, { code: 'TDLIB_ERROR', message: 'Failed to send the message via TDLib' })
  assert.equal(calls.length, 1)
  const entry = JSON.parse(calls[0][0])
  assert.equal(entry.operation, 'messages.sendText')
  assert.equal(entry.errorCode, 'TDLIB_ERROR')
  assert.equal(entry.category, 'client')
})

test('classifyAndLogIpcError maps TdlibServiceError kind "authorization" to NOT_ALLOWED', () => {
  const { result } = withConsoleErrorSpy(() =>
    classifyAndLogIpcError(
      new TdlibServiceError('authorization', 'TDLib is not currently waiting for code'),
      'auth.checkCode',
    ),
  )
  assert.deepEqual(result, {
    code: 'NOT_ALLOWED',
    message: 'TDLib is not currently waiting for code',
  })
})

test('classifyAndLogIpcError maps StorageError to STORAGE_ERROR and logs only the safe SQLite code, never the SQL text', () => {
  // Real better-sqlite3 failures always carry a string `.code` like this -
  // `describeErrorForLog` prefers it over `.message`, which can embed SQL.
  const sqliteLikeCause = new Error(
    'UNIQUE constraint failed: messages.chat_id, messages.message_id',
  )
  sqliteLikeCause.code = 'SQLITE_CONSTRAINT_UNIQUE'
  const { result, calls } = withConsoleErrorSpy(() =>
    classifyAndLogIpcError(
      new StorageError('Local storage operation failed', { cause: sqliteLikeCause }),
      'messages.getHistory',
    ),
  )
  assert.deepEqual(result, { code: 'STORAGE_ERROR', message: 'Local storage operation failed' })
  const line = calls[0][0]
  assert.ok(line.includes('SQLITE_CONSTRAINT_UNIQUE'))
  assert.ok(!line.includes('UNIQUE constraint failed'))
})

test('classifyAndLogIpcError maps FilesystemError to FILESYSTEM_ERROR and never logs an absolute path', () => {
  const fsCause = new Error(
    `ENOENT: no such file or directory, open 'C:\\Users\\alice\\Downloads\\report.pdf'`,
  )
  fsCause.code = 'ENOENT'
  const { result, calls } = withConsoleErrorSpy(() =>
    classifyAndLogIpcError(
      new FilesystemError('Failed to read the downloaded attachment', { cause: fsCause }),
      'messages.downloadAttachment',
    ),
  )
  assert.deepEqual(result, {
    code: 'FILESYSTEM_ERROR',
    message: 'Failed to read the downloaded attachment',
  })
  const line = calls[0][0]
  assert.ok(!line.includes('alice'))
  assert.ok(!line.includes('Downloads'))
  assert.ok(line.includes('ENOENT'))
})

test('classifyAndLogIpcError maps an unknown/unclassified error to a generic INTERNAL_ERROR, never leaking its message to the caller', () => {
  const { result, calls } = withConsoleErrorSpy(() =>
    classifyAndLogIpcError(
      new TypeError("Cannot read properties of undefined (reading 'x')"),
      'messages.sendText',
    ),
  )
  assert.deepEqual(result, { code: 'INTERNAL_ERROR', message: 'Internal error' })
  // The real diagnostic detail still reaches the server-side log, just not the caller.
  const entry = JSON.parse(calls[0][0])
  assert.equal(entry.errorCode, 'INTERNAL_ERROR')
  assert.ok(entry.details.message.includes('Cannot read properties'))
})

test('classifyAndLogIpcError never returns a raw stack trace or Error object as the message', () => {
  const err = new Error('boom')
  const { result } = withConsoleErrorSpy(() => classifyAndLogIpcError(err, 'test.op'))
  assert.equal(typeof result.message, 'string')
  assert.ok(!result.message.includes('at ')) // no stack frame text
  assert.equal(result.message, 'Internal error')
})

// --- Task 19: non-Error thrown values must classify the same safe way an Error does ---

test('classifyAndLogIpcError maps a thrown string to a generic INTERNAL_ERROR, and still logs the string server-side', () => {
  const { result, calls } = withConsoleErrorSpy(() =>
    classifyAndLogIpcError('a plain string failure', 'test.op'),
  )
  assert.deepEqual(result, { code: 'INTERNAL_ERROR', message: 'Internal error' })
  const entry = JSON.parse(calls[0][0])
  assert.equal(entry.errorCode, 'INTERNAL_ERROR')
  assert.equal(entry.details.message, 'a plain string failure')
})

test('classifyAndLogIpcError maps a thrown plain object to a generic INTERNAL_ERROR without throwing', () => {
  const { result, calls } = withConsoleErrorSpy(() =>
    classifyAndLogIpcError({ some: 'object', not: 'an Error' }, 'test.op'),
  )
  assert.deepEqual(result, { code: 'INTERNAL_ERROR', message: 'Internal error' })
  assert.equal(calls.length, 1)
})

test('classifyAndLogIpcError maps thrown null/undefined to a generic INTERNAL_ERROR without throwing', () => {
  const nullResult = withConsoleErrorSpy(() => classifyAndLogIpcError(null, 'test.op')).result
  assert.deepEqual(nullResult, { code: 'INTERNAL_ERROR', message: 'Internal error' })

  const undefinedResult = withConsoleErrorSpy(() =>
    classifyAndLogIpcError(undefined, 'test.op'),
  ).result
  assert.deepEqual(undefinedResult, { code: 'INTERNAL_ERROR', message: 'Internal error' })
})
