'use strict'

// Unit tests for Task 14 file downloading: a fake TDLib client (only
// `invoke`, matching `FileDownloadClient`) drives `downloadTdlibFile`
// directly - same pattern as tests/tdlib/messageSend.test.js.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { downloadTdlibFile } = require(
  path.join(__dirname, '..', '..', 'out', 'main', 'tdlib', 'fileDownload.js'),
)
const { TdlibServiceError } = require(
  path.join(__dirname, '..', '..', 'out', 'main', 'tdlib', 'types.js'),
)

function completedFile(overrides = {}) {
  return {
    _: 'file',
    id: 55,
    size: 4096,
    expected_size: 4096,
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
    remote: {
      _: 'remoteFile',
      id: 'r1',
      unique_id: 'u1',
      is_uploading_active: false,
      is_uploading_completed: true,
      uploaded_size: 4096,
    },
    ...overrides,
  }
}

test('downloadTdlibFile sends a downloadFile request for the given file id, synchronous', async () => {
  const calls = []
  const client = {
    async invoke(request) {
      calls.push(request)
      return completedFile()
    },
  }

  await downloadTdlibFile(client, 55)

  assert.equal(calls.length, 1)
  assert.equal(calls[0]._, 'downloadFile')
  assert.equal(calls[0].file_id, 55)
  assert.equal(calls[0].synchronous, true)
})

test('downloadTdlibFile returns the local path and size once the download is complete', async () => {
  const client = {
    async invoke() {
      return completedFile({
        size: 4096,
        local: { ...completedFile().local, path: '/home/user/report.pdf' },
      })
    },
  }

  const result = await downloadTdlibFile(client, 55)

  assert.deepEqual(result, { localPath: '/home/user/report.pdf', size: 4096 })
})

test('downloadTdlibFile returns null when TDLib reports the download did not complete', async () => {
  const client = {
    async invoke() {
      return completedFile({
        local: { ...completedFile().local, is_downloading_completed: false, path: '' },
      })
    },
  }

  assert.equal(await downloadTdlibFile(client, 55, { attempts: 1 }), null)
})

test('downloadTdlibFile returns null when the local path is empty even if "completed" is somehow set', async () => {
  const client = {
    async invoke() {
      return completedFile({
        local: { ...completedFile().local, is_downloading_completed: true, path: '' },
      })
    },
  }

  assert.equal(await downloadTdlibFile(client, 55, { attempts: 1 }), null)
})

test('downloadTdlibFile retries a transient "not complete yet" result and succeeds once TDLib catches up', async () => {
  let calls = 0
  const client = {
    async invoke() {
      calls += 1
      if (calls < 3) {
        return completedFile({
          local: { ...completedFile().local, is_downloading_completed: false, path: '' },
        })
      }
      return completedFile({ local: { ...completedFile().local, path: '/home/user/photo.jpg' } })
    },
  }

  const result = await downloadTdlibFile(client, 55, { sleep: async () => {} })

  assert.deepEqual(result, { localPath: '/home/user/photo.jpg', size: 4096 })
  assert.equal(calls, 3)
})

test('downloadTdlibFile gives up and returns null after exhausting all attempts', async () => {
  let calls = 0
  const client = {
    async invoke() {
      calls += 1
      return completedFile({
        local: { ...completedFile().local, is_downloading_completed: false, path: '' },
      })
    },
  }

  const result = await downloadTdlibFile(client, 55, { attempts: 3, sleep: async () => {} })

  assert.equal(result, null)
  assert.equal(calls, 3)
})

test('downloadTdlibFile does not sleep after the final attempt', async () => {
  const sleeps = []
  const client = {
    async invoke() {
      return completedFile({
        local: { ...completedFile().local, is_downloading_completed: false, path: '' },
      })
    },
  }

  await downloadTdlibFile(client, 55, {
    attempts: 2,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  })

  assert.equal(sleeps.length, 1)
})

test('downloadTdlibFile wraps a TDLib invoke failure as a TdlibServiceError, never thrown raw', async () => {
  const client = {
    async invoke() {
      throw new Error('file not found')
    },
  }

  await assert.rejects(
    () => downloadTdlibFile(client, 55),
    (err) => err instanceof TdlibServiceError && err.kind === 'client',
  )
})
