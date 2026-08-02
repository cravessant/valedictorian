/**
 * Opportunity module input validation + result primitives (issue #301, consolidated #389).
 *
 * Used by opportunity.service.ts (user-controlled CRUD, correction, re-evaluation,
 * disposition) and composed by the Job→Opportunity promotion orchestration. Lifecycle
 * ids, bounded JSON and command actors are admitted by the shared representation
 * constructors, rebound here onto `OpportunityInputError`. The evaluation vocabulary,
 * rank bound and override rationale bound are Opportunity-owned and stay local.
 */
import { type LifecycleActorInput, type LifecycleActorType, admitBoundedJson, admitCommandActor, admitLifecycleId, owning } from '../lifecycle/lifecycle-representation.js'
import { opportunityCutoffStates, opportunityDispositions, opportunityFitStates } from '../../db/lifecycle-vocabulary.js'

export { LIFECYCLE_AUDIT_MAX as AUDIT_MAX, LIFECYCLE_ID_MAX as WORKSPACE_MAX, LIFECYCLE_SNAPSHOT_MAX as SNAPSHOT_MAX, actorAuditJson as auditJson, isUniqueViolation, safeParseJson as safeParse } from '../lifecycle/lifecycle-representation.js'
export type { AdmittedCommandActor, BoundedJson, JsonValue, LifecycleId } from '../lifecycle/lifecycle-representation.js'

export type OpportunityActorType = LifecycleActorType
export type OpportunityFit = (typeof opportunityFitStates)[number]
export type OpportunityCutoff = (typeof opportunityCutoffStates)[number]
export type OpportunityDisposition = (typeof opportunityDispositions)[number]

/** Untrusted actor as it arrives on an Opportunity command. */
export type OpportunityActor = LifecycleActorInput

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

export const OVERRIDE_MAX = 16_384
/** Opportunity-owned: the app's warning-override rationale bound and CHECK are 2,000. */
export const RATIONALE_MAX = 2_000
export const RANK_MAX = 1_000_000

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

export const requireId = owning(admitLifecycleId, OpportunityInputError)
export const boundedJson = owning(admitBoundedJson, OpportunityInputError)
export const requireActor = owning(admitCommandActor, OpportunityInputError)

/** Opportunity-owned free text: the override rationale and actor display fields. */
export function requireText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new OpportunityInputError('invalid_input', `${field} must be a string`)
  const trimmed = value.trim()
  if (trimmed.length < min) throw new OpportunityInputError('invalid_input', `${field} must not be empty`)
  if (trimmed.length > max) {
    throw new OpportunityInputError('bounded_data_violation', `${field} exceeds ${max} characters`)
  }
  return trimmed
}

export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null
  return requireText(value, field, 1, max)
}

/** Opportunity-owned evaluation vocabulary (fit / cutoff / disposition). */
export function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new OpportunityInputError('invalid_input', `${field} is invalid`)
  }
  return value as T
}

/** Opportunity-only: no other aggregate carries a ranked shortlist position. */
export function optionalRank(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new OpportunityInputError('invalid_input', `${field} must be an integer`)
  }
  if (value < 1) throw new OpportunityInputError('invalid_input', `${field} must be positive`)
  if (value > RANK_MAX) throw new OpportunityInputError('bounded_data_violation', `${field} exceeds ${RANK_MAX}`)
  return value
}
