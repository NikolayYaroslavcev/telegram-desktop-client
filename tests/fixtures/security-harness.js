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
const { IPC_CHANNELS } = require(
  path.join(__dirname, '..', '..', 'out', 'shared', 'ipc', 'channels.js'),
)

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
      ? Object.keys(window.electronAPI).sort()
      : null,
    authKeys: window.electronAPI?.auth ? Object.keys(window.electronAPI.auth).sort() : null,
    chatsKeys: window.electronAPI?.chats ? Object.keys(window.electronAPI.chats).sort() : null,
    networkKeys: window.electronAPI?.network ? Object.keys(window.electronAPI.network).sort() : null,
    messagesKeys: window.electronAPI?.messages ? Object.keys(window.electronAPI.messages).sort() : null,
    eventsKeys: window.electronAPI?.events ? Object.keys(window.electronAPI.events).sort() : null,
    hasTdlibOnApi: 'tdlib' in (window.electronAPI ?? {}),
    hasSendOrOnMethods: ['send', 'invoke', 'on', 'execute', 'request'].some(
      (key) => key in (window.electronAPI ?? {}),
    ),
  }))()`)

  let appInfo = null
  let appInfoError = null
  try {
    appInfo = await contents.executeJavaScript('window.electronAPI.getAppInfo()')
  } catch (err) {
    appInfoError = err instanceof Error ? err.message : String(err)
  }

  // This harness never authorizes with TDLib (no phone/code/password is
  // submitted), so chats.list() can never legitimately return real chat
  // data here - it must fail with a controlled, serialized error (never a
  // raw TDLib error object, stack trace, or the internal `__ipc_error__:`
  // wire-format prefix leaking through).
  let chatsListError = null
  try {
    await contents.executeJavaScript('window.electronAPI.chats.list()')
  } catch (err) {
    chatsListError = err instanceof Error ? err.message : String(err)
  }

  // Events: two independently-subscribed listeners on the same channel,
  // driven by a real main -> renderer send (not a mock) so this proves the
  // actual preload wiring, not just its shape. `__probe` marks these sends
  // so they can be told apart from the real TDLib authorization-state
  // updates main also broadcasts on this same channel while the harness runs.
  // Wrapped in a void IIFE: the completion value of a bare assignment is the
  // subscribed unsubscribe *function*, which executeJavaScript cannot clone
  // back across the IPC boundary used to relay the result.
  await contents.executeJavaScript(`(() => {
    window.__events = { a: [], b: [] }
    const onlyProbes = (list) => list.filter((e) => e.__probe === true)
    window.__probeEvents = { a: () => onlyProbes(window.__events.a), b: () => onlyProbes(window.__events.b) }
    window.__unsubA = window.electronAPI.events.onAuthStateChanged((s) => window.__events.a.push(s))
    window.__unsubB = window.electronAPI.events.onAuthStateChanged((s) => window.__events.b.push(s))
  })()`)
  contents.send(IPC_CHANNELS.eventsAuthStateChanged, { status: 'ready', __probe: true })
  await new Promise((resolve) => setTimeout(resolve, 200))

  const bothListenersReceivedFirstEvent = await contents.executeJavaScript(
    'window.__probeEvents.a().length === 1 && window.__probeEvents.b().length === 1 && ' +
      "window.__probeEvents.a()[0].status === 'ready' && window.__probeEvents.b()[0].status === 'ready'",
  )

  // Unsubscribing A must remove exactly that listener, not B's, and be safe to call twice.
  await contents.executeJavaScript('window.__unsubA(); window.__unsubA()')
  contents.send(IPC_CHANNELS.eventsAuthStateChanged, { status: 'waitCode', __probe: true })
  await new Promise((resolve) => setTimeout(resolve, 200))

  const onlyRemainingListenerReceivedSecondEvent = await contents.executeJavaScript(
    'window.__probeEvents.a().length === 1 && window.__probeEvents.b().length === 2',
  )

  const eventSubscriptionWorks =
    bothListenersReceivedFirstEvent && onlyRemainingListenerReceivedSecondEvent

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
  await contents.executeJavaScript("window.open('https://example.com/', '_blank')").catch(() => {})
  await new Promise((resolve) => setTimeout(resolve, 500))
  const windowCountAfter = BrowserWindow.getAllWindows().length

  send({
    nodeIsolation,
    appInfo,
    appInfoError,
    chatsListError,
    eventSubscriptionWorks,
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
