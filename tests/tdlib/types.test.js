'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { mapAuthorizationState, mapConnectionState } = require(
  path.join(__dirname, '..', '..', 'out', 'main', 'tdlib', 'types.js'),
)

const CASES = [
  ['authorizationStateWaitTdlibParameters', 'waitTdlibParameters'],
  ['authorizationStateWaitEncryptionKey', 'waitEncryptionKey'],
  ['authorizationStateWaitPhoneNumber', 'waitPhoneNumber'],
  ['authorizationStateWaitEmailAddress', 'waitEmailAddress'],
  ['authorizationStateWaitEmailCode', 'waitEmailCode'],
  ['authorizationStateWaitCode', 'waitCode'],
  ['authorizationStateWaitOtherDeviceConfirmation', 'waitOtherDeviceConfirmation'],
  ['authorizationStateWaitRegistration', 'waitRegistration'],
  ['authorizationStateWaitPassword', 'waitPassword'],
  ['authorizationStateReady', 'ready'],
  ['authorizationStateLoggingOut', 'loggingOut'],
  ['authorizationStateClosing', 'closing'],
  ['authorizationStateClosed', 'closed'],
]

for (const [raw, expected] of CASES) {
  test(`mapAuthorizationState maps ${raw} -> ${expected}`, () => {
    assert.equal(mapAuthorizationState(raw), expected)
  })
}

test('mapAuthorizationState never throws and falls back to "unknown" for an unrecognized state', () => {
  assert.equal(
    mapAuthorizationState('authorizationStateSomethingFromAFutureTdlibVersion'),
    'unknown',
  )
  assert.equal(mapAuthorizationState(''), 'unknown')
})

// --- mapConnectionState (Task 17) ---

const CONNECTION_CASES = [
  ['connectionStateWaitingForNetwork', 'waitingForNetwork'],
  ['connectionStateConnectingToProxy', 'connectingToProxy'],
  ['connectionStateConnecting', 'connecting'],
  ['connectionStateUpdating', 'updating'],
  ['connectionStateReady', 'ready'],
]

for (const [raw, expected] of CONNECTION_CASES) {
  test(`mapConnectionState maps ${raw} -> ${expected}`, () => {
    assert.equal(mapConnectionState(raw), expected)
  })
}

test('mapConnectionState never throws and falls back to "unknown" for an unrecognized state', () => {
  assert.equal(mapConnectionState('connectionStateSomethingFromAFutureTdlibVersion'), 'unknown')
  assert.equal(mapConnectionState(''), 'unknown')
})
