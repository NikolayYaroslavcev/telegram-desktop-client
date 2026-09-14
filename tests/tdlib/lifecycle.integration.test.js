'use strict'

// Real integration test: loads the real native tdjson library and creates a
// real TDLib client (no mocking of tdl/prebuilt-tdlib - per this task's own
// instruction not to mock TDLib away entirely). Uses a throwaway temporary
// runtime directory and placeholder API credentials (the same approach
// spike/run-node.ts uses) so it never touches the spike's or production's
// TDLib database/session, and needs no real Telegram credentials to run in
// CI. Placeholder credentials are enough to observe real
// authorizationState transitions up to authorizationStateWaitPhoneNumber -
// TDLib only rejects them once an actual network auth request is made.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { TdlibLifecycleService } = require(
  path.join(__dirname, '..', '..', 'out', 'main', 'tdlib', 'lifecycle.js'),
)
const { resolveTdlibRuntimeDirectories } = require(
  path.join(__dirname, '..', '..', 'out', 'main', 'tdlib', 'config.js'),
)

function makeTempConfig() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'tdc-tdlib-test-'))
  const { databaseDirectory, filesDirectory } = resolveTdlibRuntimeDirectories(userDataPath)
  return {
    userDataPath,
    config: {
      apiId: 1,
      apiHash: 'test-placeholder-hash',
      databaseDirectory,
      filesDirectory,
      systemLanguageCode: 'en',
      deviceModel: 'Desktop',
      systemVersion: `${os.type()} ${os.release()}`,
      applicationVersion: 'test',
    },
  }
}

function waitForStatus(service, target, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (service.getAuthorizationState() === target) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      unsubscribe()
      reject(
        new Error(`timed out after ${timeoutMs}ms waiting for authorization state "${target}"`),
      )
    }, timeoutMs)
    const unsubscribe = service.onUpdate((event) => {
      if (event.kind === 'authorizationState' && event.status === target) {
        clearTimeout(timer)
        unsubscribe()
        resolve()
      }
    })
  })
}

test('TDLib lifecycle: native load, client creation, real authorization states, clean shutdown', async (t) => {
  const { userDataPath, config } = makeTempConfig()
  const service = new TdlibLifecycleService(config)

  t.after(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  })

  await service.start()
  await waitForStatus(service, 'waitPhoneNumber', 20000)
  assert.equal(service.getAuthorizationState(), 'waitPhoneNumber')

  await service.stop()
  // Idempotent: a second stop() must not throw or hang.
  await service.stop()
})

test('TDLib lifecycle: start() is not idempotent (rejects when already running)', async (t) => {
  const { userDataPath, config } = makeTempConfig()
  const service = new TdlibLifecycleService(config)

  t.after(async () => {
    await service.stop()
    fs.rmSync(userDataPath, { recursive: true, force: true })
  })

  await service.start()
  await assert.rejects(
    () => service.start(),
    (err) => err.kind === 'initialization',
  )
})

test('TDLib lifecycle: setPhoneNumber rejects when TDLib is not waiting for a phone number', async (t) => {
  const { userDataPath, config } = makeTempConfig()
  const service = new TdlibLifecycleService(config)

  t.after(async () => {
    await service.stop()
    fs.rmSync(userDataPath, { recursive: true, force: true })
  })

  // Before start(), nothing is pending yet - must fail loudly, not hang.
  await assert.rejects(
    () => service.setPhoneNumber('+10000000000'),
    (err) => err.kind === 'authorization',
  )
})
