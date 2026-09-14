import * as os from 'node:os'
import * as path from 'node:path'
import { TdlibServiceError } from './types'

/**
 * Typed TDLib configuration. `apiHash` is a secret and must never be logged;
 * everything else here is safe to log if needed.
 */
export interface TdlibRuntimeConfig {
  apiId: number
  apiHash: string
  databaseDirectory: string
  filesDirectory: string
  systemLanguageCode: string
  deviceModel: string
  systemVersion: string
  applicationVersion: string
}

/**
 * Production TDLib runtime directories live under Electron's userData
 * directory - outside the repository, outside dist/out/release, stable
 * between restarts. Kept separate from the spike's own runtime directories
 * (which default to `os.tmpdir()/telegram-desktop-client-standalone`).
 */
export function resolveTdlibRuntimeDirectories(userDataPath: string): {
  databaseDirectory: string
  filesDirectory: string
} {
  const root = path.join(userDataPath, 'tdlib')
  return {
    databaseDirectory: path.join(root, 'database'),
    filesDirectory: path.join(root, 'files'),
  }
}

/**
 * Builds the typed TDLib config from environment variables plus
 * caller-supplied, already-Electron-resolved values (`userDataPath`,
 * `applicationVersion`) - kept as parameters rather than reading `app.*`
 * directly so this function stays pure and testable without Electron.
 *
 * Throws TdlibServiceError('configuration', ...) if TG_API_ID/TG_API_HASH
 * are missing or invalid. Never logs `env.TG_API_HASH`.
 */
export function loadTdlibRuntimeConfig(
  env: NodeJS.ProcessEnv,
  options: { userDataPath: string; applicationVersion: string },
): TdlibRuntimeConfig {
  const apiId = Number(env.TG_API_ID ?? '')
  const apiHash = env.TG_API_HASH ?? ''

  if (!Number.isFinite(apiId) || apiId <= 0 || !apiHash) {
    throw new TdlibServiceError(
      'configuration',
      'TG_API_ID / TG_API_HASH are missing or invalid. Copy .env.example to .env and fill in ' +
        'real values from https://my.telegram.org/.',
    )
  }

  const { databaseDirectory, filesDirectory } = resolveTdlibRuntimeDirectories(options.userDataPath)

  return {
    apiId,
    apiHash,
    databaseDirectory,
    filesDirectory,
    systemLanguageCode: 'en',
    deviceModel: 'Desktop',
    systemVersion: `${os.type()} ${os.release()}`,
    applicationVersion: options.applicationVersion,
  }
}
