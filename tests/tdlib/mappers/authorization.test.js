'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { mapTdlibAuthorizationStateToDomain } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'tdlib', 'mappers', 'authorization.js'),
)

test('maps a known raw authorization state discriminant to a domain AuthorizationState', () => {
  assert.deepEqual(mapTdlibAuthorizationStateToDomain('authorizationStateWaitPhoneNumber'), {
    status: 'waitPhoneNumber',
  })
  assert.deepEqual(mapTdlibAuthorizationStateToDomain('authorizationStateReady'), {
    status: 'ready',
  })
})

test('maps an unrecognized raw state to "unknown" instead of throwing', () => {
  assert.deepEqual(mapTdlibAuthorizationStateToDomain('authorizationStateSomeFutureVersion'), {
    status: 'unknown',
  })
})
