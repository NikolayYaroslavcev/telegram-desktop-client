import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC_CHANNELS,
  deserializeIpcError,
  type AppInfo,
  type DownloadedAttachment,
  type ElectronAPI,
  type SelectedAttachmentFile,
  type Unsubscribe,
} from '../shared/ipc'

/**
 * The only bridge between renderer and main. Whitelist-based on purpose:
 * exactly the methods/events in `ElectronAPI`, each backed by exactly one
 * fixed IPC channel. No `ipcRenderer`, no generic `send()`/`invoke()`/`on()`
 * passthrough, no Node/Electron module is exposed to the renderer beyond
 * this file's own two small internal helpers below.
 */

/**
 * Invokes a fixed channel and unwraps the `{ code, message }` a handler
 * error was serialized as (see `shared/ipc/errors.ts`), so the renderer
 * never has to know about that wire format - just a rejected Promise whose
 * `Error.name` is the IPC error code.
 */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const ipcError = deserializeIpcError(message)
    if (ipcError) {
      const wrapped = new Error(ipcError.message)
      wrapped.name = ipcError.code
      throw wrapped
    }
    throw new Error('Unexpected IPC error')
  }
}

/**
 * Builds a typed `on...()` subscriber bound to one fixed channel. Renderer
 * never gets `ipcRenderer.on` itself - only the resulting function, which
 * returns an unsubscribe that removes exactly the listener it added.
 */
function subscribe<T>(channel: string): (cb: (payload: T) => void) => Unsubscribe {
  return (cb: (payload: T) => void): Unsubscribe => {
    const listener = (_event: IpcRendererEvent, payload: T): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

const electronAPI: ElectronAPI = {
  getAppInfo: (): Promise<AppInfo> => invoke(IPC_CHANNELS.appGetAppInfo),

  auth: {
    getState: () => invoke(IPC_CHANNELS.authGetState),
    setPhoneNumber: (phone) => invoke(IPC_CHANNELS.authSetPhoneNumber, phone),
    checkCode: (code) => invoke(IPC_CHANNELS.authCheckCode, code),
    checkPassword: (password) => invoke(IPC_CHANNELS.authCheckPassword, password),
  },

  chats: {
    list: () => invoke(IPC_CHANNELS.chatsList),
    open: (chatId) => invoke(IPC_CHANNELS.chatsOpen, chatId),
  },

  network: {
    getState: () => invoke(IPC_CHANNELS.networkGetState),
  },

  messages: {
    getHistory: (chatId, fromMessageId, forceRefresh) =>
      invoke(IPC_CHANNELS.messagesGetHistory, chatId, fromMessageId, forceRefresh),
    sendText: (chatId, text, replyToMessageId) =>
      invoke(IPC_CHANNELS.messagesSendText, chatId, text, replyToMessageId),
    sendAttachment: (chatId, filePath, replyToMessageId) =>
      invoke(IPC_CHANNELS.messagesSendAttachment, chatId, filePath, replyToMessageId),
    selectAttachmentFile: (type): Promise<SelectedAttachmentFile | null> =>
      invoke(IPC_CHANNELS.messagesSelectAttachmentFile, type),
    downloadAttachment: (chatId, messageId): Promise<DownloadedAttachment> =>
      invoke(IPC_CHANNELS.messagesDownloadAttachment, chatId, messageId),
    openAttachment: (chatId, messageId) =>
      invoke(IPC_CHANNELS.messagesOpenAttachment, chatId, messageId),
  },

  events: {
    onAuthStateChanged: subscribe(IPC_CHANNELS.eventsAuthStateChanged),
    onAuthInputRejected: subscribe(IPC_CHANNELS.eventsAuthInputRejected),
    onAuthFlowTerminated: subscribe(IPC_CHANNELS.eventsAuthFlowTerminated),
    onNewMessage: subscribe(IPC_CHANNELS.eventsNewMessage),
    onMessageDeleted: subscribe(IPC_CHANNELS.eventsMessageDeleted),
    onMessageSendFailed: subscribe(IPC_CHANNELS.eventsMessageSendFailed),
    onNetworkStateChanged: subscribe(IPC_CHANNELS.eventsNetworkStateChanged),
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
