'use strict'

// Runs INSIDE a real Electron process. Loads the actual production main
// entry point (out/main/index.js, built from src/main/index.ts) with
// VITE_DEV_SERVER_URL unset, so the window loads the packaged renderer via
// file:// exactly as a production build would. It then drives the real
// renderer through executeJavaScript to prove runtime security behavior -
// this is not a static assertion about source code, it is what actually
// happens when the app runs.

const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const START_MARK = 'SECURITY_TEST_RESULT_START'
const END_MARK = 'SECURITY_TEST_RESULT_END'

function send(result) {
  process.stdout.write(`\n${START_MARK}\n`)
  process.stdout.write(JSON.stringify(result))
  process.stdout.write(`\n${END_MARK}\n`)
}

function fail(error) {
  send({ error: error instanceof Error ? (error.stack ?? error.message) : String(error) })
  app.exit(1)
}

async function runChecks(window) {
  const contents = window.webContents

  const nodeIsolation = await contents.executeJavaScript(`(() => ({
    hasRequire: typeof window.require !== 'undefined',
    hasProcess: typeof process !== 'undefined',
    hasIpcRenderer: typeof window.ipcRenderer !== 'undefined',
    hasElectronAPI: typeof window.electronAPI === 'object' && window.electronAPI !== null,
    electronAPIKeys: typeof window.electronAPI === 'object' && window.electronAPI !== null
      ? Object.keys(window.electronAPI)
      : null,
  }))()`)

  let appInfo = null
  let appInfoError = null
  try {
    appInfo = await contents.executeJavaScript('window.electronAPI.getAppInfo()')
  } catch (err) {
    appInfoError = err instanceof Error ? err.message : String(err)
  }

  let fetchOutcome = 'unknown'
  try {
    fetchOutcome = await contents.executeJavaScript(
      "fetch('https://example.com/csp-test').then(() => 'allowed').catch((e) => 'blocked:' + e.message)",
    )
  } catch (err) {
    fetchOutcome = 'threw:' + (err instanceof Error ? err.message : String(err))
  }

  let inlineScriptBlocked
  try {
    await contents.executeJavaScript(`
      window.__cspInlineProbe = false
      const s = document.createElement('script')
      s.textContent = 'window.__cspInlineProbe = true'
      document.body.appendChild(s)
    `)
    const probe = await contents.executeJavaScript('window.__cspInlineProbe')
    inlineScriptBlocked = probe !== true
  } catch {
    inlineScriptBlocked = true
  }

  const beforeUrl = contents.getURL()
  await contents.executeJavaScript("window.location.href = 'https://example.com/'").catch(() => {})
  await new Promise((resolve) => setTimeout(resolve, 500))
  const afterNavigationUrl = contents.getURL()

  const windowCountBefore = BrowserWindow.getAllWindows().length
  await contents
    .executeJavaScript("window.open('https://example.com/', '_blank')")
    .catch(() => {})
  await new Promise((resolve) => setTimeout(resolve, 500))
  const windowCountAfter = BrowserWindow.getAllWindows().length

  send({
    nodeIsolation,
    appInfo,
    appInfoError,
    fetchOutcome,
    inlineScriptBlocked,
    navigationBlocked: beforeUrl === afterNavigationUrl,
    newWindowBlocked: windowCountAfter === windowCountBefore,
  })

  app.exit(0)
}

app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    runChecks(window).catch(fail)
  })
})

require(path.join(__dirname, '..', '..', 'out', 'main', 'index.js'))
