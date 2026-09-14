'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { formatAttachmentSize } = require(
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    'out',
    'renderer-logic',
    'renderer',
    'messages',
    'attachmentDisplay.js',
  ),
)

test('formatAttachmentSize renders bytes under 1024 as-is', () => {
  assert.equal(formatAttachmentSize(0), '0 Б')
  assert.equal(formatAttachmentSize(512), '512 Б')
  assert.equal(formatAttachmentSize(1023), '1023 Б')
})

test('formatAttachmentSize renders kilobytes with one decimal place', () => {
  assert.equal(formatAttachmentSize(1024), '1.0 КБ')
  assert.equal(formatAttachmentSize(1536), '1.5 КБ')
  assert.equal(formatAttachmentSize(1024 * 1023), '1023.0 КБ')
})

test('formatAttachmentSize renders megabytes with one decimal place', () => {
  assert.equal(formatAttachmentSize(1024 * 1024), '1.0 МБ')
  assert.equal(formatAttachmentSize(1024 * 1024 * 2.5), '2.5 МБ')
})
