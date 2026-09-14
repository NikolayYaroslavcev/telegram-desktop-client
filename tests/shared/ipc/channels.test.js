'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { IPC_CHANNELS } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'shared', 'ipc', 'channels.js'),
)

const REQUIRED_KEYS = [
  'appGetAppInfo',
  'authGetState',
  'authSetPhoneNumber',
  'authCheckCode',
  'authCheckPassword',
  'chatsList',
  'chatsOpen',
  'networkGetState',
  'messagesGetHistory',
  'messagesSendText',
  'messagesSendAttachment',
  'eventsAuthStateChanged',
  'eventsAuthInputRejected',
  'eventsAuthFlowTerminated',
  'eventsNewMessage',
  'eventsMessageDeleted',
  'eventsMessageSendFailed',
  'eventsNetworkStateChanged',
]

test('IPC_CHANNELS defines every contract method and event exactly once', () => {
  for (const key of REQUIRED_KEYS) {
    assert.equal(typeof IPC_CHANNELS[key], 'string', `expected IPC_CHANNELS.${key} to be a string`)
    assert.ok(IPC_CHANNELS[key].length > 0)
  }
})

test('IPC_CHANNELS has no duplicate channel names', () => {
  const values = Object.values(IPC_CHANNELS)
  assert.equal(new Set(values).size, values.length)
})

test('IPC_CHANNELS has no generic invoke/send/execute/tdlib-style channel', () => {
  // Checks the channel's action segment (after the namespace ":") against
  // exact generic-passthrough verbs - a legitimate action like
  // "messages:send-text" must not be flagged just for containing "send".
  const forbiddenExact = ['invoke', 'send', 'on', 'execute', 'request', 'tdlib']
  for (const value of Object.values(IPC_CHANNELS)) {
    const [, action] = value.split(':')
    assert.ok(
      !forbiddenExact.includes(action),
      `channel "${value}" looks like a generic passthrough`,
    )
    assert.ok(!value.toLowerCase().includes('tdlib'), `channel "${value}" must not mention tdlib`)
  }
})
