import * as tdl from 'tdl'
import type { Client } from 'tdl'
import { configureTdlibNative } from './nativeLoader'
import type { TdlibRuntimeConfig } from './config'
import { TdlibServiceError } from './types'

/**
 * Creates a real TDLib client from a typed config. `databaseEncryptionKey`
 * is intentionally left unset (TDLib then uses an empty encryption key) -
 * the same decision already verified in spike/connect.ts and
 * spike/standalone-client.ts (see docs/tdlib-decision.md, Task 01.2/01.3);
 * no new database encryption mechanism is introduced here.
 *
 * `enable_storage_optimizer` is intentionally omitted - it does not exist on
 * TDLib 1.8.67's setTdlibParameters (confirmed in the same spike doc).
 */
export function createTdlibClient(config: TdlibRuntimeConfig): Client {
  configureTdlibNative()

  try {
    return tdl.createClient({
      apiId: config.apiId,
      apiHash: config.apiHash,
      databaseDirectory: config.databaseDirectory,
      filesDirectory: config.filesDirectory,
      tdlibParameters: {
        use_message_database: true,
        use_secret_chats: false,
        use_file_database: true,
        use_chat_info_database: true,
        system_language_code: config.systemLanguageCode,
        device_model: config.deviceModel,
        system_version: config.systemVersion,
        application_version: config.applicationVersion,
      },
    })
  } catch (err) {
    if (err instanceof TdlibServiceError) throw err
    throw new TdlibServiceError('initialization', 'Failed to create the TDLib client', {
      cause: err,
    })
  }
}
