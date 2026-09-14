/**
 * Payload types for main -> renderer events that aren't already covered by
 * an existing domain model (`AuthorizationState`, `Message`).
 */

/** Mirrors TDLib's `connectionState._` discriminants, minus the prefix. */
export type NetworkStatus =
  'waitingForNetwork' | 'connectingToProxy' | 'connecting' | 'updating' | 'ready' | 'unknown'

export interface NetworkState {
  status: NetworkStatus
}

/**
 * `onMessageDeleted` fires per deleted message id, not a full `Message` -
 * the tombstone (Task 16) already has the cached text locally and only
 * needs to know which message to mark, and when.
 */
export interface MessageDeletedEvent {
  chatId: number
  messageId: number
  deletedAt: number
}

/**
 * `onMessageSendFailed` fires once per outgoing message TDLib could not
 * deliver (`updateMessageSendFailed`), after its temporary local row has
 * already been removed from storage (see
 * `src/main/messages/realtimeUpdates.ts`). `messageId` is that temporary
 * id - TDLib's own `old_message_id` - the only identity a failed send ever
 * has; there is no final id to report.
 *
 * Deliberately carries no TDLib error code/message: the renderer never
 * needs more than "this send did not go through" (Task 12.1 closes the
 * technical debt of the renderer getting no signal at all, it does not add
 * delivery-status/retry semantics), and passing TDLib's raw `error` object
 * through would leak internal detail this boundary must never expose - see
 * docs/tdlib-integration.md, "Failed sends".
 */
export interface MessageSendFailedEvent {
  chatId: number
  messageId: number
}

/** The three prompts a `setPhoneNumber`/`checkCode`/`checkPassword` submission can be waiting on. */
export type AuthInputStep = 'phone' | 'code' | 'password'

/**
 * Fires when TDLib itself (via `tdl`'s `retry` argument - see
 * docs/tdlib-integration.md, "Retry semantics") has confirmed the previously
 * submitted phone/code/password was rejected. Carries only which step was
 * rejected - never the submitted value, a TDLib error code, or raw error
 * text.
 */
export interface AuthInputRejectedEvent {
  step: AuthInputStep
}
