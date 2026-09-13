import 'dotenv/config'
import { runTdlibSpike } from './tdlib-spike'

async function main(): Promise<void> {
  const apiId = Number(process.env.TG_API_ID ?? '0')
  const apiHash = process.env.TG_API_HASH ?? ''

  if (!apiId || !apiHash) {
    console.warn(
      '[run-node] TG_API_ID / TG_API_HASH not set (see .env.example) - using placeholder ' +
        'values. This is enough to observe authorizationState transitions, but TDLib may ' +
        'reject them once real network requests happen (out of scope for this spike).',
    )
  }

  const result = await runTdlibSpike({
    context: 'node',
    apiId: apiId || 1,
    apiHash: apiHash || 'spike-placeholder-hash',
  })

  console.log('[run-node] spike result:', JSON.stringify(result, null, 2))
}

main().catch((err) => {
  console.error('[run-node] spike failed:', err)
  process.exitCode = 1
})
