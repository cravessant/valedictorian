/**
 * Shared input validation + result primitives for the Opportunity module (issue #301).
 *
 * Used by opportunity.service.ts (user-controlled CRUD, correction, re-evaluation,
 * disposition) and composed by the Job→Opportunity promotion orchestration, so both
 * paths share ONE implementation of bounds, forbidden-key, evaluation-vocabulary, and
 * audit-payload validation — no forked semantics. Mirrors the Job module's validation
 * seam (src/modules/job/job.validation.ts).
 */
import {
  lifecycleActorTypes,
  opportunityCutoffStates,
  opportunityDispositions,
  opportunityFitStates,
} from '../../db/lifecycle-vocabulary'
import { SENSITIVE_KEY_SUBSTRINGS } from '../../db/sensitive-keys'

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type OpportunityActorType = (typeof lifecycleActorTypes)[number]
export type OpportunityFit = (typeof opportunityFitStates)[number]
export type OpportunityCutoff = (typeof opportunityCutoffStates)[number]
export type OpportunityDisposition = (typeof opportunityDispositions)[number]

export interface OpportunityActor {
  readonly type: OpportunityActorType
  readonly id?: string | null
}

export type OpportunityFailureCode =
  | 'invalid_input'
  | 'bounded_data_violation'
  | 'security_violation'
  | 'not_found'
  | 'missing_lineage'
  | 'revision_conflict'
  | 'deterministic_duplicate'

export interface OpportunityFailure {
  readonly ok: false
  readonly code: OpportunityFailureCode
  readonly message: string
}

export const WORKSPACE_MAX = 200
export const AUDIT_MAX = 16_384
export const OVERRIDE_MAX = 16_384
export const RATIONALE_MAX = 2_000
export const RANK_MAX = 1_000_000

const FORBIDDEN_KEY_REGEX = new RegExp(`"[^"]*(?:${SENSITIVE_KEY_SUBSTRINGS})[^"]*"[\\t\\n\\r ]*:`, 'i')

export class OpportunityInputError extends Error {
  constructor(
    readonly code: OpportunityFailureCode,
    message: string,
  ) {
    super(message)
    this.name = 'OpportunityInputError'
  }
}

export function fail(code: OpportunityFailureCode, message: string): OpportunityFailure {
  return { ok: false, code, message }
}

export function requireText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new OpportunityInputError('invalid_input', `${field} must be a string`)
  const trimmed = value.trim()
  if (trimmed.length < min) throw new OpportunityInputError('invalid_input', `${field} must not be empty`)
  if (trimmed.length > max) throw new OpportunityInputError('bounded_data_violation', `${field} exceeds ${max} characters`)
  return trimmed
}

export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null
  return requireText(value, field, 1, max)
}

export function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new OpportunityInputError('invalid_input', `${field} is invalid`)
  }
  return value as T
}

export function optionalRank(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new OpportunityInputError('invalid_input', `${field} must be an integer`)
  }
  if (value < 1) throw new OpportunityInputError('invalid_input', `${field} must be positive`)
  if (value > RANK_MAX) throw new OpportunityInputError('bounded_data_violation', `${field} exceeds ${RANK_MAX}`)
  return value
}

export function boundedJson(value: JsonValue, field: string, max: number): string {
  let serialized: string
  try {
    serialized = JSON.stringify(value ?? null)
  } catch {
    throw new OpportunityInputError('invalid_input', `${field} is not serializable JSON`)
  }
  if (serialized.length > max) throw new OpportunityInputError('bounded_data_violation', `${field} exceeds ${max} bytes`)
  if (FORBIDDEN_KEY_REGEX.test(serialized)) {
    throw new OpportunityInputError('security_violation', `${field} contains a forbidden sensitive key`)
  }
  return serialized
}

export function requireActor(actor: unknown): OpportunityActor {
  if (typeof actor !== 'object' || actor === null) throw new OpportunityInputError('invalid_input', 'actor is required')
  const type = (actor as { type?: unknown }).type
  if (typeof type !== 'string' || !(lifecycleActorTypes as readonly string[]).includes(type)) {
    throw new OpportunityInputError('invalid_input', 'actor.type is invalid')
  }
  const id = optionalText((actor as { id?: unknown }).id, 'actor.id', WORKSPACE_MAX)
  const resolved: OpportunityActor = { type: type as OpportunityActorType, id }
  // audit_json carries a forbidden-key + bound CHECK: validate the exact payload up
  // front so a crafted actor.id returns a typed failure, never a raw DB error mid-tx.
  boundedJson({ actor: { type: resolved.type, id: resolved.id ?? null } }, 'actor', AUDIT_MAX)
  return resolved
}

export function auditJson(actor: OpportunityActor): string {
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
