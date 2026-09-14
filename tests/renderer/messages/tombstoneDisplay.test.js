'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { formatDeletedMarker } = require(
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    'out',
    'renderer-logic',
    'renderer',
    'messages',
    'tombstoneDisplay.js',
  ),
)

test('formatDeletedMarker returns a non-empty, fixed label', () => {
  const label = formatDeletedMarker()
  assert.equal(typeof label, 'string')
  assert.ok(label.length > 0)
})

test('formatDeletedMarker is stable across calls', () => {
  assert.equal(formatDeletedMarker(), formatDeletedMarker())
})

test('formatDeletedMarker differs from the reply-preview deleted label (distinct UI contexts)', () => {
  const { formatReplyPreviewLabel } = require(
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
  assert.notEqual(formatDeletedMarker(), formatReplyPreviewLabel({ kind: 'deleted' }))
})
