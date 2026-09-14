import { app, type IpcMain } from 'electron'
import { IPC_CHANNELS, type AppInfo } from '../../shared/ipc'
import { handle } from './handle'

export function registerAppHandlers(ipcMain: IpcMain): void {
  handle(ipcMain, IPC_CHANNELS.appGetAppInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
  }))
}
