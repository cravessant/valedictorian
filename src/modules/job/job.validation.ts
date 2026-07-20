/**
 * Shared input validation + result primitives for the Job module (issue #300).
 *
 * Used by job.service.ts (core CRUD/versioning) and job.identity.ts (external
 * identities, conflicts, attach/merge) so both paths share ONE implementation of
 * bounds, forbidden-key, and audit-payload validation — no forked semantics.
 */
import { lifecycleActorTypes } from '../../db/lifecycle-vocabulary'
import { SENSITIVE_KEY_SUBSTRINGS } from '../../db/sensitive-keys'

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type JobActorType = (typeof lifecycleActorTypes)[number]

export interface JobActor {
  readonly type: JobActorType
  readonly id?: string | null
}

export type JobFailureCode =
  | 'invalid_input'
  | 'bounded_data_violation'
  | 'security_violation'
  | 'not_found'
  | 'revision_conflict'
  | 'strong_identity_conflict'

export interface JobFailure {
  readonly ok: false
  readonly code: JobFailureCode
  readonly message: string
}

export const WORKSPACE_MAX = 200
export const AUDIT_MAX = 16_384

const FORBIDDEN_KEY_REGEX = new RegExp(`"[^"]*(?:${SENSITIVE_KEY_SUBSTRINGS})[^"]*"[\\t\\n\\r ]*:`, 'i')

export class JobInputError extends Error {
  constructor(
    readonly code: JobFailureCode,
    message: string,
  ) {
    super(message)
    this.name = 'JobInputError'
  }
}

export function fail(code: JobFailureCode, message: string): JobFailure {
  return { ok: false, code, message }
}

export function requireText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new JobInputError('invalid_input', `${field} must be a string`)
  const trimmed = value.trim()
  if (trimmed.length < min) throw new JobInputError('invalid_input', `${field} must not be empty`)
  if (trimmed.length > max) throw new JobInputError('bounded_data_violation', `${field} exceeds ${max} characters`)
  return trimmed
}

export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null
  return requireText(value, field, 1, max)
}

export function boundedJson(value: JsonValue, field: string, max: number): string {
  let serialized: string
  try {
    serialized = JSON.stringify(value ?? null)
  } catch {
    throw new JobInputError('invalid_input', `${field} is not serializable JSON`)
  }
  if (serialized.length > max) throw new JobInputError('bounded_data_violation', `${field} exceeds ${max} bytes`)
  if (FORBIDDEN_KEY_REGEX.test(serialized)) {
    throw new JobInputError('security_violation', `${field} contains a forbidden sensitive key`)
  }
  return serialized
}

export function requireActor(actor: unknown): JobActor {
  if (typeof actor !== 'object' || actor === null) throw new JobInputError('invalid_input', 'actor is required')
  const type = (actor as { type?: unknown }).type
  if (typeof type !== 'string' || !(lifecycleActorTypes as readonly string[]).includes(type)) {
    throw new JobInputError('invalid_input', 'actor.type is invalid')
  }
  const id = optionalText((actor as { id?: unknown }).id, 'actor.id', WORKSPACE_MAX)
  const resolved: JobActor = { type: type as JobActorType, id }
  // audit_json carries a forbidden-key + bound CHECK: validate the exact payload up
  // front so a crafted actor.id returns a typed failure, never a raw DB error mid-tx.
  boundedJson({ actor: { type: resolved.type, id: resolved.id ?? null } }, 'actor', AUDIT_MAX)
  return resolved
}

export function auditJson(actor: JobActor): string {
  return JSON.stringify({ actor: { type: actor.type, id: actor.id ?? null } })
}

export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const record = error as { code?: unknown; cause?: { code?: unknown }; message?: unknown }
  if (record.code === '23505' || record.cause?.code === '23505') return true
  const message = typeof record.message === 'string' ? record.message : ''
  return /duplicate key value|unique constraint/i.test(message)
}

export function safeParse(text: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue
  } catch {
    return null
  }
}
