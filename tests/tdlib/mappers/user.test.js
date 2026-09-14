'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { mapTdlibUserToUser } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'tdlib', 'mappers', 'user.js'),
)

function baseTdUser(overrides = {}) {
  return {
    _: 'user',
    id: 42,
    first_name: 'Ada',
    last_name: 'Lovelace',
    type: { _: 'userTypeRegular' },
    ...overrides,
  }
}

test('maps a regular user to a domain User', () => {
  const result = mapTdlibUserToUser(baseTdUser())
  assert.deepEqual(result, {
    id: 42,
    firstName: 'Ada',
    lastName: 'Lovelace',
    isBot: false,
  })
})

test('maps a bot user with isBot: true', () => {
  const result = mapTdlibUserToUser(baseTdUser({ type: { _: 'userTypeBot' } }))
  assert.equal(result.isBot, true)
})

test('preserves an empty last_name as an empty string, not undefined', () => {
  const result = mapTdlibUserToUser(baseTdUser({ last_name: '' }))
  assert.equal(result.lastName, '')
  assert.notEqual(result.lastName, undefined)
})

test('does not mutate the input TDLib user object', () => {
  const input = baseTdUser()
  const snapshot = JSON.parse(JSON.stringify(input))
  mapTdlibUserToUser(input)
  assert.deepEqual(input, snapshot)
})

test('treats a deleted-account user as a non-bot regular user', () => {
  const result = mapTdlibUserToUser(baseTdUser({ type: { _: 'userTypeDeleted' } }))
  assert.equal(result.isBot, false)
})
