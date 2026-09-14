'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { AttachmentSelectionRegistry, buildAttachmentDialogOptions, selectAttachmentFile } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'attachments', 'fileSelection.js'),
)
const { FilesystemError } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'attachments', 'filesystemError.js'),
)

// --- buildAttachmentDialogOptions ---

test('buildAttachmentDialogOptions filters to image extensions for type "photo"', () => {
  const options = buildAttachmentDialogOptions('photo')
  assert.deepEqual(options.properties, ['openFile'])
  assert.ok(Array.isArray(options.filters) && options.filters.length === 1)
  assert.ok(options.filters[0].extensions.includes('png'))
  assert.ok(options.filters[0].extensions.includes('jpg'))
})

test('buildAttachmentDialogOptions has no filter for type "document" (any file)', () => {
  const options = buildAttachmentDialogOptions('document')
  assert.deepEqual(options.properties, ['openFile'])
  assert.equal('filters' in options, false)
})

// --- AttachmentSelectionRegistry ---

test('AttachmentSelectionRegistry.consume returns the registered type once, then forgets it', () => {
  const registry = new AttachmentSelectionRegistry()
  registry.allow('/tmp/a.png', 'photo')

  assert.equal(registry.consume('/tmp/a.png'), 'photo')
  assert.equal(registry.consume('/tmp/a.png'), undefined) // single-use
})

test('AttachmentSelectionRegistry.consume returns undefined for a path that was never allowed', () => {
  const registry = new AttachmentSelectionRegistry()
  assert.equal(registry.consume('/tmp/never-selected.png'), undefined)
})

// --- selectAttachmentFile ---

test('selectAttachmentFile returns null when the dialog is cancelled, and registers nothing', async () => {
  const registry = new AttachmentSelectionRegistry()
  const openDialog = async () => ({ canceled: true, filePaths: [] })
  const statFile = async () => {
    throw new Error('must not be called when cancelled')
  }

  const result = await selectAttachmentFile(openDialog, statFile, registry, null, 'photo')

  assert.equal(result, null)
})

test('selectAttachmentFile returns the picked file descriptor and registers it in the registry with its type', async () => {
  const registry = new AttachmentSelectionRegistry()
  const openDialog = async (_window, options) => {
    assert.deepEqual(options.properties, ['openFile'])
    return { canceled: false, filePaths: ['C:\\pictures\\cat.jpg'] }
  }
  const statFile = async (filePath) => {
    assert.equal(filePath, 'C:\\pictures\\cat.jpg')
    return { size: 12345 }
  }

  const result = await selectAttachmentFile(openDialog, statFile, registry, null, 'photo')

  assert.deepEqual(result, { filePath: 'C:\\pictures\\cat.jpg', fileName: 'cat.jpg', size: 12345 })
  assert.equal(registry.consume('C:\\pictures\\cat.jpg'), 'photo')
})

test('selectAttachmentFile passes the given window through to the dialog', async () => {
  const registry = new AttachmentSelectionRegistry()
  const fakeWindow = { id: 'fake-window' }
  let seenWindow
  const openDialog = async (window) => {
    seenWindow = window
    return { canceled: true, filePaths: [] }
  }
  const statFile = async () => ({ size: 0 })

  await selectAttachmentFile(openDialog, statFile, registry, fakeWindow, 'document')

  assert.equal(seenWindow, fakeWindow)
})

// --- Task 18: a statFile failure must be typed and safe, not a raw fs error ---

test('selectAttachmentFile wraps a statFile failure as a FilesystemError, does not register the path, and never leaks the raw fs error', async () => {
  const registry = new AttachmentSelectionRegistry()
  const openDialog = async () => ({
    canceled: false,
    filePaths: ['C:\\Users\\alice\\secret\\report.pdf'],
  })
  const rawFsError = new Error(
    `EACCES: permission denied, stat 'C:\\Users\\alice\\secret\\report.pdf'`,
  )
  rawFsError.code = 'EACCES'
  const statFile = async () => {
    throw rawFsError
  }

  await assert.rejects(
    selectAttachmentFile(openDialog, statFile, registry, null, 'document'),
    (err) => {
      assert.ok(err instanceof FilesystemError)
      assert.equal(err.message, 'Failed to read the selected file')
      assert.equal(err.cause, rawFsError)
      return true
    },
  )
  assert.equal(registry.consume('C:\\Users\\alice\\secret\\report.pdf'), undefined) // never registered on failure
})
