/**
 * Canonical Application module input validation + result primitives (issue #302,
 * consolidated #389).
 *
 * Used by application.aggregate.service.ts and composed by the Opportunity→Application
 * promotion. Lifecycle ids, bounded JSON and command actors are admitted by the shared
 * representation constructors, rebound here onto `ApplicationInputError`. Link and
 * event bounds, the status vocabulary and the links cardinality limit are
 * Application-owned and stay local.
 */
import { type LifecycleActorInput, type LifecycleActorType, admitBoundedJson, admitCommandActor, admitLifecycleId, owning } from '../lifecycle/lifecycle-representation'
import { pursuitApplicationStatuses } from '../../db/lifecycle-vocabulary'

export { LIFECYCLE_AUDIT_MAX as AUDIT_MAX, LIFECYCLE_ID_MAX as WORKSPACE_MAX, LIFECYCLE_SNAPSHOT_MAX as SNAPSHOT_MAX, actorAuditJson as auditJson, isUniqueViolation, safeParseJson as safeParse } from '../lifecycle/lifecycle-representation'
export type { AdmittedCommandActor, BoundedJson, JsonValue, LifecycleId } from '../lifecycle/lifecycle-representation'

export type ApplicationActorType = LifecycleActorType
export type ApplicationStatus = (typeof pursuitApplicationStatuses)[number]

/** Untrusted actor as it arrives on an Application command. */
export type ApplicationActor = LifecycleActorInput

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

export const DISPLAY_MAX = 500
export const LINK_KIND_MAX = 100
export const LINK_LABEL_MAX = 200
/** Application-owned: links are admitted as trimmed nonempty text bounded to 4,096, not as URLs. */
export const LINK_URL_MAX = 4_096
export const EVENT_TYPE_MAX = 100
export const SUMMARY_MAX = 2_000
export const TIMESTAMP_MAX = 100
export const LINKS_LIMIT = 100

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

export const requireId = owning(admitLifecycleId, ApplicationInputError)
export const boundedJson = owning(admitBoundedJson, ApplicationInputError)
export const requireActor = owning(admitCommandActor, ApplicationInputError)

/** Application-owned free text: company/source display, link kind/label/url, event fields. */
export function requireText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new ApplicationInputError('invalid_input', `${field} must be a string`)
  const trimmed = value.trim()
  if (trimmed.length < min) throw new ApplicationInputError('invalid_input', `${field} must not be empty`)
  if (trimmed.length > max) {
    throw new ApplicationInputError('bounded_data_violation', `${field} exceeds ${max} characters`)
  }
  return trimmed
}

export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null
  return requireText(value, field, 1, max)
}

/** Application-owned status vocabulary. */
export function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ApplicationInputError('invalid_input', `${field} is invalid`)
  }
  return value as T
}
