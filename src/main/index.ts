import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, ipcMain, session } from 'electron'
import { getMainWindowWebPreferences } from './windowConfig'
import { APP_INFO_CHANNEL, type AppInfo } from '../shared/electron-api'

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

// Fixed, whitelisted IPC channel - this is the only channel main handles.
// No generic send()/invoke() passthrough is exposed to the renderer.
ipcMain.handle(APP_INFO_CHANNEL, (): AppInfo => ({
  name: app.getName(),
  version: app.getVersion(),
}))

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
