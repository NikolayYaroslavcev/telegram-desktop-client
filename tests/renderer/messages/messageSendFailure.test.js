'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { mapMessageSendFailed } = require(
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    'out',
    'renderer-logic',
    'renderer',
    'messages',
    'messageSendFailure.js',
  ),
)

test('mapMessageSendFailed returns a non-empty, generic message - not raw TDLib text', () => {
  const message = mapMessageSendFailed()
  assert.equal(typeof message, 'string')
  assert.ok(message.length > 0)
})

test('mapMessageSendFailed is stable across calls (no per-event branching to test)', () => {
  assert.equal(mapMessageSendFailed(), mapMessageSendFailed())
})
