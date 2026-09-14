'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { rewriteAsarPath } = require(
  path.join(__dirname, '..', '..', 'out', 'main', 'tdlib', 'nativeLoader.js'),
)

test('rewriteAsarPath rewrites an in-archive app.asar path to app.asar.unpacked', () => {
  const inArchive = path.join(
    'C:',
    'Program Files',
    'app',
    'resources',
    'app.asar',
    'node_modules',
    '@prebuilt-tdlib',
    'win32-x64',
    'tdjson.dll',
  )
  const expected = path.join(
    'C:',
    'Program Files',
    'app',
    'resources',
    'app.asar.unpacked',
    'node_modules',
    '@prebuilt-tdlib',
    'win32-x64',
    'tdjson.dll',
  )

  assert.equal(rewriteAsarPath(inArchive), expected)
})

test('rewriteAsarPath is a no-op for a dev (non-asar) path', () => {
  const devPath = path.join(
    'D:',
    'project',
    'node_modules',
    '@prebuilt-tdlib',
    'win32-x64',
    'tdjson.dll',
  )
  assert.equal(rewriteAsarPath(devPath), devPath)
})

test('rewriteAsarPath is a no-op when the path is already unpacked', () => {
  const alreadyUnpacked = path.join(
    'C:',
    'app',
    'resources',
    'app.asar.unpacked',
    'node_modules',
    '@prebuilt-tdlib',
    'win32-x64',
    'tdjson.dll',
  )
  assert.equal(rewriteAsarPath(alreadyUnpacked), alreadyUnpacked)
})

test('resolveTdjsonPath resolves to a real file on disk in dev', () => {
  const fs = require('node:fs')
  const { resolveTdjsonPath } = require(
    path.join(__dirname, '..', '..', 'out', 'main', 'tdlib', 'nativeLoader.js'),
  )
  const resolved = resolveTdjsonPath()
  assert.ok(fs.existsSync(resolved), `expected tdjson library to exist at ${resolved}`)
})
