import 'dotenv/config'
import * as os from 'node:os'
import * as path from 'node:path'
import * as tdl from 'tdl'
import { getTdjson } from 'prebuilt-tdlib'
import { askVisible, askHidden, closePrompts } from './cli-prompt'

tdl.configure({ tdjson: getTdjson() })

/**
 * Minimal standalone TDLib client (tasks 01.3-01.4). Loads real API
 * credentials from `.env`, starts a real TDLib client via `tdl` +
 * `prebuilt-tdlib`, and drives the full authorization flow (phone number ->
 * OTP -> optional 2FA password -> ready) via CLI prompts. Once ready, logs
 * safe diagnostic fields from incoming `updateNewMessage` updates. No
 * history/UI/IPC/send-as-a-feature, see docs/plan.md #01.5+.
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

let shuttingDown = false

async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  closePrompts()
  try {
    await client.close()
  } catch (err) {
    console.error('[standalone] error while closing client:', err instanceof Error ? err.message : String(err))
  }
  process.exit(exitCode)
}

process.on('SIGINT', () => {
  console.log('\n[standalone] SIGINT received, closing TDLib client...')
  void shutdown(0)
})

client.on('error', (err) => {
  // TDLibError only ever carries a numeric code + a short machine-readable
  // message (e.g. "PHONE_CODE_INVALID") - safe to print as-is.
  console.error('[standalone] client error event:', err instanceof Error ? err.message : String(err))
})

// Logs authorizationState transitions by name only - never the full update
// object, which could otherwise carry TDLib-echoed request fields.
client.on('update', (update) => {
  if (update._ === 'updateAuthorizationState') {
    console.log(`[standalone] authorizationState -> ${update.authorization_state._}`)
    return
  }

  if (update._ === 'updateNewMessage') {
    const { message } = update
    console.log('[standalone] updateNewMessage:', {
      chatId: message.chat_id,
      messageId: message.id,
      date: message.date,
      isOutgoing: message.is_outgoing,
      contentType: message.content._,
      text: message.content._ === 'messageText' ? message.content.text.text : undefined,
    })
  }
})

client.on('close', () => {
  console.log('[standalone] client closed')
})

async function main(): Promise<void> {
  try {
    await client.login({
      type: 'user',
      getPhoneNumber: async (retry) => {
        if (retry) {
          console.log('[standalone] Phone number was rejected by Telegram - please try again.')
        }
        return askVisible('Phone number: ')
      },
      getAuthCode: async (retry) => {
        if (retry) {
          console.log('[standalone] Authentication code was invalid or empty - please try again.')
        }
        return askVisible('Authentication code: ')
      },
      getPassword: async (passwordHint, retry) => {
        if (retry) {
          console.log('[standalone] Password was incorrect - please try again.')
        }
        const hintSuffix = passwordHint ? ` (hint: ${passwordHint})` : ''
        return askHidden(`Two-factor password${hintSuffix}: `)
      },
      getEmailAddress: async () => {
        throw new Error('authorizationStateWaitEmailAddress is out of scope for task 01.3')
      },
      getEmailCode: async () => {
        throw new Error('authorizationStateWaitEmailCode is out of scope for task 01.3')
      },
      confirmOnAnotherDevice: () => {
        console.log('[standalone] authorizationStateWaitOtherDeviceConfirmation is out of scope for task 01.3.')
      },
      getName: async () => {
        throw new Error('authorizationStateWaitRegistration is out of scope for task 01.3')
      },
    })

    closePrompts()
    console.log('Authorization successful')
    console.log('[standalone] Client is running. Press Ctrl+C to exit.')
  } catch (err) {
    // Safe: TDLibError.message is a short machine-readable code
    // (PHONE_CODE_EXPIRED, FLOOD_WAIT_386, ...), never a secret value.
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[standalone] authorization failed: ${message}`)
    await shutdown(1)
  }
}

void main()
