'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { mapTdlibChatToChat } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'tdlib', 'mappers', 'chat.js'),
)

function baseTdChat(overrides = {}) {
  return {
    _: 'chat',
    id: 1001,
    type: { _: 'chatTypePrivate', user_id: 42 },
    title: 'Ada Lovelace',
    ...overrides,
  }
}

test('maps a valid private one-to-one chat', () => {
  const result = mapTdlibChatToChat(baseTdChat())
  assert.deepEqual(result, {
    id: 1001,
    peerUserId: 42,
    title: 'Ada Lovelace',
    lastMessagePreview: undefined,
  })
})

test('returns null for a basic group chat', () => {
  const result = mapTdlibChatToChat(
    baseTdChat({ type: { _: 'chatTypeBasicGroup', basic_group_id: 5 } }),
  )
  assert.equal(result, null)
})

test('returns null for a supergroup/channel chat', () => {
  const result = mapTdlibChatToChat(
    baseTdChat({ type: { _: 'chatTypeSupergroup', supergroup_id: 5, is_channel: true } }),
  )
  assert.equal(result, null)
})

test('returns null for a secret chat', () => {
  const result = mapTdlibChatToChat(
    baseTdChat({ type: { _: 'chatTypeSecret', secret_chat_id: 5, user_id: 42 } }),
  )
  assert.equal(result, null)
})

test('returns null when chat.type is missing entirely (malformed input)', () => {
  const malformed = baseTdChat()
  delete malformed.type
  assert.equal(mapTdlibChatToChat(malformed), null)
})

test('extracts lastMessagePreview from a text last_message', () => {
  const result = mapTdlibChatToChat(
    baseTdChat({
      last_message: {
        _: 'message',
        content: {
          _: 'messageText',
          text: { _: 'formattedText', text: 'see you then', entities: [] },
        },
      },
    }),
  )
  assert.equal(result.lastMessagePreview, 'see you then')
})

test('leaves lastMessagePreview undefined when there is no last_message', () => {
  const result = mapTdlibChatToChat(baseTdChat())
  assert.equal(result.lastMessagePreview, undefined)
})

test('leaves lastMessagePreview undefined for a non-text last_message', () => {
  const result = mapTdlibChatToChat(
    baseTdChat({
      last_message: {
        _: 'message',
        content: {
          _: 'messageDocument',
          document: { file_name: 'x.pdf' },
          caption: { _: 'formattedText', text: '', entities: [] },
        },
      },
    }),
  )
  assert.equal(result.lastMessagePreview, undefined)
})

test('does not mutate the input TDLib chat object', () => {
  const input = baseTdChat({
    last_message: {
      _: 'message',
      content: { _: 'messageText', text: { _: 'formattedText', text: 'hi', entities: [] } },
    },
  })
  const snapshot = JSON.parse(JSON.stringify(input))
  mapTdlibChatToChat(input)
  assert.deepEqual(input, snapshot)
})
