import type { IpcMain } from 'electron'
import { IPC_CHANNELS, type NetworkState } from '../../shared/ipc'
import type { TdlibService } from '../tdlib'
import { handle } from './handle'

/**
 * `network.getState` (Task 17) - the same "avoid a false initial value" role
 * `auth.getState` already plays for `AuthorizationState`: a renderer mounting
 * after the first `updateConnectionState` update already fired needs a way to
 * read the current value instead of defaulting to a guess. No TDLib service
 * yet (or not started) reports `'unknown'`, never `'ready'`.
 */
export function registerNetworkHandlers(
  ipcMain: IpcMain,
  getTdlibService: () => TdlibService | null,
): void {
  handle(ipcMain, IPC_CHANNELS.networkGetState, (): NetworkState => {
    const service = getTdlibService()
    return { status: service ? service.getNetworkState() : 'unknown' }
  })
}
