import 'dotenv/config'
import { app } from 'electron'
import { runTdlibSpike } from './tdlib-spike'

/**
 * Minimal Electron main-process entry point for the TDLib binding spike.
 * Intentionally creates no BrowserWindow - the only thing under test here is
 * whether the native tdl addon + prebuilt-tdlib shared library load and run
 * inside Electron's main process without a rebuild step.
 */
async function main(): Promise<void> {
  const apiId = Number(process.env.TG_API_ID ?? '0')
  const apiHash = process.env.TG_API_HASH ?? ''

  const result = await runTdlibSpike({
    context: 'electron-main',
    apiId: apiId || 1,
    apiHash: apiHash || 'spike-placeholder-hash',
  })

  console.log('[electron-main] spike result:', JSON.stringify(result, null, 2))
  app.quit()
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[electron-main] spike failed:', err)
    app.exit(1)
  })
})
