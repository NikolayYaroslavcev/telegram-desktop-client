import 'dotenv/config'
import { TDLibError } from 'tdl'
import type { Client } from 'tdl'
import type { Update, message } from 'tdlib-types'
import { createClient, resumeExistingSession } from './connect'

/**
 * Task 01.5 spike: observes TDLib's *real* behavior when a message is
 * deleted in a private 1-on-1 chat - what `updateDeleteMessages` actually
 * contains, and whether the original text is retrievable afterwards. This
 * is a one-shot diagnostic script, not a feature; it reuses the session from
 * `spike/standalone-client.ts` and must be run against that same,
 * already-authorized account.
 *
 * Usage:
 *   node dist/delete-experiment.js phase1
 *   node dist/delete-experiment.js phase2 <chatId> <messageId>
 *
 * phase1 sends and deletes several throwaway test messages in the private
 * chat identified by DELETE_TEST_CHAT_ID (env), logs the real
 * updateDeleteMessages payload for each, and prints a chatId/messageId pair
 * for the restart check. phase2 is run as a *separate process* afterwards
 * (simulating an app restart) and checks what's still reachable about the
 * message deleted at the end of phase1.
 */

const CONTEXT = 'delete-experiment'

function log(...args: unknown[]): void {
  console.log(`[${CONTEXT}]`, ...args)
}

function targetChatId(): number {
  const raw = process.env.DELETE_TEST_CHAT_ID
  if (!raw) {
    throw new Error(
      'DELETE_TEST_CHAT_ID is not set. Set it to the private 1-on-1 chat id used for this ' +
        'experiment (see docs/tdlib-decision.md, task 01.4, for how that id was obtained).',
    )
  }
  const chatId = Number(raw)
  if (!Number.isFinite(chatId)) throw new Error(`DELETE_TEST_CHAT_ID is not a number: ${raw}`)
  return chatId
}

/** Waits for a predicate over the client's update stream, or rejects on timeout. */
function waitForUpdate<T>(
  client: Client,
  timeoutMs: number,
  describe: string,
  match: (update: Update) => T | undefined,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.removeListener('update', onUpdate)
      reject(new Error(`timed out after ${timeoutMs}ms waiting for: ${describe}`))
    }, timeoutMs)

    function onUpdate(update: Update): void {
      const result = match(update)
      if (result !== undefined) {
        clearTimeout(timer)
        client.removeListener('update', onUpdate)
        resolve(result)
      }
    }

    client.on('update', onUpdate)
  })
}

interface SentMessage {
  chatId: number
  messageId: number
  date: number
  isOutgoing: boolean
  contentType: string
  text: string | undefined
}

function describeMessage(msg: message): SentMessage {
  return {
    chatId: msg.chat_id,
    messageId: msg.id,
    date: msg.date,
    isOutgoing: msg.is_outgoing,
    contentType: msg.content._,
    text: msg.content._ === 'messageText' ? msg.content.text.text : undefined,
  }
}

/** Sends a throwaway text message and waits for its final (non-temporary) id via updateMessageSendSucceeded. */
async function sendTestMessage(client: Client, chatId: number, text: string): Promise<SentMessage> {
  let tempId: number | undefined
  // invoke() hasn't run yet, so no matching update can fire before tempId is set below.
  const succeeded = waitForUpdate(client, 15000, `updateMessageSendSucceeded for "${text}"`, (update) =>
    update._ === 'updateMessageSendSucceeded' && update.old_message_id === tempId
      ? describeMessage(update.message)
      : undefined,
  )

  const initial = await client.invoke({
    _: 'sendMessage',
    chat_id: chatId,
    input_message_content: { _: 'inputMessageText', text: { _: 'formattedText', text } },
  })
  tempId = initial.id
  log(`sendMessage("${text}") -> temporary id ${tempId}`)

  const final = await succeeded
  log(`updateMessageSendSucceeded: old_message_id=${tempId} ->`, final)
  return final
}

interface DeleteObservation {
  raw: unknown
  matchedTargetId: boolean
}

/** Deletes messages and waits for the real updateDeleteMessages event that covers them. */
async function deleteAndObserve(
  client: Client,
  chatId: number,
  messageIds: number[],
  revoke: boolean,
): Promise<DeleteObservation> {
  const deleted = waitForUpdate(client, 15000, `updateDeleteMessages for [${messageIds.join(',')}]`, (update) => {
    if (update._ !== 'updateDeleteMessages') return undefined
    if (update.chat_id !== chatId) return undefined
    const matchedTargetId = messageIds.every((id) => update.message_ids.includes(id))
    // Resolve on the first updateDeleteMessages for this chat even if it
    // doesn't cover every target id - real behavior (one event vs several)
    // is exactly what this experiment needs to observe, not assume.
    return { raw: update, matchedTargetId }
  })

  await client.invoke({ _: 'deleteMessages', chat_id: chatId, message_ids: messageIds, revoke })
  log(`deleteMessages(chat_id=${chatId}, message_ids=[${messageIds.join(',')}], revoke=${revoke}) invoked`)

  const observation = await deleted
  log('updateDeleteMessages (raw):', JSON.stringify(observation.raw))
  return observation
}

