'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { loadTdlibRuntimeConfig, resolveTdlibRuntimeDirectories } = require(
  path.join(__dirname, '..', '..', 'out', 'main', 'tdlib', 'config.js'),
)

test('resolveTdlibRuntimeDirectories nests database/files under <userData>/tdlib', () => {
  const dirs = resolveTdlibRuntimeDirectories(
    path.join('C:', 'Users', 'test', 'AppData', 'Roaming', 'app'),
  )
  assert.equal(
    dirs.databaseDirectory,
    path.join('C:', 'Users', 'test', 'AppData', 'Roaming', 'app', 'tdlib', 'database'),
  )
  assert.equal(
    dirs.filesDirectory,
    path.join('C:', 'Users', 'test', 'AppData', 'Roaming', 'app', 'tdlib', 'files'),
  )
})

test('loadTdlibRuntimeConfig throws a configuration error when TG_API_ID/TG_API_HASH are missing', () => {
  assert.throws(
    () =>
      loadTdlibRuntimeConfig({}, { userDataPath: '/tmp/user-data', applicationVersion: '0.0.0' }),
    (err) => err.kind === 'configuration',
  )
})

test('loadTdlibRuntimeConfig throws when TG_API_ID is not a valid number', () => {
  assert.throws(
    () =>
      loadTdlibRuntimeConfig(
        { TG_API_ID: 'not-a-number', TG_API_HASH: 'abc' },
        { userDataPath: '/tmp/user-data', applicationVersion: '0.0.0' },
      ),
    (err) => err.kind === 'configuration',
  )
})

test('loadTdlibRuntimeConfig throws when TG_API_HASH is empty', () => {
  assert.throws(
    () =>
      loadTdlibRuntimeConfig(
        { TG_API_ID: '12345', TG_API_HASH: '' },
        { userDataPath: '/tmp/user-data', applicationVersion: '0.0.0' },
      ),
    (err) => err.kind === 'configuration',
  )
})

test('loadTdlibRuntimeConfig builds a full config from valid env + options', () => {
  const config = loadTdlibRuntimeConfig(
    { TG_API_ID: '12345', TG_API_HASH: 'deadbeef' },
    { userDataPath: path.join('C:', 'userdata'), applicationVersion: '1.2.3' },
  )

  assert.equal(config.apiId, 12345)
  assert.equal(config.apiHash, 'deadbeef')
  assert.equal(config.databaseDirectory, path.join('C:', 'userdata', 'tdlib', 'database'))
  assert.equal(config.filesDirectory, path.join('C:', 'userdata', 'tdlib', 'files'))
  assert.equal(config.applicationVersion, '1.2.3')
  assert.equal(typeof config.systemLanguageCode, 'string')
  assert.equal(typeof config.deviceModel, 'string')
  assert.equal(typeof config.systemVersion, 'string')
})

// --- Task 18: api_hash must never appear anywhere an error/log could surface it ---

test('loadTdlibRuntimeConfig never includes the invalid/partial api_hash value in its thrown error message', () => {
  const distinctiveHash = 'super-secret-distinctive-hash-value-123'
  assert.throws(
    () =>
      loadTdlibRuntimeConfig(
        { TG_API_ID: 'not-a-number', TG_API_HASH: distinctiveHash },
        { userDataPath: path.join('C:', 'userdata'), applicationVersion: '1.0.0' },
      ),
    (err) => {
      assert.ok(!err.message.includes(distinctiveHash))
      assert.equal(err.cause, undefined) // nothing carrying the hash is attached either
      return true
    },
  )
})
