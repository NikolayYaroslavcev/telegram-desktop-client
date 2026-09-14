'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..', '..')

function readSource(...segments) {
  return fs.readFileSync(path.join(ROOT, ...segments), 'utf8')
}

function listFilesRecursively(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? listFilesRecursively(full) : [full]
  })
}

// Matches an actual import/require of main/tdlib, not an unrelated doc
// comment that happens to mention the path (e.g. "see src/main/tdlib/...").
const IMPORTS_MAIN_TDLIB =
  /from\s+['"][^'"]*main\/tdlib[^'"]*['"]|require\(['"][^'"]*main\/tdlib[^'"]*['"]\)/

test('src/shared and src/preload never import TDLib or main/tdlib', () => {
  const files = [
    ...listFilesRecursively(path.join(ROOT, 'src', 'shared')),
    ...listFilesRecursively(path.join(ROOT, 'src', 'preload')),
  ].filter((f) => f.endsWith('.ts'))

  assert.ok(files.length > 0)
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    assert.ok(
      !/from ['"](tdl|tdlib-types)['"]/.test(source),
      `${file} must not import a TDLib package`,
    )
    assert.ok(!IMPORTS_MAIN_TDLIB.test(source), `${file} must not import from src/main/tdlib`)
  }
})

test('src/renderer never imports TDLib or main/tdlib', () => {
  const files = listFilesRecursively(path.join(ROOT, 'src', 'renderer')).filter(
    (f) => f.endsWith('.ts') || f.endsWith('.tsx'),
  )

  assert.ok(files.length > 0)
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    assert.ok(
      !/from ['"](tdl|tdlib-types)['"]/.test(source),
      `${file} must not import a TDLib package`,
    )
    assert.ok(!IMPORTS_MAIN_TDLIB.test(source), `${file} must not import from src/main/tdlib`)
  }
})

test('preload never touches ipcRenderer as a passthrough (no generic send/invoke/on exposed)', () => {
  const source = readSource('src', 'preload', 'index.ts')
  assert.ok(
    !/electronAPI[^=]*=\s*ipcRenderer(?!\.)/.test(source),
    'ipcRenderer itself must not be assigned to the exposed API',
  )
  assert.ok(!/exposeInMainWorld\(['"]ipcRenderer['"]/.test(source))
})

test('the typed contract declares onMessageSendFailed backed by a dedicated, minimal event type', () => {
  const contractSource = readSource('src', 'shared', 'ipc', 'contract.ts')
  assert.match(
    contractSource,
    /onMessageSendFailed\(cb: \(event: MessageSendFailedEvent\) => void\): Unsubscribe/,
  )

  const eventsSource = readSource('src', 'shared', 'ipc', 'events.ts')
  const match = eventsSource.match(/export interface MessageSendFailedEvent \{([^}]*)\}/)
  assert.ok(match, 'expected MessageSendFailedEvent to be declared in events.ts')
  const fields = match[1]
  assert.match(fields, /chatId: number/)
  assert.match(fields, /messageId: number/)
  // Only the two identity fields - no TDLib error code/message/text ever
  // crosses this boundary (see docs/tdlib-integration.md, "Failed sends").
  assert.ok(
    !/error|message:|text/i.test(fields),
    `MessageSendFailedEvent must not carry raw error/text fields: ${fields}`,
  )
})

test('the IPC contract reuses shared domain models instead of redeclaring them', () => {
  const source = readSource('src', 'shared', 'ipc', 'contract.ts')
  assert.match(source, /import type \{[^}]*\} from ['"]\.\.\/models['"]/)
  for (const modelName of ['Chat', 'Message', 'AuthorizationState']) {
    assert.ok(
      !new RegExp(`interface ${modelName}\\b`).test(source),
      `contract.ts must import ${modelName} instead of redeclaring it`,
    )
  }
})

test('no shared/ipc file redeclares User or Attachment either', () => {
  const files = listFilesRecursively(path.join(ROOT, 'src', 'shared', 'ipc')).filter((f) =>
    f.endsWith('.ts'),
  )
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    for (const modelName of ['User', 'Attachment']) {
      assert.ok(
        !new RegExp(`^export interface ${modelName}\\b`, 'm').test(source),
        `${file} must not redeclare ${modelName}`,
      )
    }
  }
})
