import type { AuthorizationState } from '../../../shared/models/authorization'
import { mapAuthorizationState } from '../types'

/**
 * Wraps the existing raw-discriminant mapping (`src/main/tdlib/types.ts`,
 * Task 04) in the shared `AuthorizationState` domain shape. No new mapping
 * logic: `AuthorizationStatus` in `src/shared/models/authorization.ts`
 * mirrors the tdlib-layer union member-for-member, so this never needs a
 * cast to reconcile the two.
 */
export function mapTdlibAuthorizationStateToDomain(raw: string): AuthorizationState {
  return { status: mapAuthorizationState(raw) }
}
