'use strict'

/**
 * Minimal `ipcMain`-shaped fake: `handle(channel, fn)` stores the handler,
 * `invoke(channel, ...args)` calls it exactly the way Electron would
 * (fake IpcMainInvokeEvent first, then the renderer-supplied args) and
 * returns its resolved value or rejection - so handler registration modules
 * can be tested without a real Electron process.
 */
function createFakeIpcMain() {
  const handlers = new Map()

  return {
    handle(channel, fn) {
      if (handlers.has(channel)) {
        throw new Error(`duplicate handler registered for channel "${channel}"`)
      }
      handlers.set(channel, fn)
    },
    invoke(channel, ...args) {
      const fn = handlers.get(channel)
      if (!fn) {
        throw new Error(`no handler registered for channel "${channel}"`)
      }
      return fn({ sender: null }, ...args)
    },
    channels() {
      return [...handlers.keys()]
    },
  }
}

module.exports = { createFakeIpcMain }
