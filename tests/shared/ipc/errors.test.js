'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { IpcHandlerError, serializeIpcError, deserializeIpcError } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'shared', 'ipc', 'errors.js'),
)

test('IpcHandlerError carries a code and toIpcError() returns the serializable shape', () => {
  const err = new IpcHandlerError('INVALID_ARGUMENT', 'bad input')
  assert.equal(err.code, 'INVALID_ARGUMENT')
  assert.equal(err.message, 'bad input')
  assert.deepEqual(err.toIpcError(), { code: 'INVALID_ARGUMENT', message: 'bad input' })
})

test('serializeIpcError/deserializeIpcError round-trip', () => {
  const original = { code: 'NOT_IMPLEMENTED', message: 'chats.list() is not implemented yet' }
  const wireMessage = serializeIpcError(original)
  assert.deepEqual(deserializeIpcError(wireMessage), original)
})

test("deserializeIpcError survives being wrapped by Electron's own invoke() error prefix", () => {
  const original = { code: 'INTERNAL_ERROR', message: 'boom' }
  const electronWrapped = `Error invoking remote method 'x': Error: ${serializeIpcError(original)}`
  assert.deepEqual(deserializeIpcError(electronWrapped), original)
})

test('deserializeIpcError returns null for a message that is not our envelope', () => {
  assert.equal(deserializeIpcError('some unrelated error message'), null)
  assert.equal(deserializeIpcError(''), null)
})

test('deserializeIpcError returns null for a malformed envelope', () => {
  assert.equal(deserializeIpcError('__ipc_error__:{not json'), null)
  assert.equal(deserializeIpcError('__ipc_error__:{"code":123}'), null)
})
