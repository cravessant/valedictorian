/**
 * Lifecycle representation admission (issue #389).
 *
 * Three fixed-purpose constructors shared by the Capture, Job, Opportunity and
 * Application aggregates, each returning an OPAQUE trusted value so a persistence
 * -facing core can demand an admitted value instead of an indistinguishable string.
 * There is deliberately no shared free-text, enum, url, instant, rank or bound
 * constructor — those are aggregate-owned, and `BoundedJson`'s maximum is a phantom
 * type parameter supplied by the caller, not a policy this module decides.
 *
 * Constructors raise `LifecycleRepresentationError`; each aggregate rebinds them once
 * through `owning(...)` so failures keep that module's error class, code and message.
 */
import { LIFECYCLE_ID_MAX_LENGTH, lifecycleActorTypes } from '../../db/lifecycle-vocabulary'
import { SENSITIVE_KEY_SUBSTRINGS } from '../../db/sensitive-keys'

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type LifecycleRepresentationCode = 'invalid_input' | 'bounded_data_violation' | 'security_violation'

export class LifecycleRepresentationError extends Error {
  constructor(readonly code: LifecycleRepresentationCode, message: string) {
    super(message)
    this.name = 'LifecycleRepresentationError'
  }
}

/** Rebind a constructor to the owning module's error class, preserving its signature. */
export function owning<F extends (...args: never[]) => unknown>(
  construct: F,
  OwnerError: new (code: LifecycleRepresentationCode, message: string) => Error,
): F {
  return ((...args: never[]) => {
    try {
      return construct(...args)
    } catch (error) {
      if (error instanceof LifecycleRepresentationError) throw new OwnerError(error.code, error.message)
      throw error
    }
  }) as F
}

declare const lifecycleId: unique symbol
declare const boundedJson: unique symbol
declare const commandActor: unique symbol

/** Workspace, resource and actor ids all share the contract's 1..200 bound. */
export type LifecycleId = string & { readonly [lifecycleId]: true }
export const LIFECYCLE_ID_MAX = LIFECYCLE_ID_MAX_LENGTH

export function admitLifecycleId(value: unknown, field: string): LifecycleId {
  if (typeof value !== 'string') throw new LifecycleRepresentationError('invalid_input', `${field} must be a string`)
  const trimmed = value.trim()
  if (trimmed.length < 1) throw new LifecycleRepresentationError('invalid_input', `${field} must not be empty`)
  if (trimmed.length > LIFECYCLE_ID_MAX) {
    throw new LifecycleRepresentationError('bounded_data_violation', `${field} exceeds ${LIFECYCLE_ID_MAX} characters`)
  }
  return trimmed as LifecycleId
}

/** Serialized JSON that carries the bound it was admitted at. */
export type BoundedJson<Max extends number> = string & { readonly [boundedJson]: Max }

/** Every lifecycle history snapshot CHECK; every audit_json CHECK. */
export const LIFECYCLE_SNAPSHOT_MAX = 262_144
export const LIFECYCLE_AUDIT_MAX = 16_384

const SENSITIVE_JSON_KEY_REGEX = new RegExp(`"[^"]*(?:${SENSITIVE_KEY_SUBSTRINGS})[^"]*"[\\t\\n\\r ]*:`, 'i')

/** Shared with the sanitizers that DROP optional detail rather than fail a command. */
export function containsSensitiveJsonKey(serialized: string): boolean {
  return SENSITIVE_JSON_KEY_REGEX.test(serialized)
}

export function admitBoundedJson<Max extends number>(value: JsonValue, field: string, max: Max): BoundedJson<Max> {
  let serialized: string
  try {
    serialized = JSON.stringify(value ?? null)
  } catch {
    throw new LifecycleRepresentationError('invalid_input', `${field} is not serializable JSON`)
  }
  if (serialized.length > max) {
    throw new LifecycleRepresentationError('bounded_data_violation', `${field} exceeds ${max} bytes`)
  }
  if (containsSensitiveJsonKey(serialized)) {
    throw new LifecycleRepresentationError('security_violation', `${field} contains a forbidden sensitive key`)
  }
  return serialized as BoundedJson<Max>
}

export type LifecycleActorType = (typeof lifecycleActorTypes)[number]

/** Untrusted actor as it arrives on a command. */
export interface LifecycleActorInput {
  readonly type: LifecycleActorType
  readonly id?: string | null
}

/**
 * The only trusted actor type, produced by `admitCommandActor` and nothing else — no
 * in-process cast enters this brand, so an audit port cannot receive an actor whose id
 * was never bounded. Internally originated audit writers (capture materialization,
 * company backfill) serialize a different envelope into different columns.
 */
export type AdmittedCommandActor = {
  readonly type: LifecycleActorType
  /** Null is the app's long-standing "the type IS the identity" case; see #304. */
  readonly id: LifecycleId | null
} & { readonly [commandActor]: true }

export function admitCommandActor(actor: unknown): AdmittedCommandActor {
  if (typeof actor !== 'object' || actor === null) {
    throw new LifecycleRepresentationError('invalid_input', 'actor is required')
  }
  const type = (actor as { type?: unknown }).type
  if (typeof type !== 'string' || !(lifecycleActorTypes as readonly string[]).includes(type)) {
    throw new LifecycleRepresentationError('invalid_input', 'actor.type is invalid')
  }
  const rawId = (actor as { id?: unknown }).id
  const id = rawId === undefined || rawId === null ? null : admitLifecycleId(rawId, 'actor.id')
  const admitted = Object.freeze({ type: type as LifecycleActorType, id }) as AdmittedCommandActor
  // audit_json carries a forbidden-key + bound CHECK: validate the exact payload up
  // front so a crafted actor.id returns a typed failure, never a raw DB error mid-tx.
  actorAuditJson(admitted)
  return admitted
}

export function actorAuditJson(actor: AdmittedCommandActor): BoundedJson<typeof LIFECYCLE_AUDIT_MAX> {
  return admitBoundedJson({ actor: { type: actor.type, id: actor.id } }, 'actor', LIFECYCLE_AUDIT_MAX)
}

// Operational utilities below. NOT admitted representations: they neither parse
// untrusted input into a trusted type nor carry any persistence guarantee.

export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const record = error as { code?: unknown; cause?: { code?: unknown }; message?: unknown }
  if (record.code === '23505' || record.cause?.code === '23505') return true
  const message = typeof record.message === 'string' ? record.message : ''
  return /duplicate key value|unique constraint/i.test(message)
}

/** Lenient read of persisted JSON; returns null on unreadable text and validates nothing. */
export function safeParseJson(text: string | null): JsonValue {
  if (text === null) return null
  try {
    return JSON.parse(text) as JsonValue
  } catch {
    return null
  }
}
