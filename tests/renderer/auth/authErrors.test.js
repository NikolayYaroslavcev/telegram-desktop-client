'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  mapAuthError,
  mapVerificationTimeout,
  mapAuthInputRejected,
  mapAuthFlowTerminated,
} = require(
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    'out',
    'renderer-logic',
    'renderer',
    'auth',
    'authErrors.js',
  ),
)

function makeIpcError(code, message) {
  const err = new Error(message)
  err.name = code
  return err
}

test('mapAuthError recognizes the backend-unavailable message', () => {
  const message = mapAuthError(makeIpcError('INTERNAL_ERROR', 'TDLib backend is not available'))
  assert.match(message, /перезапустите/i)
})

test('mapAuthError recognizes the out-of-sync (wrong pending step) message', () => {
  const message = mapAuthError(
    makeIpcError(
      'INTERNAL_ERROR',
      'TDLib is not currently waiting for code (current authorization state: waitPhoneNumber)',
    ),
  )
  assert.match(message, /устарел/i)
})

test('mapAuthError maps INVALID_ARGUMENT to a field-level message', () => {
  const message = mapAuthError(makeIpcError('INVALID_ARGUMENT', '"phone" must be a string'))
  assert.match(message, /некорректные/i)
})

test('mapAuthError falls back to a generic message for anything else, never leaking raw text', () => {
  const message = mapAuthError(makeIpcError('INTERNAL_ERROR', 'Internal error'))
  assert.ok(!message.includes('Internal error'))
  assert.equal(typeof message, 'string')
  assert.ok(message.length > 0)
})

test('mapAuthError handles a non-Error thrown value without crashing', () => {
  const message = mapAuthError('some string thrown as an error')
  assert.equal(typeof message, 'string')
  assert.ok(message.length > 0)
})

test('mapAuthInputRejected returns distinct, non-empty copy for each step', () => {
  const phone = mapAuthInputRejected('phone')
  const code = mapAuthInputRejected('code')
  const password = mapAuthInputRejected('password')
  assert.notEqual(phone, code)
  assert.notEqual(code, password)
  for (const message of [phone, code, password]) {
    assert.equal(typeof message, 'string')
    assert.ok(message.length > 0)
  }
})

test('mapAuthFlowTerminated returns a non-empty, restart-app message', () => {
  const message = mapAuthFlowTerminated()
  assert.equal(typeof message, 'string')
  assert.match(message, /перезапустите/i)
})

test('mapVerificationTimeout returns distinct, non-empty copy for each step', () => {
  const phone = mapVerificationTimeout('phone')
  const code = mapVerificationTimeout('code')
  const password = mapVerificationTimeout('password')
  assert.notEqual(phone, code)
  assert.notEqual(code, password)
  for (const message of [phone, code, password]) {
    assert.equal(typeof message, 'string')
    assert.ok(message.length > 0)
  }
})
