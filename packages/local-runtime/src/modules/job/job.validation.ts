/**
 * Job module input validation + result primitives (issue #300, consolidated #389).
 *
 * Used by job.service.ts (core CRUD/versioning) and job.identity.ts (external
 * identities, conflicts, attach/merge). Lifecycle ids, bounded JSON and command
 * actors are admitted by the shared representation constructors, rebound here so a
 * representation failure is reported as a `JobInputError` with its existing code and
 * message. Job-owned free text (instants, identity values, provider fields) keeps its
 * own bounds and stays local.
 */
import { type LifecycleActorInput, type LifecycleActorType, admitBoundedJson, admitCommandActor, admitLifecycleId, owning } from '../lifecycle/lifecycle-representation.js'

export { LIFECYCLE_AUDIT_MAX as AUDIT_MAX, LIFECYCLE_ID_MAX as WORKSPACE_MAX, LIFECYCLE_SNAPSHOT_MAX as SNAPSHOT_MAX, actorAuditJson as auditJson, isUniqueViolation, safeParseJson as safeParse } from '../lifecycle/lifecycle-representation.js'
export type { AdmittedCommandActor, BoundedJson, JsonValue, LifecycleId } from '../lifecycle/lifecycle-representation.js'

export type JobActorType = LifecycleActorType

/** Untrusted actor as it arrives on a Job command; admitted values are `AdmittedCommandActor`. */
export type JobActor = LifecycleActorInput

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

export const requireId = owning(admitLifecycleId, JobInputError)
export const boundedJson = owning(admitBoundedJson, JobInputError)
export const requireActor = owning(admitCommandActor, JobInputError)

/** Job-owned free text: instants, identity values, provider/account fields. */
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
