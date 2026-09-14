'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { extractMessageText, extractMessageAttachment, isSupportedMessageContent } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'tdlib', 'mappers', 'content.js'),
)

function tdFile(overrides = {}) {
  return {
    _: 'file',
    id: 100,
    size: 2048,
    expected_size: 2048,
    local: {
      _: 'localFile',
      path: '',
      can_be_downloaded: true,
      can_be_deleted: false,
      is_downloading_active: false,
      is_downloading_completed: false,
      download_offset: 0,
      downloaded_prefix_size: 0,
      downloaded_size: 0,
    },
    remote: {
      _: 'remoteFile',
      id: 'r1',
      unique_id: 'u1',
      is_uploading_active: false,
      is_uploading_completed: true,
      uploaded_size: 2048,
    },
    ...overrides,
  }
}

test('extractMessageText returns the plain string for a text message', () => {
  const content = {
    _: 'messageText',
    text: { _: 'formattedText', text: 'hello world', entities: [] },
  }
  assert.equal(extractMessageText(content), 'hello world')
})

test('extractMessageText returns undefined (not "undefined" the string) for non-text content', () => {
  const content = {
    _: 'messageDocument',
    document: {},
    caption: { _: 'formattedText', text: '', entities: [] },
  }
  const result = extractMessageText(content)
  assert.equal(result, undefined)
  assert.notEqual(typeof result, 'string')
})

test('isSupportedMessageContent accepts text, photo and document content', () => {
  assert.equal(isSupportedMessageContent({ _: 'messageText' }), true)
  assert.equal(isSupportedMessageContent({ _: 'messagePhoto' }), true)
  assert.equal(isSupportedMessageContent({ _: 'messageDocument' }), true)
})

test('isSupportedMessageContent rejects unsupported content types', () => {
  assert.equal(isSupportedMessageContent({ _: 'messageSticker' }), false)
  assert.equal(isSupportedMessageContent({ _: 'messageVideo' }), false)
  assert.equal(isSupportedMessageContent({ _: 'messagePoll' }), false)
})

test('extractMessageAttachment returns undefined for text content (no attachment, not unsupported)', () => {
  const content = { _: 'messageText', text: { _: 'formattedText', text: 'hi', entities: [] } }
  assert.equal(extractMessageAttachment(content), undefined)
})

test('extractMessageAttachment maps a document message to a document Attachment', () => {
  const content = {
    _: 'messageDocument',
    document: {
      _: 'document',
      file_name: 'report.pdf',
      mime_type: 'application/pdf',
      document: tdFile({ id: 55, size: 4096 }),
    },
    caption: { _: 'formattedText', text: '', entities: [] },
  }
  const result = extractMessageAttachment(content)
  assert.deepEqual(result, {
    type: 'document',
    fileId: 55,
    size: 4096,
    fileName: 'report.pdf',
    localPath: undefined,
  })
})

test('extractMessageAttachment exposes localPath only once the file is fully downloaded', () => {
  const content = {
    _: 'messageDocument',
    document: {
      _: 'document',
      file_name: 'report.pdf',
      mime_type: 'application/pdf',
      document: tdFile({
        id: 55,
        size: 4096,
        local: {
          _: 'localFile',
          path: 'C:\\downloads\\report.pdf',
          can_be_downloaded: true,
          can_be_deleted: true,
          is_downloading_active: false,
          is_downloading_completed: true,
          download_offset: 0,
          downloaded_prefix_size: 4096,
          downloaded_size: 4096,
        },
      }),
    },
    caption: { _: 'formattedText', text: '', entities: [] },
  }
  const result = extractMessageAttachment(content)
  assert.equal(result.localPath, 'C:\\downloads\\report.pdf')
})

test('extractMessageAttachment picks the largest photo size and maps it to a photo Attachment', () => {
  const content = {
    _: 'messagePhoto',
    photo: {
      _: 'photo',
      has_stickers: false,
      sizes: [
        {
          _: 'photoSize',
          type: 's',
          photo: tdFile({ id: 1, size: 500 }),
          width: 90,
          height: 90,
          progressive_sizes: [],
        },
        {
          _: 'photoSize',
          type: 'x',
          photo: tdFile({ id: 2, size: 50000 }),
          width: 1280,
          height: 1280,
          progressive_sizes: [],
        },
        {
          _: 'photoSize',
          type: 'm',
          photo: tdFile({ id: 3, size: 5000 }),
          width: 320,
          height: 320,
          progressive_sizes: [],
        },
      ],
    },
    caption: { _: 'formattedText', text: '', entities: [] },
    show_caption_above_media: false,
    has_spoiler: false,
    is_secret: false,
  }
  const result = extractMessageAttachment(content)
  assert.deepEqual(result, {
    type: 'photo',
    fileId: 2,
    size: 50000,
    fileName: undefined,
    localPath: undefined,
  })
})

test('extractMessageAttachment returns null for a photo with no sizes (malformed input)', () => {
  const content = {
    _: 'messagePhoto',
    photo: { _: 'photo', has_stickers: false, sizes: [] },
    caption: { _: 'formattedText', text: '', entities: [] },
    show_caption_above_media: false,
    has_spoiler: false,
    is_secret: false,
  }
  assert.equal(extractMessageAttachment(content), null)
})

test('extractMessageAttachment returns undefined for unsupported content types', () => {
  assert.equal(extractMessageAttachment({ _: 'messageSticker' }), undefined)
})
