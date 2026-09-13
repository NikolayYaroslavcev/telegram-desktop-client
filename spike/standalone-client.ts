import 'dotenv/config'
import * as os from 'node:os'
import * as path from 'node:path'
import * as tdl from 'tdl'
import { getTdjson } from 'prebuilt-tdlib'

tdl.configure({ tdjson: getTdjson() })

/**
 * Minimal standalone TDLib client (task 01.2). Loads real API credentials
 * from `.env`, starts a real TDLib client via `tdl` + `prebuilt-tdlib`, and
 * logs `authorizationState` transitions up to `authorizationStateWaitPhoneNumber`.
 * No phone/OTP/2FA/UI/IPC is implemented here - see docs/plan.md #01.3+.
 */

const apiId = Number(process.env.TG_API_ID ?? '')
const apiHash = process.env.TG_API_HASH ?? ''

if (!apiId || !apiHash) {
  console.error(
    '[standalone] TG_API_ID / TG_API_HASH are missing or invalid. Copy .env.example to .env ' +
      'and fill in real values from https://my.telegram.org/ before running this client.',
  )
  process.exit(1)
}

console.log('[standalone] API credentials loaded: yes')

// TDLib's on-disk state must live outside the repository. Defaults to a
// stable directory under the OS temp dir; override with TDLIB_DATA_DIR.
const dataRoot = process.env.TDLIB_DATA_DIR
  ? path.resolve(process.env.TDLIB_DATA_DIR)
  : path.join(os.tmpdir(), 'telegram-desktop-client-standalone')

const databaseDirectory = path.join(dataRoot, 'db')
const filesDirectory = path.join(dataRoot, 'files')

console.log(`[standalone] TDLib database directory: ${databaseDirectory}`)
console.log('[standalone] TDLib starting...')

const client = tdl.createClient({
  apiId,
  apiHash,
  databaseDirectory,
  filesDirectory,
  tdlibParameters: {
    use_message_database: true,
    use_secret_chats: false,
    use_file_database: true,
    use_chat_info_database: true,
    system_language_code: 'en',
    device_model: 'Desktop',
    system_version: `${os.type()} ${os.release()}`,
    application_version: '0.1.0',
  },
})

client.on('error', (err) => {
  console.error('[standalone] client error event:', err instanceof Error ? err.message : String(err))
})

client.on('update', (update) => {
  if (update._ !== 'updateAuthorizationState') return
  const state = update.authorization_state._
  console.log(`[standalone] authorizationState -> ${state}`)

  if (state === 'authorizationStateWaitPhoneNumber') {
    console.log('[standalone] Reached authorizationStateWaitPhoneNumber - stopping here (task 01.2 scope).')
    client.close().catch((err) => {
      console.error('[standalone] error while closing client:', err instanceof Error ? err.message : String(err))
    })
  }
})

client.on('close', () => {
  console.log('[standalone] client closed')
})
