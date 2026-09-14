import { loadTdlibRuntimeConfig } from './config'
import { TdlibLifecycleService } from './lifecycle'
import type { TdlibService } from './types'

export type {
  AuthorizationStatus,
  DownloadedFile,
  TdlibService,
  TdlibUpdateEvent,
  Unsubscribe,
  TdlibErrorKind,
} from './types'
export { TdlibServiceError } from './types'

/**
 * Builds the production TDLib service from environment variables and
 * Electron-provided paths. The only entry point `src/main/index.ts` needs
 * from this module.
 */
export function createTdlibService(options: {
  userDataPath: string
  applicationVersion: string
}): TdlibService {
  const config = loadTdlibRuntimeConfig(process.env, options)
  return new TdlibLifecycleService(config)
}
