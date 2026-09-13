import { contextBridge, ipcRenderer } from 'electron'
import { APP_INFO_CHANNEL, type AppInfo, type ElectronAPI } from '../shared/electron-api'

/**
 * The only bridge between renderer and main. Whitelist-based on purpose:
 * exactly one read-only method, backed by exactly one fixed IPC channel.
 * No ipcRenderer, no generic send()/invoke() passthrough, no Node/Electron
 * module is exposed to the renderer beyond this.
 */
const electronAPI: ElectronAPI = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP_INFO_CHANNEL) as Promise<AppInfo>,
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
