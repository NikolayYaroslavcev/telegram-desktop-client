import { IpcHandlerError } from '../../shared/ipc'
import type { AttachmentType } from '../../shared/models'

/**
 * Minimal runtime guards for IPC handler arguments. TypeScript types are
 * compile-time only - anything an attacker-controlled or buggy renderer
 * sends over `ipcRenderer.invoke` arrives as untyped `unknown` at this
 * boundary, so every handler validates before touching the backend.
 */

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new IpcHandlerError('INVALID_ARGUMENT', `"${field}" must be a string`)
  }
  return value
}

/**
 * Like `requireString`, but also rejects `""` and whitespace-only strings -
 * a message with no visible content is treated as empty for this purpose
 * (see docs/plan.md Task 12, "whitespace-only text"). The original,
 * untrimmed string is returned: this only decides whether to reject, it
 * never mutates what the caller actually sends.
 */
export function requireNonEmptyString(value: unknown, field: string): string {
  const text = requireString(value, field)
  if (text.trim().length === 0) {
    throw new IpcHandlerError('INVALID_ARGUMENT', `"${field}" must not be empty`)
  }
  return text
}

export function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new IpcHandlerError('INVALID_ARGUMENT', `"${field}" must be a finite number`)
  }
  return value
}

export function optionalFiniteNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  return requireFiniteNumber(value, field)
}

/** Like `optionalFiniteNumber`, but additionally rejects negative and non-integer values - for TDLib message ids. */
export function optionalNonNegativeInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new IpcHandlerError('INVALID_ARGUMENT', `"${field}" must be a non-negative integer`)
  }
  return value
}

/** Same rule as `optionalNonNegativeInteger`, but the value is required - for a `messageId` naming one specific message. */
export function requireNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new IpcHandlerError('INVALID_ARGUMENT', `"${field}" must be a non-negative integer`)
  }
  return value
}

/** `undefined` stays `undefined`; anything present must be a real boolean, never a truthy/falsy stand-in. */
export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new IpcHandlerError('INVALID_ARGUMENT', `"${field}" must be a boolean`)
  }
  return value
}

const ATTACHMENT_TYPES: ReadonlySet<AttachmentType> = new Set(['photo', 'document'])

/** Rejects anything but the exact two attachment kinds this app supports - never a raw TDLib content type. */
export function requireAttachmentType(value: unknown, field: string): AttachmentType {
  if (typeof value !== 'string' || !ATTACHMENT_TYPES.has(value as AttachmentType)) {
    throw new IpcHandlerError('INVALID_ARGUMENT', `"${field}" must be "photo" or "document"`)
  }
  return value as AttachmentType
}
