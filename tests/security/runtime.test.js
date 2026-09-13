'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawn } = require('node:child_process')

const START_MARK = 'SECURITY_TEST_RESULT_START'
const END_MARK = 'SECURITY_TEST_RESULT_END'

function runSecurityHarness() {
  return new Promise((resolve, reject) => {
    const electronPath = require('electron')
    const harnessPath = path.join(__dirname, '..', 'fixtures', 'security-harness.js')

    const childEnv = { ...process.env, VITE_DEV_SERVER_URL: '' }
    // Some host environments (e.g. the Node/Electron-based tooling this
    // suite is run under) set this to force any electron binary to run as
    // plain Node. The harness needs the real Electron app runtime.
    delete childEnv.ELECTRON_RUN_AS_NODE

    const child = spawn(electronPath, [harnessPath], {
      cwd: path.join(__dirname, '..', '..'),
      env: childEnv,
    })

    let stdout = ''
    let stderr = ''

    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Security harness timed out.\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    }, 20000)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    child.on('close', () => {
      clearTimeout(timer)
      const start = stdout.indexOf(START_MARK)
      const end = stdout.indexOf(END_MARK)
      if (start === -1 || end === -1) {
        reject(
          new Error(`Security harness produced no result.\nstdout:\n${stdout}\nstderr:\n${stderr}`),
        )
        return
      }
      const jsonText = stdout.slice(start + START_MARK.length, end).trim()
      try {
        const parsed = JSON.parse(jsonText)
        if (parsed.error) {
          reject(new Error(`Security harness reported an error: ${parsed.error}`))
          return
        }
        resolve(parsed)
      } catch (err) {
        reject(new Error(`Failed to parse security harness result: ${err.message}\n${jsonText}`))
      }
    })
  })
}

let result

test.before(async () => {
  result = await runSecurityHarness()
})

test('renderer has no direct Node.js access', () => {
  assert.equal(result.nodeIsolation.hasRequire, false)
  assert.equal(result.nodeIsolation.hasProcess, false)
  assert.equal(result.nodeIsolation.hasIpcRenderer, false)
})

test('renderer exposes only the whitelisted electronAPI', () => {
  assert.equal(result.nodeIsolation.hasElectronAPI, true)
  assert.deepEqual(result.nodeIsolation.electronAPIKeys, ['getAppInfo'])
})

test('whitelisted IPC call succeeds and returns app info', () => {
  assert.equal(result.appInfoError, null)
  assert.equal(typeof result.appInfo.name, 'string')
  assert.equal(typeof result.appInfo.version, 'string')
})

test('CSP blocks external network requests from the renderer', () => {
  assert.ok(
    result.fetchOutcome.startsWith('blocked:') || result.fetchOutcome.startsWith('threw:'),
    `expected the external fetch to be blocked by CSP, got: ${result.fetchOutcome}`,
  )
})

test('CSP blocks dynamically injected inline scripts', () => {
  assert.equal(result.inlineScriptBlocked, true)
})

test('unexpected external navigation is blocked', () => {
  assert.equal(result.navigationBlocked, true)
})

test('arbitrary new windows opened from the renderer are blocked', () => {
  assert.equal(result.newWindowBlocked, true)
})
