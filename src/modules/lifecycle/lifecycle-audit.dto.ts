/**
 * Shared lifecycle audit / actor / blocker serialization (issue #304, stage 3).
 *
 * Cross-aggregate serialization helpers used by every capture/job/opportunity/
 * application result mapper. Pure: no policy, no IO. These translate persisted
 * domain shapes into the strict sparxie audit/blocker contracts.
 *
 * Actor id convention (ratified #304): the domain records actor id as nullable
 * (system/agent actors are commonly stored without an id), but the contract
 * requires a non-empty id. When no id was recorded the actor's `type` IS its
 * identity, so `toContractActor` surfaces the type as the id rather than
 * fabricating an identifier.
 */
import type { LifecycleActor, LifecycleAuditEvidence, LifecycleBlocker, LifecycleBlockerCode } from '@sparxie/sdk'

const ACTOR_TYPES = new Set(['user', 'agent', 'system'])

/** Map a persisted lifecycle actor onto the strict sparxie `LifecycleActor`. */
export function toContractActor(raw: unknown): LifecycleActor {
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    id?: unknown
    type?: unknown
    displayName?: unknown
  }
  const type = (typeof record.type === 'string' && ACTOR_TYPES.has(record.type)
    ? record.type
    : 'system') as LifecycleActor['type']
  const id = typeof record.id === 'string' && record.id.trim().length > 0 ? record.id : type
  return typeof record.displayName === 'string' && record.displayName.trim().length > 0
    ? { id, type, displayName: record.displayName }
    : { id, type }
}

/** Build the minimal lifecycle audit envelope (actor + timestamp) from a live actor. */
export function toLifecycleAudit(actor: unknown, timestamp: string): LifecycleAuditEvidence {
  return { actor: toContractActor(actor), timestamp }
}

/** Build the minimal audit envelope from a stored `{actor:{...}}` audit JSON string. */
export function toLifecycleAuditFromJson(auditJson: string, timestamp: string): LifecycleAuditEvidence {
  let parsed: unknown = null
  try {
    parsed = JSON.parse(auditJson)
  } catch {
    parsed = null
  }
  const actorSource = typeof parsed === 'object' && parsed !== null
    ? (parsed as { actor?: unknown }).actor
    : null
  return toLifecycleAudit(actorSource, timestamp)
}

export interface LifecycleBlockerInput {
  readonly code: LifecycleBlockerCode
  readonly message: string
  readonly field?: string
  readonly conflictingResourceId?: string
  readonly allowedDuplicateResolutions?: readonly ('attach' | 'merge')[]
}

/** Assemble a strict sparxie `LifecycleBlocker`, omitting absent optional keys. */
export function toLifecycleBlocker(input: LifecycleBlockerInput): LifecycleBlocker {
  const blocker: {
    code: LifecycleBlockerCode
    message: string
    field?: string
    conflictingResourceId?: string
    allowedDuplicateResolutions?: ('attach' | 'merge')[]
  } = { code: input.code, message: input.message }
  if (input.field !== undefined) blocker.field = input.field
  if (input.conflictingResourceId !== undefined) blocker.conflictingResourceId = input.conflictingResourceId
  if (input.allowedDuplicateResolutions !== undefined) {
    blocker.allowedDuplicateResolutions = [...input.allowedDuplicateResolutions]
  }
  return blocker
}
