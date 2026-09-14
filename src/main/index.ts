import 'dotenv/config'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type Database from 'better-sqlite3'
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import { AttachmentSelectionRegistry } from './attachments'
import { installGlobalSafetyNet } from './globalErrorHandlers'
import { getMainWindowWebPreferences } from './windowConfig'
import { createEventBroadcaster, registerIpcHandlers, type AttachmentIpcDeps } from './ipc'
import { describeErrorForLog, logger } from './logger'
import { createRealtimeUpdateRouter } from './messages/realtimeUpdates'
import {
  closeDatabase,
  MessageRepository,
  openDatabase,
  resolveStorageDatabasePath,
  StorageError,
} from './storage'
import { createTdlibService, TdlibServiceError, type TdlibService } from './tdlib'

// Task 18: log-and-exit on anything that escaped every typed error boundary
// below - installed first, before any other startup work, so it covers
// startup failures too.
installGlobalSafetyNet()

/**
 * CSP differs between dev and production because they are served
 * differently:
 *  - dev: Vite dev server over http://localhost:5173. Vite's React Fast
 *    Refresh preamble and the HMR client inject inline <script> content and
 *    use a ws:// connection, so script-src/style-src need 'unsafe-inline'
 *    and connect-src needs the dev server's http/ws origin. This relaxed
 *    policy never ships - it only applies when VITE_DEV_SERVER_URL is set.
 *  - production: packaged renderer loaded via file://. No dev server, no
 *    HMR, no inline scripts anywhere in the built output, so the policy is
 *    maximally restrictive (no 'unsafe-inline', no 'unsafe-eval').
 */
