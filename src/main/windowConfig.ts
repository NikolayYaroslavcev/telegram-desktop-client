import path from 'node:path'
import type { WebPreferences } from 'electron'

/**
 * Extracted as a pure function (no BrowserWindow side effect) so the
 * security baseline can be asserted directly in tests without spawning a
 * real window.
 */
export function getMainWindowWebPreferences(): WebPreferences {
  return {
    preload: path.join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  }
}