/** Tries one TDLib method to fetch a message by id, logging FOUND/NOT-FOUND. Never throws. */
async function tryInvokeGetMessage(
  client: Client,
  method: 'getMessage' | 'getMessageLocally',
  chatId: number,
  messageId: number,
): Promise<{ found: boolean; text: string | undefined; errorCode?: number; errorMessage?: string }> {
  try {
    const message = await client.invoke({ _: method, chat_id: chatId, message_id: messageId })
    const described = describeMessage(message)
    log(`${method}(${chatId}, ${messageId}) -> FOUND:`, described)
    return { found: true, text: described.text }
  } catch (err) {
    if (err instanceof TDLibError) {
      log(`${method}(${chatId}, ${messageId}) -> TDLibError code=${err.code} message=${err.message}`)
      return { found: false, text: undefined, errorCode: err.code, errorMessage: err.message }
    }
    throw err
  }
}

/**
 * Checks message availability after deletion both over the network
 * (`getMessage`) and from the local TDLib cache only (`getMessageLocally`,
 * an offline method) - the two can differ in principle, so both are checked
 * rather than assuming they behave the same.
 */
async function tryGetMessage(client: Client, chatId: number, messageId: number): Promise<void> {
  await tryInvokeGetMessage(client, 'getMessage', chatId, messageId)
  await tryInvokeGetMessage(client, 'getMessageLocally', chatId, messageId)
}

async function runPhase1(client: Client, chatId: number): Promise<void> {
  log('=== Scenario A: delete for self only (revoke: false) ===')
  const local = await sendTestMessage(client, chatId, 'DELETE_TEST_LOCAL')
  await deleteAndObserve(client, chatId, [local.messageId], false)
  await tryGetMessage(client, chatId, local.messageId)

  log('=== Scenario B: delete for all chat members (revoke: true) ===')
  const both = await sendTestMessage(client, chatId, 'DELETE_TEST_BOTH')
  await deleteAndObserve(client, chatId, [both.messageId], true)
  await tryGetMessage(client, chatId, both.messageId)

  log('=== Scenario C: delete immediately after send, before updateMessageSendSucceeded ===')
  try {
    const initial = await client.invoke({
      _: 'sendMessage',
      chat_id: chatId,
      input_message_content: { _: 'inputMessageText', text: { _: 'formattedText', text: 'DELETE_TEST_RACE' } },
    })
    log(`sendMessage("DELETE_TEST_RACE") -> temporary id ${initial.id}, deleting immediately`)
    const raceDeleted = waitForUpdate(client, 15000, 'updateDeleteMessages for race test', (update) =>
      update._ === 'updateDeleteMessages' && update.chat_id === chatId ? update : undefined,
    )
    try {
      await client.invoke({ _: 'deleteMessages', chat_id: chatId, message_ids: [initial.id], revoke: true })
      log('deleteMessages on temporary id succeeded')
    } catch (err) {
      log('deleteMessages on temporary id failed:', err instanceof Error ? err.message : String(err))
    }
    const raceObservation = await raceDeleted.catch((err: Error) => {
      log('race scenario: no updateDeleteMessages observed -', err.message)
      return null
    })
    if (raceObservation) log('race scenario updateDeleteMessages (raw):', JSON.stringify(raceObservation))
  } catch (err) {
    log('race scenario failed (non-fatal for this spike):', err instanceof Error ? err.message : String(err))
  }

  log('=== Restart check message ===')
  const restart = await sendTestMessage(client, chatId, 'DELETE_TEST_RESTART')
  await deleteAndObserve(client, chatId, [restart.messageId], true)
  await tryGetMessage(client, chatId, restart.messageId)

  log(
    `phase1 done. For the restart check, run: node dist/delete-experiment.js phase2 ${chatId} ${restart.messageId}`,
  )
}

async function runPhase2(client: Client, chatId: number, messageId: number): Promise<void> {
  log(`Checking post-restart availability of chatId=${chatId} messageId=${messageId}`)
  await tryGetMessage(client, chatId, messageId)

  log('Listening for any further updates for 5s after a fresh startup...')
  const seen: string[] = []
  const onUpdate = (update: { _: string }) => {
    if (update._ === 'updateAuthorizationState') return
    seen.push(update._)
  }
  client.on('update', onUpdate)
  await new Promise((resolve) => setTimeout(resolve, 5000))
  client.removeListener('update', onUpdate)
  log(`Update types observed in that window: ${seen.length ? seen.join(', ') : '(none)'}`)
}

async function main(): Promise<void> {
  const mode = process.argv[2]
  if (mode !== 'phase1' && mode !== 'phase2') {
    console.error('Usage: node dist/delete-experiment.js phase1 | phase2 <chatId> <messageId>')
    process.exit(1)
  }

  const client = createClient(CONTEXT)
  client.on('error', (err) => log('client error event:', err instanceof Error ? err.message : String(err)))
  client.on('update', (update) => {
    if (update._ === 'updateAuthorizationState') {
      log(`authorizationState -> ${update.authorization_state._}`)
    }
  })

  await resumeExistingSession(client, CONTEXT)
  log('authorizationStateReady confirmed (session reused, no re-authorization)')

  try {
    if (mode === 'phase1') {
      await runPhase1(client, targetChatId())
    } else {
      const chatId = Number(process.argv[3])
      const messageId = Number(process.argv[4])
      if (!Number.isFinite(chatId) || !Number.isFinite(messageId)) {
        throw new Error('phase2 requires <chatId> <messageId> printed at the end of phase1')
      }
      await runPhase2(client, chatId, messageId)
    }
  } finally {
    await client.close()
    log('client closed')
  }
}

main().catch((err) => {
  console.error(`[${CONTEXT}] failed:`, err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
