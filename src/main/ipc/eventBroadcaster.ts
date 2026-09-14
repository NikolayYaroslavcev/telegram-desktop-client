import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc'
import type { AuthorizationState, Message } from '../../shared/models'
import type {
  AuthInputRejectedEvent,
  MessageDeletedEvent,
  MessageSendFailedEvent,
  NetworkState,
} from '../../shared/ipc'

/**
 * Typed push side of the events contract: the only way main code may reach
 * into a renderer is by calling one of these methods, each bound to exactly
 * one fixed channel. There is no generic "send(channel, payload)" here.
 *
 * `authStateChanged`, `authInputRejected`, and `authFlowTerminated` have
 * real producers, wired to `TdlibService.onUpdate` in `src/main/index.ts`
 * (Task 04's authorization tracking, extended by Task 07.1 for the
 * `retry`-confirmed rejection and dead-flow signals - see
 * docs/tdlib-integration.md, "Retry semantics"). `newMessage`/
 * `messageDeleted`/`messageSendFailed`/`networkStateChanged` exist as
 * typed, callable infrastructure for Tasks 11/12.1/16/17.
 */
export interface IpcEventBroadcaster {
  authStateChanged(state: AuthorizationState): void
  authInputRejected(event: AuthInputRejectedEvent): void
  authFlowTerminated(): void
  newMessage(message: Message): void
  messageDeleted(event: MessageDeletedEvent): void
  messageSendFailed(event: MessageSendFailedEvent): void
  networkStateChanged(state: NetworkState): void
}

export function createEventBroadcaster(getWindows: () => BrowserWindow[]): IpcEventBroadcaster {
  function send(channel: string, payload: unknown): void {
    for (const window of getWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, payload)
      }
    }
  }

  return {
    authStateChanged: (state) => send(IPC_CHANNELS.eventsAuthStateChanged, state),
    authInputRejected: (event) => send(IPC_CHANNELS.eventsAuthInputRejected, event),
    authFlowTerminated: () => send(IPC_CHANNELS.eventsAuthFlowTerminated, null),
    newMessage: (message) => send(IPC_CHANNELS.eventsNewMessage, message),
    messageDeleted: (event) => send(IPC_CHANNELS.eventsMessageDeleted, event),
    messageSendFailed: (event) => send(IPC_CHANNELS.eventsMessageSendFailed, event),
    networkStateChanged: (state) => send(IPC_CHANNELS.eventsNetworkStateChanged, state),
  }
}
