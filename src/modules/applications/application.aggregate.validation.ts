/**
 * Shared input validation + result primitives for the canonical Application module
 * (issue #302). Used by application.aggregate.service.ts and composed by the
 * Opportunity→Application promotion so both paths share ONE implementation of
 * bounds, forbidden-key, vocabulary, and audit-payload validation — mirrors the
 * Job/Opportunity validation seams (job.validation.ts / opportunity.validation.ts).
 */
import { lifecycleActorTypes, pursuitApplicationStatuses } from '../../db/lifecycle-vocabulary'
import { SENSITIVE_KEY_SUBSTRINGS } from '../../db/sensitive-keys'

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type ApplicationActorType = (typeof lifecycleActorTypes)[number]
export type ApplicationStatus = (typeof pursuitApplicationStatuses)[number]

export interface ApplicationActor {
  readonly type: ApplicationActorType
  readonly id?: string | null
}

export type ApplicationFailureCode =
  | 'invalid_input'
  | 'bounded_data_violation'
  | 'security_violation'
  | 'not_found'
  | 'missing_lineage'
  | 'revision_conflict'
  | 'deterministic_duplicate'
  | 'dependent_choice_required'
  | 'links_limit_exceeded'

export interface ApplicationFailure {
  readonly ok: false
  readonly code: ApplicationFailureCode
  readonly message: string
}

export const WORKSPACE_MAX = 200
export const AUDIT_MAX = 16_384
export const SNAPSHOT_MAX = 262_144
export const DISPLAY_MAX = 500
export const LINK_KIND_MAX = 100
export const LINK_LABEL_MAX = 200
export const LINK_URL_MAX = 4_096
export const EVENT_TYPE_MAX = 100
export const SUMMARY_MAX = 2_000
export const TIMESTAMP_MAX = 100
export const LINKS_LIMIT = 100

const FORBIDDEN_KEY_REGEX = new RegExp(`"[^"]*(?:${SENSITIVE_KEY_SUBSTRINGS})[^"]*"[\\t\\n\\r ]*:`, 'i')

export class ApplicationInputError extends Error {
  constructor(
    readonly code: ApplicationFailureCode,
    message: string,
  ) {
    super(message)
    this.name = 'ApplicationInputError'
  }
}

export function fail(code: ApplicationFailureCode, message: string): ApplicationFailure {
  return { ok: false, code, message }
}

export function requireText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new ApplicationInputError('invalid_input', `${field} must be a string`)
  const trimmed = value.trim()
  if (trimmed.length < min) throw new ApplicationInputError('invalid_input', `${field} must not be empty`)
  if (trimmed.length > max) throw new ApplicationInputError('bounded_data_violation', `${field} exceeds ${max} characters`)
  return trimmed
}

export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null
  return requireText(value, field, 1, max)
}

export function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ApplicationInputError('invalid_input', `${field} is invalid`)
  }
  return value as T
}

export function boundedJson(value: JsonValue, field: string, max: number): string {
  let serialized: string
  try {
    serialized = JSON.stringify(value ?? null)
  } catch {
    throw new ApplicationInputError('invalid_input', `${field} is not serializable JSON`)
  }
  if (serialized.length > max) throw new ApplicationInputError('bounded_data_violation', `${field} exceeds ${max} bytes`)
  if (FORBIDDEN_KEY_REGEX.test(serialized)) {
    throw new ApplicationInputError('security_violation', `${field} contains a forbidden sensitive key`)
  }
  return serialized
}

export function requireActor(actor: unknown): ApplicationActor {
  if (typeof actor !== 'object' || actor === null) throw new ApplicationInputError('invalid_input', 'actor is required')
  const type = (actor as { type?: unknown }).type
  if (typeof type !== 'string' || !(lifecycleActorTypes as readonly string[]).includes(type)) {
    throw new ApplicationInputError('invalid_input', 'actor.type is invalid')
  }
  const id = optionalText((actor as { id?: unknown }).id, 'actor.id', WORKSPACE_MAX)
  const resolved: ApplicationActor = { type: type as ApplicationActorType, id }
  boundedJson({ actor: { type: resolved.type, id: resolved.id ?? null } }, 'actor', AUDIT_MAX)
  return resolved
}

export function auditJson(actor: ApplicationActor): string {
  return JSON.stringify({ actor: { type: actor.type, id: actor.id ?? null } })
}

export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const record = error as { code?: unknown; cause?: { code?: unknown }; message?: unknown }
  if (record.code === '23505' || record.cause?.code === '23505') return true
  const message = typeof record.message === 'string' ? record.message : ''
  return /duplicate key value|unique constraint/i.test(message)
}

export function safeParse(text: string | null): JsonValue {
  if (text === null) return null
  try {
    return JSON.parse(text) as JsonValue
  } catch {
    return null
  }
}
