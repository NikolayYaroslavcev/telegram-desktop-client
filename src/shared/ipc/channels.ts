/**
 * Every IPC channel name used anywhere in the app, defined exactly once.
 * Main (handler registration) and preload (contextBridge calls) both import
 * this instead of writing string literals, so the two sides can never drift
 * apart on a channel name.
 */
export const IPC_CHANNELS = {
  appGetAppInfo: 'app:get-app-info',

  authGetState: 'auth:get-state',
  authSetPhoneNumber: 'auth:set-phone-number',
  authCheckCode: 'auth:check-code',
  authCheckPassword: 'auth:check-password',

  chatsList: 'chats:list',
  chatsOpen: 'chats:open',

  networkGetState: 'network:get-state',

  messagesGetHistory: 'messages:get-history',
  messagesSendText: 'messages:send-text',
  messagesSendAttachment: 'messages:send-attachment',
  messagesSelectAttachmentFile: 'messages:select-attachment-file',
  messagesDownloadAttachment: 'messages:download-attachment',
  messagesOpenAttachment: 'messages:open-attachment',

  eventsAuthStateChanged: 'events:auth-state-changed',
  eventsAuthInputRejected: 'events:auth-input-rejected',
  eventsAuthFlowTerminated: 'events:auth-flow-terminated',
  eventsNewMessage: 'events:new-message',
  eventsMessageDeleted: 'events:message-deleted',
  eventsMessageSendFailed: 'events:message-send-failed',
  eventsNetworkStateChanged: 'events:network-state-changed',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
