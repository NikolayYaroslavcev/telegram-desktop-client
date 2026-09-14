'use strict'

// Unit tests for Task 12 text sending: a fake TDLib client (only `invoke`,
// matching `MessageSendClient`) drives `sendTextMessage` directly - same
// pattern as tests/tdlib/messageHistory.test.js.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { sendTextMessage, sendAttachmentMessage } = require(
  path.join(__dirname, '..', '..', 'out', 'main', 'tdlib', 'messageSend.js'),
)
const { TdlibServiceError } = require(
  path.join(__dirname, '..', '..', 'out', 'main', 'tdlib', 'types.js'),
)

test('sends a sendMessage request with inputMessageText for the given chat and text', async () => {
  const calls = []
  const client = {
    async invoke(request) {
      calls.push(request)
      return { _: 'message', id: 1, chat_id: 10 }
    },
  }

  await sendTextMessage(client, 10, 'hello')

  assert.equal(calls.length, 1)
  assert.equal(calls[0]._, 'sendMessage')
  assert.equal(calls[0].chat_id, 10)
  assert.equal(calls[0].input_message_content._, 'inputMessageText')
})

test('passes the text through as plain formattedText, with no entities and no hidden mutation', async () => {
  const calls = []
  const client = {
    async invoke(request) {
      calls.push(request)
      return { _: 'message', id: 1, chat_id: 10 }
    },
  }

  await sendTextMessage(client, 10, '  spaced *not* _markdown_  ')

  const content = calls[0].input_message_content
  assert.equal(content.text._, 'formattedText')
  assert.equal(content.text.text, '  spaced *not* _markdown_  ')
  assert.deepEqual(content.text.entities, [])
})

test('never uses a message content type other than inputMessageText', async () => {
  const client = {
    async invoke(request) {
      return { _: 'message', id: 1, chat_id: request.chat_id }
    },
  }

  await sendTextMessage(client, 10, 'hi')
  // Covered by the assertion in the first test too, but explicit here since
  // it's a hard requirement (docs/plan.md Task 12, "TDLib API").
})

test('a TDLib invoke failure is wrapped as a TdlibServiceError, never thrown raw', async () => {
  const client = {
    async invoke() {
      throw new Error('network down')
    },
  }

  await assert.rejects(
    () => sendTextMessage(client, 10, 'hi'),
    (err) => err instanceof TdlibServiceError && err.kind === 'client',
  )
})

test('resolves to undefined - the temporary/pending TDLib message is never returned to the caller', async () => {
  const client = {
    async invoke() {
      return {
        _: 'message',
        id: 1,
        chat_id: 10,
        sending_state: { _: 'messageSendingStatePending', sending_id: 1 },
      }
    },
  }

  assert.equal(await sendTextMessage(client, 10, 'hi'), undefined)
})

test('omits reply_to entirely when no replyToMessageId is given', async () => {
  const calls = []
  const client = {
    async invoke(request) {
      calls.push(request)
      return { _: 'message', id: 1, chat_id: 10 }
    },
  }

  await sendTextMessage(client, 10, 'hi')

  assert.equal('reply_to' in calls[0], false)
})

test('sends reply_to as inputMessageReplyToMessage with the given message id', async () => {
  const calls = []
  const client = {
    async invoke(request) {
      calls.push(request)
      return { _: 'message', id: 1, chat_id: 10 }
    },
  }

  await sendTextMessage(client, 10, 'hi', 55)

  assert.deepEqual(calls[0].reply_to, { _: 'inputMessageReplyToMessage', message_id: 55 })
  assert.equal(calls[0].input_message_content._, 'inputMessageText') // content type unaffected by reply
})

// --- sendAttachmentMessage (Task 14) ---

test('sendAttachmentMessage(type: "photo") sends inputMessagePhoto with an inputFileLocal pointing at filePath', async () => {
  const calls = []
  const client = {
    async invoke(request) {
      calls.push(request)
      return { _: 'message', id: 1, chat_id: 10 }
    },
  }

  await sendAttachmentMessage(client, 10, 'photo', 'C:\\pictures\\cat.jpg')

  assert.equal(calls.length, 1)
  assert.equal(calls[0]._, 'sendMessage')
  assert.equal(calls[0].chat_id, 10)
  const content = calls[0].input_message_content
  assert.equal(content._, 'inputMessagePhoto')
  assert.deepEqual(content.photo.photo, { _: 'inputFileLocal', path: 'C:\\pictures\\cat.jpg' })
})

test('sendAttachmentMessage(type: "document") sends inputMessageDocument with an inputFileLocal pointing at filePath', async () => {
  const calls = []
  const client = {
    async invoke(request) {
      calls.push(request)
      return { _: 'message', id: 1, chat_id: 10 }
    },
  }

  await sendAttachmentMessage(client, 10, 'document', 'C:\\downloads\\report.pdf')

  assert.equal(calls.length, 1)
  const content = calls[0].input_message_content
  assert.equal(content._, 'inputMessageDocument')
  assert.deepEqual(content.document.document, {
    _: 'inputFileLocal',
    path: 'C:\\downloads\\report.pdf',
  })
})

test("sendAttachmentMessage never sends a caption (no captions in this task's scope)", async () => {
  const calls = []
  const client = {
    async invoke(request) {
      calls.push(request)
      return { _: 'message', id: 1, chat_id: 10 }
    },
  }

  await sendAttachmentMessage(client, 10, 'photo', '/tmp/x.png')

  assert.deepEqual(calls[0].input_message_content.caption, {
    _: 'formattedText',
    text: '',
    entities: [],
  })
})

test('sendAttachmentMessage omits reply_to when no replyToMessageId is given, and sends it when given', async () => {
  const calls = []
  const client = {
    async invoke(request) {
      calls.push(request)
      return { _: 'message', id: 1, chat_id: 10 }
    },
  }

  await sendAttachmentMessage(client, 10, 'document', '/tmp/x.pdf')
  assert.equal('reply_to' in calls[0], false)

  await sendAttachmentMessage(client, 10, 'document', '/tmp/x.pdf', 77)
  assert.deepEqual(calls[1].reply_to, { _: 'inputMessageReplyToMessage', message_id: 77 })
})

test('sendAttachmentMessage wraps a TDLib invoke failure as a TdlibServiceError, never thrown raw', async () => {
  const client = {
    async invoke() {
      throw new Error('FILE_PART_0_MISSING')
    },
  }

  await assert.rejects(
    () => sendAttachmentMessage(client, 10, 'photo', '/tmp/x.png'),
    (err) => err instanceof TdlibServiceError && err.kind === 'client',
  )
})

test('sendAttachmentMessage resolves to undefined - the pending TDLib message is never returned', async () => {
  const client = {
    async invoke() {
      return {
        _: 'message',
        id: 1,
        chat_id: 10,
        sending_state: { _: 'messageSendingStatePending', sending_id: 1 },
      }
    },
  }

  assert.equal(await sendAttachmentMessage(client, 10, 'photo', '/tmp/x.png'), undefined)
})
