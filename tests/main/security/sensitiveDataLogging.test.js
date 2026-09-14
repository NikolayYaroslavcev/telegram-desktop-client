'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { createFakeIpcMain } = require('../ipc/fixtures/fakeIpcMain')
const { registerAuthHandlers } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'ipc', 'authHandlers.js'),
)
const { registerMessagesHandlers } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'ipc', 'messagesHandlers.js'),
)
const { IPC_CHANNELS } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'shared', 'ipc', 'channels.js'),
)
const { TdlibServiceError } = require(
  path.join(__dirname, '..', '..', '..', 'out', 'main', 'tdlib', 'types.js'),
)

/**
 * Task 18: phone numbers, OTP codes, 2FA passwords, and message text must
 * never reach `console.*` - these tests spy on every console method for the
 * duration of one IPC call and assert the submitted secret/content string
 * (chosen to be distinctive enough that a coincidental match is implausible)
 * never appears in any logged line.
 */
function withAllConsoleSpies(fn) {
  const methods = ['log', 'warn', 'error']
  const originals = {}
  const lines = []
  for (const method of methods) {
    originals[method] = console[method]
    console[method] = (...args) => lines.push(args.map(String).join(' '))
  }
  return fn()
    .finally(() => {
      for (const method of methods) console[method] = originals[method]
    })
    .then(() => lines)
}

test('auth.checkCode(): a failing checkCode never logs the submitted OTP code', async () => {
  const ipcMain = createFakeIpcMain()
  const secretOtp = '7391-DISTINCTIVE-OTP'
  const service = {
    getAuthorizationState: () => 'waitCode',
    async checkCode() {
      // Mirrors the real out-of-sync error, which never echoes the submitted value.
      throw new TdlibServiceError('authorization', 'TDLib is not currently waiting for code')
    },
  }
  registerAuthHandlers(ipcMain, () => service)

  const lines = await withAllConsoleSpies(() =>
    ipcMain.invoke(IPC_CHANNELS.authCheckCode, secretOtp).catch(() => {}),
  )

  for (const line of lines) assert.ok(!line.includes(secretOtp))
})

test('auth.checkPassword(): a failing checkPassword never logs the submitted 2FA password', async () => {
  const ipcMain = createFakeIpcMain()
  const secretPassword = 'hunter2-DISTINCTIVE-PASSWORD'
  const service = {
    getAuthorizationState: () => 'waitPassword',
    async checkPassword() {
      throw new TdlibServiceError('authorization', 'TDLib is not currently waiting for password')
    },
  }
  registerAuthHandlers(ipcMain, () => service)

  const lines = await withAllConsoleSpies(() =>
    ipcMain.invoke(IPC_CHANNELS.authCheckPassword, secretPassword).catch(() => {}),
  )

  for (const line of lines) assert.ok(!line.includes(secretPassword))
})

test('auth.setPhoneNumber(): a failing setPhoneNumber never logs the submitted phone number', async () => {
  const ipcMain = createFakeIpcMain()
  const secretPhone = '+15551234567'
  const service = {
    getAuthorizationState: () => 'waitPhoneNumber',
    async setPhoneNumber() {
      throw new TdlibServiceError('authorization', 'TDLib is not currently waiting for phone')
    },
  }
  registerAuthHandlers(ipcMain, () => service)

  const lines = await withAllConsoleSpies(() =>
    ipcMain.invoke(IPC_CHANNELS.authSetPhoneNumber, secretPhone).catch(() => {}),
  )

  for (const line of lines) assert.ok(!line.includes(secretPhone))
})

test('messages.sendText(): a failing sendText never logs the message text', async () => {
  const ipcMain = createFakeIpcMain()
  const distinctiveText = 'this is a very distinctive private message body 42x9q'
  const service = {
    async getChat(chatId) {
      return { id: chatId, peerUserId: 1, title: 'Chat' }
    },
    async sendText() {
      throw new TdlibServiceError('client', 'Failed to send the message via TDLib')
    },
  }
  const repository = { findByIds: () => [] }
  registerMessagesHandlers(
    ipcMain,
    () => service,
    () => repository,
  )

  const lines = await withAllConsoleSpies(() =>
    ipcMain.invoke(IPC_CHANNELS.messagesSendText, 10, distinctiveText).catch(() => {}),
  )

  for (const line of lines) assert.ok(!line.includes(distinctiveText))
})
