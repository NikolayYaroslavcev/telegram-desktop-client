import * as tdl from 'tdl'
import { getTdjson, getTdlibInfo } from 'prebuilt-tdlib'

tdl.configure({ tdjson: getTdjson() })

export interface SpikeOptions {
  /** Label used only for log lines and the database directory name. */
  context: string
  apiId: number
  apiHash: string
  /** How many authorizationState transitions to observe before closing the client. */
  statesToObserve?: number
  /** Safety timeout in case no update arrives at all. */
  timeoutMs?: number
}

export interface SpikeResult {
  context: string
  tdlibVersion: string
  observedStates: string[]
}

/**
 * Creates a real TDLib client via `tdl` + `prebuilt-tdlib`, and resolves once
 * a handful of `authorizationState` transitions have been observed. Does not
 * perform phone/OTP/2FA login - this only proves the binding loads and TDLib
 * responds.
 */
export function runTdlibSpike(options: SpikeOptions): Promise<SpikeResult> {
  const { context, apiId, apiHash } = options
  const statesToObserve = options.statesToObserve ?? 2
  const timeoutMs = options.timeoutMs ?? 15000

  const log = (message: string): void => console.log(`[tdlib-spike:${context}] ${message}`)

  log(`tdjson path: ${getTdjson()}`)
  log(`tdlib info: ${JSON.stringify(getTdlibInfo())}`)
  log(`process.versions: ${JSON.stringify(process.versions)}`)
  log(`process.type: ${(process as unknown as { type?: string }).type ?? 'n/a (plain node)'}`)

  return new Promise((resolve, reject) => {
    const observedStates: string[] = []
    let settled = false

    const client = tdl.createClient({
      apiId,
      apiHash,
      databaseDirectory: `_td_spike_db_${context}`,
      filesDirectory: `_td_spike_files_${context}`,
    })

    const timeoutHandle = setTimeout(() => {
      log('timeout reached without observing enough states, closing anyway')
      finish()
    }, timeoutMs)

    function finish(): void {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      client
        .close()
        .catch((err) => log(`error while closing client: ${String(err)}`))
        .finally(() => {
          resolve({ context, tdlibVersion: client.getVersion(), observedStates })
        })
    }

    client.on('error', (err) => {
      log(`client error event: ${String(err)}`)
    })

    client.on('update', (update) => {
      if (update._ !== 'updateAuthorizationState') return
      const state = update.authorization_state._
      log(`authorizationState -> ${state}`)
      observedStates.push(state)
      if (observedStates.length >= statesToObserve || state === 'authorizationStateClosed') {
        finish()
      }
    })
  })
}