function buildCsp(isDev: boolean): string {
  const directives: Record<string, string[]> = isDev
    ? {
        'default-src': ["'self'", 'http://localhost:5173'],
        'script-src': ["'self'", "'unsafe-inline'", 'http://localhost:5173'],
        'style-src': ["'self'", "'unsafe-inline'", 'http://localhost:5173'],
        'connect-src': ["'self'", 'http://localhost:5173', 'ws://localhost:5173'],
        'img-src': ["'self'", 'data:', 'http://localhost:5173'],
        'font-src': ["'self'", 'http://localhost:5173'],
        'object-src': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'none'"],
        'frame-ancestors': ["'none'"],
      }
    : {
        'default-src': ["'none'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'none'"],
        'frame-ancestors': ["'none'"],
      }

  return Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(' ')}`)
    .join('; ')
}

function isAllowedNavigation(
  targetUrl: string,
  allowedOrigin: string | null,
  allowedFileUrl: string | null,
): boolean {
  let target: URL
  try {
    target = new URL(targetUrl)
  } catch {
    return false
  }

  if (allowedOrigin && target.origin === allowedOrigin) {
    return true
  }

  if (allowedFileUrl) {
    const allowed = new URL(allowedFileUrl)
    if (target.protocol === 'file:' && target.pathname === allowed.pathname) {
      return true
    }
  }

  return false
}

function createWindow(): void {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL

  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: getMainWindowWebPreferences(),
  })

  let allowedOrigin: string | null = null
  let allowedFileUrl: string | null = null

  if (devServerUrl) {
    allowedOrigin = new URL(devServerUrl).origin
    void window.loadURL(devServerUrl)
  } else {
    const indexPath = path.join(__dirname, '../renderer/index.html')
    allowedFileUrl = pathToFileURL(indexPath).toString()
    void window.loadFile(indexPath)
  }

  // Renderer must never navigate the top-level frame to an arbitrary
  // origin (e.g. via a script-driven `location.href` change).
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedNavigation(targetUrl, allowedOrigin, allowedFileUrl)) {
      event.preventDefault()
    }
  })
}

// TDLib lives only here in the main process - never exposed to preload or
// renderer. A configuration/startup failure (e.g. missing .env) is logged,
// not thrown past this boundary, so the rest of the app can still run.
let tdlibService: TdlibService | null = null

// Local SQLite storage (Task 08/10) - independent of TDLib's own database,
// under its own `storage` subfolder of userData (see resolveStorageDatabasePath).
let db: Database.Database | null = null
let messageRepository: MessageRepository | null = null

// Attachments (Task 14): the dialog/file-selection registry is the trust
// boundary `messages.sendAttachment` checks (see
// src/main/attachments/fileSelection.ts) - it must be a single instance
// shared across every IPC call for the lifetime of the process, not
// recreated per-handler.
const attachmentSelectionRegistry = new AttachmentSelectionRegistry()
const attachmentIpcDeps: AttachmentIpcDeps = {
  getWindow: () => BrowserWindow.getAllWindows()[0] ?? null,
  openDialog: (window, options) =>
    window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options),
  statFile: (filePath) => fs.stat(filePath),
  readFile: (filePath) => fs.readFile(filePath),
  openPath: (filePath) => shell.openPath(filePath),
  registry: attachmentSelectionRegistry,
}

// The entire IPC surface renderer can reach - one handler per contract
// method, no generic send()/invoke() passthrough (see src/main/ipc).
registerIpcHandlers(
  ipcMain,
  () => tdlibService,
  () => messageRepository,
  attachmentIpcDeps,
)

// Pushes typed events to every renderer window (see src/main/ipc/eventBroadcaster).
const eventBroadcaster = createEventBroadcaster(() => BrowserWindow.getAllWindows())

function logTdlibError(operation: string, err: unknown): void {
  if (err instanceof TdlibServiceError) {
    logger.error({
      operation,
      errorCode: 'TDLIB_ERROR',
      category: err.kind,
      details: describeErrorForLog(err.cause ?? err),
    })
    return
  }
  logger.error({ operation, errorCode: 'INTERNAL_ERROR', details: describeErrorForLog(err) })
}

function startStorage(): void {
  try {
    const dbPath = resolveStorageDatabasePath(app.getPath('userData'))
    db = openDatabase(dbPath)
    messageRepository = new MessageRepository(db)
  } catch (err) {
    const details =
      err instanceof StorageError ? describeErrorForLog(err.cause ?? err) : describeErrorForLog(err)
    logger.error({ operation: 'startup.storage', errorCode: 'STORAGE_ERROR', details })
  }
}

function startTdlibService(): void {
  let service: TdlibService
  try {
    service = createTdlibService({
      userDataPath: app.getPath('userData'),
      applicationVersion: app.getVersion(),
    })
    tdlibService = service
  } catch (err) {
    logTdlibError('startup.tdlib', err)
    return
  }

  // Real-time message updates (Task 11) - actual routing logic lives in
  // src/main/messages/realtimeUpdates.ts, not here.
  const routeRealtimeUpdate = createRealtimeUpdateRouter({
    getChat: (chatId) => service.getChat(chatId),
    getMessageRepository: () => messageRepository,
    eventBroadcaster,
  })

  service.onUpdate((event) => {
    if (event.kind === 'authorizationState') {
      eventBroadcaster.authStateChanged({ status: event.status })
      return
    }
    if (event.kind === 'authInputRejected') {
      eventBroadcaster.authInputRejected({ step: event.step })
      return
    }
    if (event.kind === 'authFlowTerminated') {
      eventBroadcaster.authFlowTerminated()
      return
    }
    if (event.kind === 'networkState') {
      logger.info({ operation: 'tdlib.networkState', details: { status: event.status } })
      eventBroadcaster.networkStateChanged({ status: event.status })
      return
    }
    if (event.kind === 'raw') {
      void routeRealtimeUpdate(event.update)
    }
  })

  service.start().catch((err: unknown) => {
    logTdlibError('tdlib.start', err)
  })
}

app.whenReady().then(() => {
  const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [buildCsp(isDev)],
      },
    })
  })

  // Renderer must never be able to spawn arbitrary new BrowserWindows
  // (e.g. via window.open) - no external content, no remote module.
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })

  startStorage()
  startTdlibService()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Ensures the TDLib client is closed and the local database connection
// released before Electron actually exits - no double-close (guarded by
// `quitting`), no hang (client.close() resolves once authorizationStateClosed
// is reached, mirroring spike/electron-main.ts).
let quitting = false
app.on('before-quit', (event) => {
  if (quitting || (!tdlibService && !db)) return
  event.preventDefault()
  quitting = true

  const stopTdlib = tdlibService
    ? tdlibService.stop().catch((err: unknown) => logTdlibError('shutdown.tdlib', err))
    : Promise.resolve()

  stopTdlib.finally(() => {
    if (db) closeDatabase(db)
    app.quit()
  })
})
