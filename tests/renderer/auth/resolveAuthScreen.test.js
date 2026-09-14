'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { resolveAuthScreen, loadingMessageFor } = require(
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    'out',
    'renderer-logic',
    'renderer',
    'auth',
    'resolveAuthScreen.js',
  ),
)

test('resolveAuthScreen maps each supported wait state to its screen', () => {
  assert.equal(resolveAuthScreen('waitPhoneNumber'), 'phone')
  assert.equal(resolveAuthScreen('waitCode'), 'code')
  assert.equal(resolveAuthScreen('waitPassword'), 'password')
  assert.equal(resolveAuthScreen('ready'), 'ready')
})

test('resolveAuthScreen falls back to the safe loading screen for every state this task does not implement', () => {
  const unhandled = [
    'waitTdlibParameters',
    'waitEncryptionKey',
    'waitEmailAddress',
    'waitEmailCode',
    'waitOtherDeviceConfirmation',
    'waitRegistration',
    'loggingOut',
    'closing',
    'closed',
    'unknown',
  ]
  for (const status of unhandled) {
    assert.equal(resolveAuthScreen(status), 'loading', `status "${status}" must map to "loading"`)
  }
})

test('loadingMessageFor distinguishes startup from shutdown states', () => {
  assert.equal(loadingMessageFor('waitTdlibParameters'), 'Подготовка...')
  assert.equal(loadingMessageFor('unknown'), 'Подготовка...')
  assert.equal(loadingMessageFor('closing'), 'Соединение...')
  assert.equal(loadingMessageFor('closed'), 'Соединение...')
  assert.equal(loadingMessageFor('loggingOut'), 'Соединение...')
})
