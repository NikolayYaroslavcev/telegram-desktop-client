'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { formatMessageTimestamp } = require(
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    'out',
    'renderer-logic',
    'renderer',
    'messages',
    'timestampDisplay.js',
  ),
)

function secondsFor(hours, minutes) {
  return Math.floor(new Date(2024, 0, 1, hours, minutes, 0).getTime() / 1000)
}

test('formatMessageTimestamp pads single-digit hours and minutes', () => {
  assert.equal(formatMessageTimestamp(secondsFor(5, 3)), '05:03')
})

test('formatMessageTimestamp renders double-digit hours and minutes as-is', () => {
  assert.equal(formatMessageTimestamp(secondsFor(23, 47)), '23:47')
})

test('formatMessageTimestamp renders midnight as 00:00', () => {
  assert.equal(formatMessageTimestamp(secondsFor(0, 0)), '00:00')
})
