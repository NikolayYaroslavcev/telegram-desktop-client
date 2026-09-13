'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

test('main window is configured with hardened webPreferences', () => {
  const { getMainWindowWebPreferences } = require(
    path.join(__dirname, '..', '..', 'out', 'main', 'windowConfig.js'),
  )
  const preferences = getMainWindowWebPreferences()

  assert.equal(preferences.contextIsolation, true)
  assert.equal(preferences.nodeIntegration, false)
  assert.equal(preferences.sandbox, true)
  assert.ok(typeof preferences.preload === 'string' && preferences.preload.length > 0)
})
