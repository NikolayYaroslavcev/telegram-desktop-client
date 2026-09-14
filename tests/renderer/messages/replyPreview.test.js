'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { resolveReplyPreview, formatReplyPreviewLabel } = require(
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    'out',
    'renderer-logic',
    'renderer',
    'messages',
    'replyPreview.js',
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

test('resolveReplyPreview returns available with the target text when the target is loaded and not deleted', () => {
  const preview = resolveReplyPreview([message({ id: 1, text: 'original text' })], 1)
  assert.deepEqual(preview, { kind: 'available', text: 'original text' })
})

test('resolveReplyPreview returns unavailable when the target is not in the loaded list', () => {
  const preview = resolveReplyPreview([message({ id: 2 })], 1)
  assert.deepEqual(preview, { kind: 'unavailable' })
})

test('resolveReplyPreview returns unavailable for an empty message list', () => {
  assert.deepEqual(resolveReplyPreview([], 1), { kind: 'unavailable' })
})

test('resolveReplyPreview returns deleted (not the live text) when the target is tombstoned', () => {
  const preview = resolveReplyPreview(
    [message({ id: 1, text: 'still stored', isDeleted: true })],
    1,
  )
  assert.deepEqual(preview, { kind: 'deleted' })
})

test('resolveReplyPreview falls back to "Фото" for a captionless photo target', () => {
  const preview = resolveReplyPreview(
    [message({ id: 1, text: '', attachment: { type: 'photo', fileId: 1, size: 100 } })],
    1,
  )
  assert.deepEqual(preview, { kind: 'available', text: 'Фото' })
})

test('resolveReplyPreview falls back to "Файл" for a captionless document target', () => {
  const preview = resolveReplyPreview(
    [
      message({
        id: 1,
        text: '',
        attachment: { type: 'document', fileId: 1, size: 100, fileName: 'a.txt' },
      }),
    ],
    1,
  )
  assert.deepEqual(preview, { kind: 'available', text: 'Файл' })
})

test('resolveReplyPreview prefers a caption over the attachment fallback when both are present', () => {
  const preview = resolveReplyPreview(
    [message({ id: 1, text: 'look at this', attachment: { type: 'photo', fileId: 1, size: 100 } })],
    1,
  )
  assert.deepEqual(preview, { kind: 'available', text: 'look at this' })
})

test('formatReplyPreviewLabel renders available with the quoted text', () => {
  assert.equal(
    formatReplyPreviewLabel({ kind: 'available', text: 'hi there' }),
    'Ответ на: "hi there"',
  )
})

test('formatReplyPreviewLabel renders a neutral label for a deleted target', () => {
  assert.equal(typeof formatReplyPreviewLabel({ kind: 'deleted' }), 'string')
  assert.ok(formatReplyPreviewLabel({ kind: 'deleted' }).length > 0)
})

test('formatReplyPreviewLabel renders a neutral label for an unavailable target', () => {
  assert.equal(typeof formatReplyPreviewLabel({ kind: 'unavailable' }), 'string')
  assert.ok(formatReplyPreviewLabel({ kind: 'unavailable' }).length > 0)
})

test('formatReplyPreviewLabel gives different labels for deleted vs. unavailable', () => {
  assert.notEqual(
    formatReplyPreviewLabel({ kind: 'deleted' }),
    formatReplyPreviewLabel({ kind: 'unavailable' }),
  )
})
