'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { upsertMessageInList, markMessageDeletedInList } = require(
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    'out',
    'renderer-logic',
    'renderer',
    'messages',
    'messageList.js',
  ),
)

function message(overrides = {}) {
  return {
    id: 1,
    chatId: 10,
    senderId: 5,
    text: 'hello',
    createdAt: 1000,
    isOutgoing: false,
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  }
}

test('upsertMessageInList replaces an existing entry with the same id', () => {
  const next = upsertMessageInList(
    [message({ id: 1, text: 'old' })],
    message({ id: 1, text: 'new' }),
  )
  assert.deepEqual(
    next.map((m) => m.text),
    ['new'],
  )
})

// --- markMessageDeletedInList (Task 16: events.onMessageDeleted wiring) ---

test('markMessageDeletedInList marks the matching message deleted, preserving its text', () => {
  const messages = [message({ id: 1, text: 'will be deleted' })]
  const next = markMessageDeletedInList(messages, { chatId: 10, messageId: 1, deletedAt: 5000 })

  assert.equal(next[0].isDeleted, true)
  assert.equal(next[0].deletedAt, 5000)
  assert.equal(next[0].text, 'will be deleted')
})

test('markMessageDeletedInList leaves other messages in the list untouched', () => {
  const messages = [message({ id: 1, text: 'a' }), message({ id: 2, text: 'b' })]
  const next = markMessageDeletedInList(messages, { chatId: 10, messageId: 1, deletedAt: 5000 })

  assert.equal(next[1].isDeleted, false)
  assert.equal(next[1].text, 'b')
})

test('markMessageDeletedInList is a no-op when the message id is not in the list', () => {
  const messages = [message({ id: 1 })]
  const next = markMessageDeletedInList(messages, { chatId: 10, messageId: 404, deletedAt: 5000 })

  assert.deepEqual(next, messages)
})

test('markMessageDeletedInList is idempotent: a repeated event keeps the first deletedAt', () => {
  const messages = [message({ id: 1 })]
  const first = markMessageDeletedInList(messages, { chatId: 10, messageId: 1, deletedAt: 5000 })
  const second = markMessageDeletedInList(first, { chatId: 10, messageId: 1, deletedAt: 9999 })

  assert.equal(second[0].isDeleted, true)
  assert.equal(second[0].deletedAt, 5000)
})
