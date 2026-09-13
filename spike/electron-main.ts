import 'dotenv/config'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { createClient, resumeExistingSession } from './connect'

/**
 * Task 01.6 packaging spike: minimal Electron main-process entry point that
 * loads TDLib via the tdl + prebuilt-tdlib binding, resumes the *existing*
 * authorized session created by `spike/standalone-client.ts` (tasks
 * 01.3-01.4), and reaches `authorizationStateReady` - both under `electron .`
 * (dev) and inside an electron-builder packaged `.exe`. TDLib only ever runs
 * in this main process; the renderer is a static, no-IPC status page with
 * `nodeIntegration: false` / `contextIsolation: true` / `sandbox: true`, and
 * never receives a TDLib client or raw TDLib data. No Telegram UI, no IPC
 * contract - that is task 06.
 */

const CONTEXT = 'electron-packaged'

// Outside the repo and outside the packaged app's install directory in both
// dev and packaged runs (per-user AppData path), so this log survives
// reinstall/uninstall the same way the TDLib database directory does.
const logFile = path.join(app.getPath('userData'), 'spike-01.6.log')

function log(...args: unknown[]): void {
  const line = `[${new Date().toISOString()}] [${CONTEXT}] ${args.map(String).join(' ')}`
  console.log(`[${CONTEXT}]`, ...args)
  try {
    fs.appendFileSync(logFile, line + '\n')
  } catch {
    // Logging is best-effort only - never let it crash the spike.
  }
}

let mainWindow: BrowserWindow | null = null

function renderStatus(status: string): string {
  return (
    '<!doctype html><meta charset="utf-8">' +
    '<body style="font-family:sans-serif;padding:16px">' +
    '<h3>TDLib packaging spike (Task 01.6)</h3>' +
    `<p>${status}</p>` +
    `<p>Log file: ${logFile}</p>` +
    '</body>'
  )
}

function createWindow(status: string): void {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 240,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  void mainWindow.loadURL('data:text/html,' + encodeURIComponent(renderStatus(status)))
}

function setStatus(status: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    void mainWindow.loadURL('data:text/html,' + encodeURIComponent(renderStatus(status)))
  }
}

async function main(): Promise<void> {
  log('app ready; electron:', process.versions.electron, 'chrome:', process.versions.chrome)
  log('log file:', logFile)
  createWindow('Connecting to TDLib and resuming existing session...')

  const client = createClient(CONTEXT)

  client.on('error', (err) => log('client error event:', String(err)))

  client.on('update', (update) => {
    if (update._ === 'updateAuthorizationState') {
      log('authorizationState ->', update.authorization_state._)
      return
    }
    if (update._ === 'updateNewMessage') {
      // Structural confirmation only - never log message text from a
      // packaged spike run (see docs/tdlib-decision.md, Task 01.6).
      log('updateNewMessage received, contentType:', update.message.content._)
    }
  })

  client.on('close', () => log('client closed'))

  await resumeExistingSession(client, CONTEXT)
  log('authorizationStateReady reached - existing session resumed, no re-authorization')
  setStatus('authorizationStateReady reached. Existing session resumed successfully.')

  let shuttingDown = false
  async function shutdown(): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true
    log('shutting down, closing TDLib client...')
    try {
      await client.close()
    } catch (err) {
      log('error while closing client:', err instanceof Error ? err.message : String(err))
    }
    log('shutdown complete')
    app.quit()
  }

  app.on('window-all-closed', () => {
    void shutdown()
  })
}

app.whenReady().then(() => {
  main().catch((err) => {
    log('spike failed:', err instanceof Error ? (err.stack ?? err.message) : String(err))
    setStatus('Spike failed - see log file.')
    app.exit(1)
  })
})
