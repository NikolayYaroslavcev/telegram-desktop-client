import * as os from 'node:os'
import * as path from 'node:path'
import * as tdl from 'tdl'
import type { Client } from 'tdl'
import { getTdjson } from 'prebuilt-tdlib'

/**
 * Inside an asar-packaged Electron app, `getTdjson()` resolves via
 * `require.resolve()`, which returns the *virtual* in-archive path
 * (".../app.asar/node_modules/...") even though electron-builder's default
 * native-file detection physically unpacks `tdjson.dll` next to the asar
 * archive (in "app.asar.unpacked"). Windows' LoadLibrary cannot open a path
 * "inside" the single-file .asar archive (Win32 error 126, "module not
 * found") - verified empirically for Task 01.6, see docs/tdlib-decision.md.
 * Rewriting the virtual path to its real on-disk unpacked counterpart is the
 * standard Electron workaround for this exact class of problem. No-op
 * outside a packaged app (no "app.asar" segment in the resolved path).
 */
function resolveTdjsonPath(): string {
  const resolved = getTdjson()
  const asarMarker = `app.asar${path.sep}`
  const unpackedMarker = `app.asar.unpacked${path.sep}`
  if (resolved.includes(asarMarker) && !resolved.includes(unpackedMarker)) {
    return resolved.replace(asarMarker, unpackedMarker)
  }
  return resolved
}

const tdjsonPath = resolveTdjsonPath()
console.log('[connect] resolved tdjson path:', tdjsonPath)
tdl.configure({ tdjson: tdjsonPath })

/**
 * Creates a TDLib client pointed at the same on-disk session used by
 * `spike/standalone-client.ts` (tasks 01.3-01.4), so this experiment reuses
 * the already-authorized account instead of starting a new login.
 */
export function createClient(context: string): Client {
  const apiId = Number(process.env.TG_API_ID ?? '')
  const apiHash = process.env.TG_API_HASH ?? ''

  if (!apiId || !apiHash) {
    throw new Error(
      `[${context}] TG_API_ID / TG_API_HASH are missing or invalid - copy .env.example to .env first.`,
    )
  }

  const dataRoot = process.env.TDLIB_DATA_DIR
    ? path.resolve(process.env.TDLIB_DATA_DIR)
    : path.join(os.tmpdir(), 'telegram-desktop-client-standalone')

  const databaseDirectory = path.join(dataRoot, 'db')
  const filesDirectory = path.join(dataRoot, 'files')

  console.log(`[${context}] TDLib database directory: ${databaseDirectory}`)

  return tdl.createClient({
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
}

/**
 * Resumes an already-authorized session. Every prompt handler throws instead
 * of asking for input - this experiment only makes sense against a session
 * that already reaches `authorizationStateReady` on its own (per task 01.5's
 * "no repeat authorization" precondition); a fresh-login prompt here means
 * the precondition wasn't met, and failing loudly beats silently hanging on
 * stdin in an unattended experiment script.
 */
export async function resumeExistingSession(client: Client, context: string): Promise<void> {
  const unexpected = (step: string) => () => {
    throw new Error(
      `[${context}] unexpected fresh-login step (${step}) - run "npm run spike:standalone" first ` +
        'to reach authorizationStateReady, then re-run this experiment.',
    )
  }

  await client.login({
    getPhoneNumber: unexpected('phone number'),
    getAuthCode: unexpected('auth code'),
    getPassword: unexpected('2FA password'),
    getEmailAddress: unexpected('email address'),
    getEmailCode: unexpected('email code'),
    getName: unexpected('registration'),
    confirmOnAnotherDevice: () => {
      throw new Error(`[${context}] unexpected fresh-login step (confirm on another device)`)
    },
  })
}
