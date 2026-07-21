/**
 * Lifecycle removal / restore result serialization (issue #304, stage 3).
 *
 * Maps the removal orchestration's domain results onto the sparxie
 * `RemovalResult` / `RestoreResult` contracts, and classifies domain failures
 * onto the HTTP surface. Pure: timestamps and (for the blocked case) dependent
 * ids are supplied by the caller, which re-reads the target head row after the
 * operation and re-queries dependents — the orchestration output carries neither
 * (ratified #304: no Stage-2 orchestration change for a serialization need).
 *
 * Contract mapping decisions (ratified #304):
 *  - A `reject_if_dependents` (or `dependent_choice_required`) that cannot proceed
 *    → `blocked` with `blocker.code = 'impossible_state'`, the dependent ids, and
 *    the three non-reject choices as `supportedChoices`.
 *  - `not_found` has no `RemovalResult` status → HTTP 404 (the typed client's
 *    ValedictorianHttpError is the correct surface for a nonexistent target).
 *  - Restore is target-only by design, so every reported still-tombstoned
 *    dependent maps to `remained_tombstoned`; `remained_unlinked` / `restored`
 *    legitimately never occur in #304.
 */
import type { LifecycleActor, RemovalChoice, RemovalResult, RestoreResult } from 'sparxie'
import { toLifecycleAudit, toLifecycleBlocker } from './lifecycle-audit.dto'
import type {
  RemovalFailure,
  RemoveLifecycleResult,
  RestoreLifecycleResult,
} from './removal.orchestration'

/** The three strategies offered when a `reject_if_dependents` removal is blocked. */
export const DEPENDENT_RESOLUTION_CHOICES: readonly RemovalChoice[] = [
  'preserve_historical_lineage',
  'unlink_dependents',
  'cascade_tombstone',
]

/** How a removal/restore domain failure maps onto the HTTP surface. */
export type RemovalHttpFailure =
  | { readonly surface: 'blocked' }
  | { readonly surface: 'not_found' }
  | { readonly surface: 'error'; readonly status: number; readonly code: string }

/**
 * Classify a domain removal/restore failure. `blocked` failures still return a
 * 200 body (a `RemovalResult`/`RestoreResult` with `status:'blocked'`); the rest
 * are non-2xx so the typed client raises a ValedictorianHttpError.
 */
export function classifyRemovalFailure(failure: RemovalFailure): RemovalHttpFailure {
  switch (failure.code) {
    case 'dependents_present':
    case 'dependent_choice_required':
      return { surface: 'blocked' }
    case 'not_found':
      return { surface: 'not_found' }
    case 'revision_conflict':
    case 'deterministic_duplicate':
      return { surface: 'error', status: 409, code: failure.code }
    case 'bounded_data_violation':
    case 'invalid_input':
      return { surface: 'error', status: 400, code: failure.code }
    default:
      return { surface: 'error', status: 400, code: failure.code }
  }
}

export interface RemovalSuccessContext {
  readonly removedAt: string
  readonly actor: LifecycleActor
}

/** Serialize a successful tombstone into a `RemovalResult` with status `removed`. */
export function toRemovedResult(
  result: Extract<RemoveLifecycleResult, { ok: true }>,
  context: RemovalSuccessContext,
): RemovalResult {
  const affectedDependentIds = [
    ...result.tombstoned.filter((ref) => ref.id !== result.resourceId).map((ref) => ref.id),
    ...result.unlinked.map((ref) => ref.id),
  ]
  return {
    status: 'removed',
    id: result.resourceId,
    choice: result.choice,
    removedAt: context.removedAt,
    affectedDependentIds,
    audit: toLifecycleAudit(context.actor, context.removedAt),
  }
}

export interface RemovalBlockedContext {
  readonly id: string
  readonly message: string
  readonly dependentIds: readonly string[]
  readonly supportedChoices?: readonly RemovalChoice[]
}

/** Serialize a dependents-present block into a `RemovalResult` with status `blocked`. */
export function toBlockedRemovalResult(context: RemovalBlockedContext): RemovalResult {
  return {
    status: 'blocked',
    id: context.id,
    blocker: toLifecycleBlocker({ code: 'impossible_state', message: context.message }),
    supportedChoices: [...(context.supportedChoices ?? DEPENDENT_RESOLUTION_CHOICES)],
    dependentIds: [...context.dependentIds],
  }
}

export interface RestoreSuccessContext {
  readonly restoredAt: string
  readonly actor: LifecycleActor
}

/** Serialize a successful restore into a `RestoreResult` with status `restored`. */
export function toRestoredResult(
  result: Extract<RestoreLifecycleResult, { ok: true }>,
  context: RestoreSuccessContext,
): RestoreResult {
  return {
    status: 'restored',
    id: result.resourceId,
    restoredAt: context.restoredAt,
    // Restore is target-only: any dependent that stayed tombstoned is reported as
    // remained_tombstoned. remained_unlinked / restored never occur in #304.
    dependentLinks: result.remainedTombstoned.map((ref) => ({
      dependentId: ref.id,
      state: 'remained_tombstoned' as const,
    })),
    audit: toLifecycleAudit(context.actor, context.restoredAt),
  }
}

export interface RestoreBlockedContext {
  readonly id: string
  readonly message: string
  readonly code?: 'impossible_state'
}

/** Serialize a restore block (e.g. a nonexistent or conflicted target reported as blocked). */
export function toBlockedRestoreResult(context: RestoreBlockedContext): RestoreResult {
  return {
    status: 'blocked',
    id: context.id,
    blocker: toLifecycleBlocker({ code: context.code ?? 'impossible_state', message: context.message }),
  }
}
