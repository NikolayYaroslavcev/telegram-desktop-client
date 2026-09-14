import type { IpcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc'
import type { AuthorizationState } from '../../shared/models'
import type { TdlibService } from '../tdlib'
import { handle } from './handle'
import { requireTdlibService, runTdlibCall } from './tdlibHelpers'
import { requireString } from './validation'

/**
 * `auth.*` is the one part of this task's contract with a real backend
 * already: Task 04 built `TdlibService.{getAuthorizationState,
 * setPhoneNumber, checkCode, checkPassword}` precisely so this typed IPC
 * boundary could sit in front of it. Wiring it here is plumbing, not new
 * Telegram business logic - the login flow itself still lives entirely in
 * `TdlibLifecycleService`. What this task deliberately does NOT do is wire
 * a renderer UI to these handlers (Task 07).
 */
export function registerAuthHandlers(
  ipcMain: IpcMain,
  getTdlibService: () => TdlibService | null,
): void {
  handle(ipcMain, IPC_CHANNELS.authGetState, (): AuthorizationState => {
    const service = getTdlibService()
    return { status: service ? service.getAuthorizationState() : 'unknown' }
  })

  handle(
    ipcMain,
    IPC_CHANNELS.authSetPhoneNumber,
    async (_event, phone: unknown): Promise<void> => {
      const service = requireTdlibService(getTdlibService, 'auth.setPhoneNumber')
      await runTdlibCall(
        () => service.setPhoneNumber(requireString(phone, 'phone')),
        'auth.setPhoneNumber',
      )
    },
  )

  handle(ipcMain, IPC_CHANNELS.authCheckCode, async (_event, code: unknown): Promise<void> => {
    const service = requireTdlibService(getTdlibService, 'auth.checkCode')
    await runTdlibCall(() => service.checkCode(requireString(code, 'code')), 'auth.checkCode')
  })

  handle(
    ipcMain,
    IPC_CHANNELS.authCheckPassword,
    async (_event, password: unknown): Promise<void> => {
      const service = requireTdlibService(getTdlibService, 'auth.checkPassword')
      await runTdlibCall(
        () => service.checkPassword(requireString(password, 'password')),
        'auth.checkPassword',
      )
    },
  )
}
