/**
 * Contract for the single whitelisted preload API exposed to the renderer.
 * Shared between main (handler), preload (bridge) and renderer (typing) so
 * the channel name and payload shape are defined exactly once.
 */

export const APP_INFO_CHANNEL = 'app:get-app-info' as const

export interface AppInfo {
  name: string
  version: string
}

export interface ElectronAPI {
  getAppInfo(): Promise<AppInfo>
}
