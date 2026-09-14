'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { createEventBroadcaster } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'ipc', 'eventBroadcaster.js'),
)
const { IPC_CHANNELS } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'shared', 'ipc', 'channels.js'),
)

function createFakeWindow({ destroyed = false } = {}) {
  const sent = []
  return {
    isDestroyed: () => destroyed,
    webContents: {
      send: (channel, payload) => sent.push({ channel, payload }),
    },
    sent,
  }
}

test('authStateChanged sends on the auth-state-changed channel to every live window', () => {
  const windowA = createFakeWindow()
  const windowB = createFakeWindow()
  const broadcaster = createEventBroadcaster(() => [windowA, windowB])

  broadcaster.authStateChanged({ status: 'ready' })

  assert.deepEqual(windowA.sent, [
    { channel: IPC_CHANNELS.eventsAuthStateChanged, payload: { status: 'ready' } },
  ])
  assert.deepEqual(windowB.sent, [
    { channel: IPC_CHANNELS.eventsAuthStateChanged, payload: { status: 'ready' } },
  ])
})

test('destroyed windows are skipped', () => {
  const alive = createFakeWindow()
  const destroyed = createFakeWindow({ destroyed: true })
  const broadcaster = createEventBroadcaster(() => [alive, destroyed])

  broadcaster.authStateChanged({ status: 'ready' })

  assert.equal(alive.sent.length, 1)
  assert.equal(destroyed.sent.length, 0)
})

test('each event method sends on its own dedicated channel', () => {
  const window = createFakeWindow()
  const broadcaster = createEventBroadcaster(() => [window])

  broadcaster.newMessage({ id: 1 })
  broadcaster.messageDeleted({ chatId: 1, messageId: 1, deletedAt: 0 })
  broadcaster.networkStateChanged({ status: 'ready' })

  assert.deepEqual(
    window.sent.map((s) => s.channel),
    [
      IPC_CHANNELS.eventsNewMessage,
      IPC_CHANNELS.eventsMessageDeleted,
      IPC_CHANNELS.eventsNetworkStateChanged,
    ],
  )
})

test('messageSendFailed sends only { chatId, messageId } on the message-send-failed channel - never a TDLib error', () => {
  const window = createFakeWindow()
  const broadcaster = createEventBroadcaster(() => [window])

  broadcaster.messageSendFailed({ chatId: 10, messageId: -1 })

  assert.deepEqual(window.sent, [
    { channel: IPC_CHANNELS.eventsMessageSendFailed, payload: { chatId: 10, messageId: -1 } },
  ])
  assert.deepEqual(Object.keys(window.sent[0].payload).sort(), ['chatId', 'messageId'])
})

test('authInputRejected sends only { step } on the auth-input-rejected channel', () => {
  const window = createFakeWindow()
  const broadcaster = createEventBroadcaster(() => [window])

  broadcaster.authInputRejected({ step: 'code' })

  assert.deepEqual(window.sent, [
    { channel: IPC_CHANNELS.eventsAuthInputRejected, payload: { step: 'code' } },
  ])
})

test('authFlowTerminated sends on the auth-flow-terminated channel to every live window', () => {
  const windowA = createFakeWindow()
  const windowB = createFakeWindow()
  const broadcaster = createEventBroadcaster(() => [windowA, windowB])

  broadcaster.authFlowTerminated()

  assert.equal(windowA.sent[0].channel, IPC_CHANNELS.eventsAuthFlowTerminated)
  assert.equal(windowB.sent[0].channel, IPC_CHANNELS.eventsAuthFlowTerminated)
})
