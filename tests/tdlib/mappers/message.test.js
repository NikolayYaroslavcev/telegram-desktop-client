'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { mapTdlibMessageToMessage } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'tdlib', 'mappers', 'message.js'),
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

function baseTdMessage(overrides = {}) {
  return {
    _: 'message',
    id: 111,
    sender_id: { _: 'messageSenderUser', user_id: 7 },
    chat_id: 999,
    is_outgoing: false,
    date: 1700000000,
    content: { _: 'messageText', text: { _: 'formattedText', text: 'hello', entities: [] } },
    ...overrides,
  }
}

test('maps an incoming text message', () => {
  const result = mapTdlibMessageToMessage(baseTdMessage())
  assert.deepEqual(result, {
    id: 111,
    chatId: 999,
    senderId: 7,
    text: 'hello',
    createdAt: 1700000000,
    replyToMessageId: undefined,
    isOutgoing: false,
    isDeleted: false,
    deletedAt: null,
    attachment: undefined,
  })
})

test('maps an outgoing text message with isOutgoing: true', () => {
  const result = mapTdlibMessageToMessage(baseTdMessage({ is_outgoing: true }))
  assert.equal(result.isOutgoing, true)
})

test('extracts content.text.text as plain text, not the formattedText object', () => {
  const result = mapTdlibMessageToMessage(baseTdMessage())
  assert.equal(typeof result.text, 'string')
})

test('extracts replyToMessageId from a messageReplyToMessage reply', () => {
  const result = mapTdlibMessageToMessage(
    baseTdMessage({ reply_to: { _: 'messageReplyToMessage', chat_id: 999, message_id: 55 } }),
  )
  assert.equal(result.replyToMessageId, 55)
})

test('leaves replyToMessageId undefined when there is no reply', () => {
  const result = mapTdlibMessageToMessage(baseTdMessage())
  assert.equal(result.replyToMessageId, undefined)
})

test('leaves replyToMessageId undefined for a reply to a story (not a message)', () => {
  const result = mapTdlibMessageToMessage(
    baseTdMessage({ reply_to: { _: 'messageReplyToStory', story_sender_chat_id: 1, story_id: 2 } }),
  )
  assert.equal(result.replyToMessageId, undefined)
})

test('maps a document message with an attachment and no text', () => {
  const result = mapTdlibMessageToMessage(
    baseTdMessage({
      content: {
        _: 'messageDocument',
        document: {
          _: 'document',
          file_name: 'notes.txt',
          mime_type: 'text/plain',
          document: tdFile({ id: 5, size: 10 }),
        },
        caption: { _: 'formattedText', text: '', entities: [] },
      },
    }),
  )
  assert.equal(result.text, undefined)
  assert.deepEqual(result.attachment, {
    type: 'document',
    fileId: 5,
    size: 10,
    fileName: 'notes.txt',
    localPath: undefined,
  })
})

test('maps a photo message with an attachment and no text', () => {
  const result = mapTdlibMessageToMessage(
    baseTdMessage({
      content: {
        _: 'messagePhoto',
        photo: {
          _: 'photo',
          has_stickers: false,
          sizes: [
            {
              _: 'photoSize',
              type: 'x',
              photo: tdFile({ id: 9, size: 999 }),
              width: 100,
              height: 100,
              progressive_sizes: [],
            },
          ],
        },
        caption: { _: 'formattedText', text: '', entities: [] },
        show_caption_above_media: false,
        has_spoiler: false,
        is_secret: false,
      },
    }),
  )
  assert.equal(result.text, undefined)
  assert.equal(result.attachment.type, 'photo')
  assert.equal(result.attachment.fileId, 9)
})

test('returns null for an unsupported content type', () => {
  const result = mapTdlibMessageToMessage(
    baseTdMessage({ content: { _: 'messageSticker', sticker: {}, is_premium: false } }),
  )
  assert.equal(result, null)
})

test('returns null for a photo message with no sizes (malformed content)', () => {
  const result = mapTdlibMessageToMessage(
    baseTdMessage({
      content: {
        _: 'messagePhoto',
        photo: { _: 'photo', has_stickers: false, sizes: [] },
        caption: { _: 'formattedText', text: '', entities: [] },
        show_caption_above_media: false,
        has_spoiler: false,
        is_secret: false,
      },
    }),
  )
  assert.equal(result, null)
})

test('returns null when the sender is not a user (e.g. an anonymous chat sender)', () => {
  const result = mapTdlibMessageToMessage(
    baseTdMessage({ sender_id: { _: 'messageSenderChat', chat_id: 5 } }),
  )
  assert.equal(result, null)
})

test('never sets isDeleted/deletedAt from a live TDLib message', () => {
  const result = mapTdlibMessageToMessage(baseTdMessage())
  assert.equal(result.isDeleted, false)
  assert.equal(result.deletedAt, null)
})

test('does not mutate the input TDLib message object', () => {
  const input = baseTdMessage()
  const snapshot = JSON.parse(JSON.stringify(input))
  mapTdlibMessageToMessage(input)
  assert.deepEqual(input, snapshot)
})
