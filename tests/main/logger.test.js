'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { logger, describeErrorForLog } = require(
  path.join(__dirname, '..', '..', 'out', 'main', 'logger.js'),
)

function withConsoleSpy(method, fn) {
  const original = console[method]
  const calls = []
  console[method] = (...args) => calls.push(args)
  try {
    fn()
  } finally {
    console[method] = original
  }
  return calls
}

test('logger.error writes one structured JSON line to console.error', () => {
  const calls = withConsoleSpy('error', () => {
    logger.error({ operation: 'test.op', errorCode: 'TDLIB_ERROR', chatId: 10 })
  })

  assert.equal(calls.length, 1)
  const entry = JSON.parse(calls[0][0])
  assert.equal(entry.level, 'error')
  assert.equal(entry.operation, 'test.op')
  assert.equal(entry.errorCode, 'TDLIB_ERROR')
  assert.equal(entry.chatId, 10)
  assert.equal(typeof entry.time, 'string')
})

test('logger.warn writes to console.warn, logger.info writes to console.log', () => {
  const warnCalls = withConsoleSpy('warn', () => logger.warn({ operation: 'test.warn' }))
  assert.equal(warnCalls.length, 1)
  assert.equal(JSON.parse(warnCalls[0][0]).level, 'warn')

  const infoCalls = withConsoleSpy('log', () => logger.info({ operation: 'test.info' }))
  assert.equal(infoCalls.length, 1)
  assert.equal(JSON.parse(infoCalls[0][0]).level, 'info')
})

test('logger.debug is dropped outside development (VITE_DEV_SERVER_URL unset)', () => {
  const original = process.env.VITE_DEV_SERVER_URL
  delete process.env.VITE_DEV_SERVER_URL
  try {
    const calls = withConsoleSpy('log', () => logger.debug({ operation: 'test.debug' }))
    assert.equal(calls.length, 0)
  } finally {
    if (original !== undefined) process.env.VITE_DEV_SERVER_URL = original
  }
})

test('logger.debug is emitted in development (VITE_DEV_SERVER_URL set)', () => {
  const original = process.env.VITE_DEV_SERVER_URL
  process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173'
  try {
    const calls = withConsoleSpy('log', () => logger.debug({ operation: 'test.debug' }))
    assert.equal(calls.length, 1)
  } finally {
    if (original === undefined) delete process.env.VITE_DEV_SERVER_URL
    else process.env.VITE_DEV_SERVER_URL = original
  }
})

test('describeErrorForLog prefers a string error.code over .message (path/SQL-safe) - Node fs and better-sqlite3 style errors', () => {
  const fsLikeErr = new Error(
    `ENOENT: no such file or directory, open 'C:\\Users\\secret-user\\report.pdf'`,
  )
  fsLikeErr.code = 'ENOENT'
  const described = describeErrorForLog(fsLikeErr)
  assert.equal(described.message, 'ENOENT')
  assert.ok(!described.message.includes('secret-user'))

  const sqliteLikeErr = new Error('UNIQUE constraint failed: messages.chat_id, messages.message_id')
  sqliteLikeErr.code = 'SQLITE_CONSTRAINT_UNIQUE'
  assert.equal(describeErrorForLog(sqliteLikeErr).message, 'SQLITE_CONSTRAINT_UNIQUE')
})

test('describeErrorForLog falls through to .message for a numeric-code error (TDLib-shaped) - the message itself is a safe technical string', () => {
  const tdlibLikeErr = new Error('PHONE_NUMBER_INVALID')
  tdlibLikeErr.code = 400
  assert.equal(describeErrorForLog(tdlibLikeErr).message, 'PHONE_NUMBER_INVALID')
})

test('describeErrorForLog truncates a very long message and handles non-Error values', () => {
  const long = new Error('x'.repeat(1000))
  assert.ok(describeErrorForLog(long).message.length <= 300)

  assert.equal(describeErrorForLog('plain string').message, 'plain string')
  assert.equal(describeErrorForLog(undefined).message, 'undefined')
})
