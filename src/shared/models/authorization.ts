/**
 * Mirrors `AuthorizationStatus` from `src/main/tdlib/types.ts` field-for-field.
 * Deliberately duplicated rather than imported: `src/shared` must stay usable
 * from the renderer without pulling in anything under `src/main/tdlib`, so a
 * future backend swap only touches the mapper, never this type.
 */
export type AuthorizationStatus =
  | 'waitTdlibParameters'
  | 'waitEncryptionKey'
  | 'waitPhoneNumber'
  | 'waitEmailAddress'
  | 'waitEmailCode'
  | 'waitCode'
  | 'waitOtherDeviceConfirmation'
  | 'waitRegistration'
  | 'waitPassword'
  | 'ready'
  | 'loggingOut'
  | 'closing'
  | 'closed'
  | 'unknown'

export interface AuthorizationState {
  status: AuthorizationStatus
}
