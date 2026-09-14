'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { buildPhotoPreviewDataUrl } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'attachments', 'attachmentPreview.js'),
)

test('buildPhotoPreviewDataUrl base64-encodes the given bytes as an image/jpeg data URL', () => {
  const bytes = Buffer.from('fake jpeg bytes')
  const result = buildPhotoPreviewDataUrl(bytes)

  assert.equal(result, `data:image/jpeg;base64,${bytes.toString('base64')}`)
})

test('buildPhotoPreviewDataUrl round-trips back to the original bytes', () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
  const dataUrl = buildPhotoPreviewDataUrl(bytes)
  const [, base64] = dataUrl.split(',')

  assert.deepEqual(Buffer.from(base64, 'base64'), bytes)
})

test('buildPhotoPreviewDataUrl handles empty input', () => {
  assert.equal(buildPhotoPreviewDataUrl(Buffer.alloc(0)), 'data:image/jpeg;base64,')
})
