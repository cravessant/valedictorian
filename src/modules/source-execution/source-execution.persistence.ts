/**
 * The source-execution owner operations other capabilities call (issue #491).
 *
 * Every function joins the caller's open unit of work, so an execution scope is
 * created, admitted, released, or retired inside the same transaction as the
 * capability work it belongs to, and rolls back with it.
 */
import { and, eq, lte } from 'drizzle-orm'
import { sourceExecutionScopes, sourceExecutionSessions } from '../../db/schema'
import type { PgliteDatabase } from '../../db/pglite'

/** The transaction object Drizzle hands the `database.transaction` callback. */
export type SourceExecutionTransaction =
  Parameters<Parameters<PgliteDatabase['transaction']>[0]>[0]

/**
 * The caller's open transaction, narrowed to the statements these operations issue
 * plus `rollback`.
 *
 * `rollback` exists only on a callback transaction, so a root database is not
 * assignable and the caller cannot hand one over by mistake. `transaction` is left
 * out, so an owner operation cannot open a nested one either. Both are pinned in
 * source-execution.persistence.type-boundary.ts.
 */
export type SourceExecutionUnitOfWork =
  Pick<SourceExecutionTransaction, 'delete' | 'insert' | 'rollback' | 'select' | 'update'>

export type SourceExecutionAdmission =
  | { admitted: true }
  | { admitted: false; blocker: 'action_required' }
  | { admitted: false; blocker: 'cooling_down'; retryAt: string }

/**
 * Creates the scope if it is absent. Never overwrites cooldown, generation, lease,
 * or timestamp state an existing scope already carries.
 */
export async function ensureSourceExecutionScope(
  unitOfWork: SourceExecutionUnitOfWork,
  scopeId: string,
  createdAt: string,
): Promise<void> {
  await unitOfWork.insert(sourceExecutionScopes).values({
    id: scopeId, createdAt, updatedAt: createdAt, deletedAt: null,
  }).onConflictDoNothing()
}

/**
 * Releases a cooldown whose deadline has passed, in one conditional statement so
 * the recheck is atomic. A cooldown with no deadline never elapses and is left as
 * it is.
 *
 * Owner-private: releasing without reading the verdict back would let a caller keep
 * work on a scope that is unavailable for some other reason, so a caller reaches
 * this only through `admitSourceExecutionScope`.
 */
async function releaseElapsedSourceExecutionCooldown(
  unitOfWork: SourceExecutionUnitOfWork,
  scopeId: string,
  now: string,
): Promise<void> {
  await unitOfWork.update(sourceExecutionScopes).set({
    status: 'available', blockedUntil: null, backoffAttempt: 0, updatedAt: now,
  }).where(and(
    eq(sourceExecutionScopes.id, scopeId),
    eq(sourceExecutionScopes.status, 'cooldown'),
    lte(sourceExecutionScopes.blockedUntil, now),
  ))
}

/**
 * Releases an elapsed cooldown and reports whether the scope may execute now.
 *
 * The scope row is locked for the rest of the caller's transaction, so the verdict
 * stays true for the work the caller goes on to do: no other transaction can block,
 * lease, or retire the scope in between. That lock is what lets a caller act on the
 * verdict alone instead of restating the availability rule in its own predicates.
 *
 * A scope that does not exist is not admitted and is reported as cooling down: the
 * caller cannot act on it as an authentication problem.
 */
export async function admitSourceExecutionScope(
  unitOfWork: SourceExecutionUnitOfWork,
  scopeId: string,
  now: string,
): Promise<SourceExecutionAdmission> {
  await releaseElapsedSourceExecutionCooldown(unitOfWork, scopeId, now)
  const [scope] = await unitOfWork
    .select({
      blockedUntil: sourceExecutionScopes.blockedUntil,
      status: sourceExecutionScopes.status,
    })
    .from(sourceExecutionScopes)
    .where(eq(sourceExecutionScopes.id, scopeId))
    .limit(1)
    .for('update')

  if (scope === undefined) {
    return { admitted: false, blocker: 'cooling_down', retryAt: now }
  }
  if (scope.status === 'action_required' || scope.status === 'refreshing') {
    return { admitted: false, blocker: 'action_required' }
  }
  return scope.blockedUntil === null || scope.blockedUntil <= now
    ? { admitted: true }
    : { admitted: false, blocker: 'cooling_down', retryAt: scope.blockedUntil }
}

/**
 * Blocks the scope from further execution and drops its session. The scope row and
 * its lineage stay, and a scope with nothing left to clear is not an error.
 */
export async function retireSourceExecutionScope(
  unitOfWork: SourceExecutionUnitOfWork,
  scopeId: string,
  retiredAt: string,
): Promise<void> {
  await unitOfWork.update(sourceExecutionScopes).set({
    status: 'action_required',
    blockedUntil: null,
    refreshLeaseToken: null,
    refreshLeaseExpiresAt: null,
    actionReason: 'connector_retired',
    updatedAt: retiredAt,
  }).where(eq(sourceExecutionScopes.id, scopeId))
  await unitOfWork.delete(sourceExecutionSessions).where(
    eq(sourceExecutionSessions.executionScopeId, scopeId),
  )
}
