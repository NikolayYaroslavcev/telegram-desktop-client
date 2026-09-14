'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { resolveNetworkIndicator, networkIndicatorLabel } = require(
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    'out',
    'renderer-logic',
    'renderer',
    'network',
    'resolveNetworkIndicator.js',
  ),
)

test('resolveNetworkIndicator maps "ready" to "online"', () => {
  assert.equal(resolveNetworkIndicator('ready'), 'online')
})

test('resolveNetworkIndicator maps "waitingForNetwork" to "offline"', () => {
  assert.equal(resolveNetworkIndicator('waitingForNetwork'), 'offline')
})

test('resolveNetworkIndicator maps every in-progress connectionState to "connecting"', () => {
  for (const status of ['connectingToProxy', 'connecting', 'updating']) {
    assert.equal(
      resolveNetworkIndicator(status),
      'connecting',
      `status "${status}" must map to "connecting"`,
    )
  }
})

test('resolveNetworkIndicator never reports "online" for "unknown" - initial/unrecognized state must not lie', () => {
  assert.equal(resolveNetworkIndicator('unknown'), 'connecting')
})

test('resolveNetworkIndicator falls back to "connecting" (never "online") for any unrecognized future status', () => {
  assert.equal(resolveNetworkIndicator('somethingFromAFutureTdlibVersion'), 'connecting')
})

test('networkIndicatorLabel returns a distinct, non-technical label for each indicator', () => {
  const offline = networkIndicatorLabel('offline')
  const connecting = networkIndicatorLabel('connecting')
  const online = networkIndicatorLabel('online')

  assert.equal(typeof offline, 'string')
  assert.equal(typeof connecting, 'string')
  assert.equal(typeof online, 'string')
  assert.equal(new Set([offline, connecting, online]).size, 3)
  // Never leak raw TDLib vocabulary into user-facing copy.
  for (const label of [offline, connecting, online]) {
    assert.ok(!/tdlib|connectionState/i.test(label))
  }
})
