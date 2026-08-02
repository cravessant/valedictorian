/**
 * Lifecycle mutation-result serialization (issue #304, stage 3).
 *
 * The shared `mutationResultSchema` factory (sparxie/lifecycle-shared) gives every
 * aggregate the same create/correct/remove-shaped result: a discriminated union of
 * `succeeded` (resource + duplicateResolution + audit) and `blocked` (a lifecycle
 * blocker). These pure mappers, generic over the aggregate resource `T`, translate
 * a Stage-2 service result into that contract. They carry no policy and open no
 * transaction: the service owns validation and mutation, the read-model has already
 * assembled the resource `T`, and this module only re-shapes.
 *
 * Failure classification (ratified #304): the `blocked` body is the sanctioned
 * channel for policy blocks — a 200 response carrying a structured blocker so the
 * client can present remediation. Existence and concurrency are protocol errors,
 * surfaced as non-2xx so the typed client raises a ValedictorianHttpError:
 *  - `not_found`                        → HTTP 404
 *  - `revision_conflict`                → HTTP 409 (optimistic concurrency)
 *  - `evidence_mode_conflict`           → HTTP 409 (immutable field conflict)
 *  - every lifecycle blocker code       → `blocked` body (200) with that code
 *
 * This differs from removal.dto's classifier only because `RemovalResult.blocked`
 * is dependents-specific (impossible_state) rather than a general policy channel;
 * the mutation union has a first-class blocked-with-any-blocker-code surface.
 */
import type {
  DuplicateResolutionDecision,
  LifecycleActor,
  LifecycleAuditEvidence,
  LifecycleBlocker,
  LifecycleBlockerCode,
} from '@sparxie/sdk'
import { lifecycleBlockerCodes } from '@sparxie/sdk'
import { toContractActor, toLifecycleBlocker, type LifecycleBlockerInput } from './lifecycle-audit.dto.js'

/** The branded aggregate id carried by a lifecycle resource `T`. */
type LifecycleResourceId<T> = T extends { readonly id: infer Id } ? Id : never

/**
 * A duplicate-resolution decision whose `targetResourceId` is branded to the
 * resource `T`'s own id type. On a succeeded mutation attach/merge collapses the
 * duplicate onto the returned resource, so every per-aggregate contract brands the
 * target to that aggregate's id. The shared, unbranded `DuplicateResolutionDecision`
 * remains the loose *input* the mappers accept; this is the branded *output* shape.
 */
export interface DuplicateResolutionDecisionFor<T> {
  readonly action: DuplicateResolutionDecision['action']
  readonly targetResourceId: LifecycleResourceId<T>
}

/** The `succeeded` branch of a mutation result, generic over the aggregate resource. */
export interface MutationSucceeded<T> {
  readonly status: 'succeeded'
  readonly resource: T
  readonly duplicateResolution: DuplicateResolutionDecisionFor<T> | null
  readonly audit: LifecycleAuditEvidence
}

/** The `blocked` branch of a mutation result (identical across aggregates). */
export interface MutationBlocked {
  readonly status: 'blocked'
  readonly blocker: LifecycleBlocker
}

export type MutationResult<T> = MutationSucceeded<T> | MutationBlocked

/** Optional non-actor/timestamp audit fields a specific mutation may record. */
export type MutationAuditExtras = Partial<Omit<LifecycleAuditEvidence, 'actor' | 'timestamp'>>

export interface MutationSuccessContext {
  readonly actor: unknown
  readonly timestamp: string
  readonly duplicateResolution?: DuplicateResolutionDecision | null
  readonly audit?: MutationAuditExtras
}

/**
 * Serialize a successful mutation into the `succeeded` body. `resource` is the
 * post-mutation resource the read-model assembled; `audit` is the minimal
 * actor+timestamp envelope, optionally enriched with revision/identity extras.
 */
export function toSucceededMutationResult<T>(
  resource: T,
  context: MutationSuccessContext,
): MutationSucceeded<T> {
  const audit: LifecycleAuditEvidence = {
    actor: toContractActor(context.actor),
    timestamp: context.timestamp,
    ...context.audit,
  }
  return {
    status: 'succeeded',
    resource,
    // Loose input -> branded output: the parsed input already carries this
    // aggregate's branded id (parseInput brands it at the seam), so the brand
    // assertion is truthful and lives here, at the shared mapper source.
    duplicateResolution: (context.duplicateResolution ?? null) as DuplicateResolutionDecisionFor<T> | null,
    audit,
  }
}

/** Serialize a policy block into the `blocked` body. */
export function toBlockedMutationResult(blocker: LifecycleBlockerInput): MutationBlocked {
  return { status: 'blocked', blocker: toLifecycleBlocker(blocker) }
}

/** How a mutation domain failure maps onto the HTTP surface. */
export type MutationHttpFailure =
  | { readonly surface: 'blocked'; readonly code: LifecycleBlockerCode }
  | { readonly surface: 'error'; readonly status: number; readonly code: string }

const BLOCKER_CODES = new Set<string>(lifecycleBlockerCodes)

/**
 * Classify a mutation domain-failure code. Existence/concurrency codes become
 * typed HTTP errors; any lifecycle blocker code becomes a 200 `blocked` body.
 * Unknown codes are conservatively surfaced as a 400 error rather than silently
 * dropped into a blocked body with an unrepresentable code.
 */
export function classifyMutationFailure(code: string): MutationHttpFailure {
  switch (code) {
    case 'not_found':
      return { surface: 'error', status: 404, code }
    case 'revision_conflict':
    case 'evidence_mode_conflict':
      return { surface: 'error', status: 409, code }
    default:
      return BLOCKER_CODES.has(code)
        ? { surface: 'blocked', code: code as LifecycleBlockerCode }
        : { surface: 'error', status: 400, code }
  }
}

export type { LifecycleActor }
