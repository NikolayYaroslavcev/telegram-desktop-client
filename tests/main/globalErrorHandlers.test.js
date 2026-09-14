'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { handleFatalProcessError, installGlobalSafetyNet } = require(
  path.join(__dirname, '..', '..', 'out', 'main', 'globalErrorHandlers.js'),
)

function withConsoleErrorSpy(fn) {
  const original = console.error
  const calls = []
  console.error = (...args) => calls.push(args)
  try {
    fn()
  } finally {
    console.error = original
  }
  return calls
}

test('handleFatalProcessError logs a structured entry without throwing, for an Error value', () => {
  const calls = withConsoleErrorSpy(() => {
    handleFatalProcessError('uncaughtException', new Error('boom'))
  })

  assert.equal(calls.length, 1)
  const entry = JSON.parse(calls[0][0])
  assert.equal(entry.level, 'error')
  assert.equal(entry.operation, 'process.uncaughtException')
  assert.equal(entry.errorCode, 'INTERNAL_ERROR')
  assert.equal(entry.details.message, 'boom')
})

test('handleFatalProcessError handles a non-Error rejection reason without throwing', () => {
  const calls = withConsoleErrorSpy(() => {
    handleFatalProcessError('unhandledRejection', 'a rejected string reason')
  })

  assert.equal(calls.length, 1)
  const entry = JSON.parse(calls[0][0])
  assert.equal(entry.operation, 'process.unhandledRejection')
  assert.equal(entry.details.message, 'a rejected string reason')
})

/**
 * A minimal fake of the two `process.on(...)` overloads `installGlobalSafetyNet`
 * uses - deliberately not the real `process` object. `node --test` installs
 * its own `uncaughtException`/`unhandledRejection` listeners for crash
 * detection, so exercising this against the real process would collide with
 * the test runner itself; `installGlobalSafetyNet` takes an injectable
 * `target` for exactly this reason.
 */
function createFakeProcess() {
  const listeners = {}
  return {
    on(event, listener) {
      listeners[event] = listener
    },
    emit(event, payload) {
      listeners[event](payload)
    },
  }
}

test('installGlobalSafetyNet logs and calls exit(1) exactly once on uncaughtException, without touching the real process', () => {
  const fakeProcess = createFakeProcess()
  const exitCalls = []
  installGlobalSafetyNet((code) => exitCalls.push(code), fakeProcess)

  const calls = withConsoleErrorSpy(() => {
    fakeProcess.emit('uncaughtException', new Error('fatal main-process bug'))
  })

  assert.equal(exitCalls.length, 1)
  assert.equal(exitCalls[0], 1)
  assert.equal(calls.length, 1)
  const entry = JSON.parse(calls[0][0])
  assert.equal(entry.operation, 'process.uncaughtException')
})

test('installGlobalSafetyNet logs and calls exit(1) on unhandledRejection, without touching the real process', () => {
  const fakeProcess = createFakeProcess()
  const exitCalls = []
  installGlobalSafetyNet((code) => exitCalls.push(code), fakeProcess)

  const calls = withConsoleErrorSpy(() => {
    fakeProcess.emit('unhandledRejection', new Error('an await with no .catch'))
  })

  assert.equal(exitCalls.length, 1)
  assert.equal(exitCalls[0], 1)
  const entry = JSON.parse(calls[0][0])
  assert.equal(entry.operation, 'process.unhandledRejection')
})
