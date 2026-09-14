'use strict'

// Unit tests for `TdlibLifecycleService.sendAttachment()`/`downloadFile()`
// (Task 14): same fake-client injection pattern as lifecycle.send.test.js.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { TdlibLifecycleService } = require(
  path.join(__dirname, '..', '..', 'out', 'main', 'tdlib', 'lifecycle.js'),
)

const FAKE_CONFIG = {
  apiId: 1,
  apiHash: 'test-placeholder-hash',
  databaseDirectory: '/tmp/unused-db',
  filesDirectory: '/tmp/unused-files',
  systemLanguageCode: 'en',
  deviceModel: 'Desktop',
  systemVersion: 'test',
  applicationVersion: 'test',
}

function createFakeClient(invoke) {
  return {
    on() {},
    login() {
      return new Promise(() => {})
    },
    async close() {},
    invoke,
  }
}

test('sendAttachment() rejects when the TDLib client has not started yet', async () => {
  const client = createFakeClient(async () => {
    throw new Error('should not be called before start()')
  })
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await assert.rejects(
    () => service.sendAttachment(1, 'photo', '/tmp/x.png'),
    (err) => err.kind === 'client',
  )
})

test('sendAttachment() delegates to the running client once start() has created it', async () => {
  const calls = []
  const client = createFakeClient(async (request) => {
    if (request._ === 'sendMessage') {
      calls.push(request)
      return { _: 'message', id: 1, chat_id: request.chat_id }
    }
    throw new Error(`unexpected invoke: ${request._}`)
  })
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await service.start()
  await service.sendAttachment(10, 'document', '/tmp/report.pdf', 42)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].chat_id, 10)
  assert.equal(calls[0].input_message_content._, 'inputMessageDocument')
  assert.deepEqual(calls[0].reply_to, { _: 'inputMessageReplyToMessage', message_id: 42 })
})

test('downloadFile() rejects when the TDLib client has not started yet', async () => {
  const client = createFakeClient(async () => {
    throw new Error('should not be called before start()')
  })
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await assert.rejects(
    () => service.downloadFile(55),
    (err) => err.kind === 'client',
  )
})

test('downloadFile() delegates to the running client and returns the downloaded file info', async () => {
  const client = createFakeClient(async (request) => {
    if (request._ === 'downloadFile') {
      assert.equal(request.file_id, 55)
      return {
        _: 'file',
        id: 55,
        size: 2048,
        expected_size: 2048,
        local: {
          _: 'localFile',
          path: '/home/user/photo.jpg',
          can_be_downloaded: true,
          can_be_deleted: true,
          is_downloading_active: false,
          is_downloading_completed: true,
          download_offset: 0,
          downloaded_prefix_size: 2048,
          downloaded_size: 2048,
        },
        remote: {
          _: 'remoteFile',
          id: 'r',
          unique_id: 'u',
          is_uploading_active: false,
          is_uploading_completed: true,
          uploaded_size: 2048,
        },
      }
    }
    throw new Error(`unexpected invoke: ${request._}`)
  })
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await service.start()
  const result = await service.downloadFile(55)

  assert.deepEqual(result, { localPath: '/home/user/photo.jpg', size: 2048 })
})

// --- refreshAttachmentFileId (Task 20 fix) ---

function tdPhotoMessage(id, fileId) {
  return {
    _: 'message',
    id,
    chat_id: 10,
    content: {
      _: 'messagePhoto',
      photo: {
        _: 'photo',
        sizes: [
          {
            _: 'photoSize',
            type: 'x',
            width: 100,
            height: 100,
            photo: { _: 'file', id: fileId, size: 1024, local: { path: '', is_downloading_completed: false } },
          },
        ],
      },
      caption: { _: 'formattedText', text: '', entities: [] },
    },
  }
}

test('refreshAttachmentFileId() rejects when the TDLib client has not started yet', async () => {
  const client = createFakeClient(async () => {
    throw new Error('should not be called before start()')
  })
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await assert.rejects(
    () => service.refreshAttachmentFileId(10, 5),
    (err) => err.kind === 'client',
  )
})

test('refreshAttachmentFileId() returns the current fileId re-resolved from TDLib', async () => {
  const client = createFakeClient(async (request) => {
    if (request._ === 'getMessage') {
      assert.equal(request.chat_id, 10)
      assert.equal(request.message_id, 5)
      return tdPhotoMessage(5, 999)
    }
    throw new Error(`unexpected invoke: ${request._}`)
  })
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await service.start()
  const fileId = await service.refreshAttachmentFileId(10, 5)

  assert.equal(fileId, 999)
})

test('refreshAttachmentFileId() returns null when TDLib can no longer resolve the message', async () => {
  const client = createFakeClient(async (request) => {
    if (request._ === 'getMessage') throw new Error('MESSAGE_NOT_FOUND')
    throw new Error(`unexpected invoke: ${request._}`)
  })
  const service = new TdlibLifecycleService(FAKE_CONFIG, () => client)

  await service.start()
  assert.equal(await service.refreshAttachmentFileId(10, 5), null)
})
