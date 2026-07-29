import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { connectorCaptureWork, connectorRuns } from './connector.schema'
import { sourceExecutionScopes } from '../../../../db/schema'
import type { PgliteClient, PgliteDatabase } from '../../../../db/pglite'
import { createPgliteTestOwner } from '../../../../test/pglite-test-owner'
import { createPgliteConnectorRepository } from './connector.repository'
import { completedConnectorRefreshContract } from '../../public/connector.refresh-result.test-helpers'

const BASE = '2026-07-11T12:00:00.000Z'
const ELAPSED = '2026-07-11T12:00:30.000Z'
const DUE = '2026-07-11T12:01:00.000Z'
const LATER = '2026-07-11T13:00:00.000Z'

/** Scope states a trigger can leave behind, keyed by what the second admission owes. */
const RELEASED = { status: 'cooldown', blockedUntil: `'${ELAPSED}'`, backoffAttempt: 3 }
const OPEN_COOLDOWN = { status: 'cooldown', blockedUntil: 'null', backoffAttempt: 5 }
const UNAVAILABLE = [
  ['a cooldown that has not elapsed', { status: 'cooldown', blockedUntil: `'${LATER}'`, backoffAttempt: 4 }],
  ['action_required', { status: 'action_required', blockedUntil: 'null', backoffAttempt: 4 }],
  ['refreshing', { status: 'refreshing', blockedUntil: 'null', backoffAttempt: 4 }],
] as const

/**
 * The window between admission and the retry-work claim.
 *
 * The scope row lock admission takes keeps other transactions out of that window,
 * but the connector transaction's own writes still land in it, so the claim is only
 * tentative until the scope is admitted a second time. These tests drive the window
 * with a trigger on the synchronization insert that precedes the claim, which is the
 * one place inside the transaction where the scope can still move.
 */
describe('connector retry claim readmission', () => {
  it('keeps the claim and releases a cooldown that elapsed inside the window', async () => {
    const { client, database } = await createPgliteTestOwner()
    const scopeId = await seedClaimableWork(database, 'late-cooldown')
    await moveScopeOnSynchronizationInsert(client, scopeId, RELEASED)

    const request = await recordRun(database, 'late-cooldown')

    expect(request).toMatchObject({ acquired: true, acquiredWork: { kind: 'connector_capture' } })
    await expect(readScope(database, scopeId)).resolves.toMatchObject({
      status: 'available', blockedUntil: null, backoffAttempt: 0,
    })
    const [work] = await database.select().from(connectorCaptureWork)
    expect(work).toMatchObject({ status: 'claimed', acquisitionRunId: request.run.id })
  })

  it('keeps the claim without resetting a cooldown that has no deadline', async () => {
    const { client, database } = await createPgliteTestOwner()
    const scopeId = await seedClaimableWork(database, 'open-cooldown')
    await moveScopeOnSynchronizationInsert(client, scopeId, OPEN_COOLDOWN)

    const request = await recordRun(database, 'open-cooldown')

    expect(request).toMatchObject({ acquired: true, acquiredWork: { kind: 'connector_capture' } })
    await expect(readScope(database, scopeId)).resolves.toMatchObject({
      status: 'cooldown', blockedUntil: null, backoffAttempt: 5,
    })
    const [work] = await database.select().from(connectorCaptureWork)
    expect(work).toMatchObject({ status: 'claimed', acquisitionRunId: request.run.id })
  })

  /**
   * The claim is undone rather than kept, and the run still persists as queued with
   * no acquired work — what a claim predicate that matched nothing used to leave.
   */
  it.each(UNAVAILABLE)('undoes the claim when the window leaves %s', async (label, moved) => {
    const { client, database } = await createPgliteTestOwner()
    const connectorInstanceId = `unavailable-${label.replace(/\s/g, '-')}`
    const scopeId = await seedClaimableWork(database, connectorInstanceId)
    const [before] = await database.select().from(connectorCaptureWork)
    await moveScopeOnSynchronizationInsert(client, scopeId, moved)

    const request = await recordRun(database, connectorInstanceId)

    expect(request).toMatchObject({ acquired: true, acquiredWork: null, run: { status: 'queued' } })
    const [work] = await database.select().from(connectorCaptureWork)
    expect(work).toEqual(before)
    await expect(readScope(database, scopeId)).resolves.toMatchObject({
      status: moved.status, backoffAttempt: moved.backoffAttempt,
    })
  })

  it.each([
    ['the readmission', `
      create function reject_readmission() returns trigger as $$
      begin raise exception 'injected readmission failure'; end;
      $$ language plpgsql;
      create trigger reject_readmission after update on source_execution_scopes
      for each row when (new.status = 'available' and old.backoff_attempt = 3)
      execute function reject_readmission();
    `, RELEASED, 'injected readmission failure'],
    ['the restore', `
      create function reject_restore() returns trigger as $$
      begin raise exception 'injected restore failure'; end;
      $$ language plpgsql;
      create trigger reject_restore after update on connector_capture_work
      for each row when (old.status = 'claimed' and new.status = 'scheduled')
      execute function reject_restore();
    `, UNAVAILABLE[1][1], 'injected restore failure'],
  ])('rolls the whole connector transaction back when %s fails', async (_label, trigger, moved, message) => {
    const { client, database } = await createPgliteTestOwner()
    const scopeId = await seedClaimableWork(database, 'failed-readmission')
    const [before] = await database.select().from(connectorCaptureWork)
    await moveScopeOnSynchronizationInsert(client, scopeId, moved)
    await client.exec(trigger)

    await expect(recordRun(database, 'failed-readmission'))
      .rejects.toMatchObject({ cause: { message } })

    await expect(readScope(database, scopeId)).resolves.toMatchObject({
      status: 'cooldown', blockedUntil: null, backoffAttempt: 0,
    })
    const [work] = await database.select().from(connectorCaptureWork)
    expect(work).toEqual(before)
    await expect(database.select().from(connectorRuns)
      .where(eq(connectorRuns.startedAt, DUE))).resolves.toEqual([])
  })

  /**
   * Connectors no longer restates scope availability in the selection and claim
   * predicates, so a scope that is already unavailable must still stop the claim
   * through the first admission verdict alone.
   */
  it.each([
    ['cooling down', { status: 'cooldown', blockedUntil: LATER }],
    ['awaiting action', { status: 'action_required', blockedUntil: null }],
    ['refreshing', { status: 'refreshing', blockedUntil: null }],
  ])('leaves pending retry work unclaimed while the scope is %s', async (label, blocked) => {
    const { database } = await createPgliteTestOwner()
    const connectorInstanceId = `blocked-${label.replace(/\s/g, '-')}`
    const scopeId = await seedClaimableWork(database, connectorInstanceId)
    await database.update(sourceExecutionScopes).set(blocked)
      .where(eq(sourceExecutionScopes.id, scopeId))

    const request = await recordRun(database, connectorInstanceId)

    expect(request).toMatchObject({ acquired: false, acquiredWork: null, run: { status: 'skipped' } })
    const [work] = await database.select().from(connectorCaptureWork)
    expect(work).toMatchObject({ status: 'scheduled', acquisitionRunId: null, claimedAt: null })
  })

  it('admits a cooldown with no deadline without releasing it', async () => {
    const { database } = await createPgliteTestOwner()
    const repository = createPgliteConnectorRepository(database)
    const instance = await repository.upsertInstance(instanceInput('open-admission'))
    await blockScopeWithoutDeadline(database, instance.executionScopeId)

    const request = await repository.recordRunRequest({
      connectorInstanceId: instance.id, mode: 'manual', startedAt: DUE,
    })

    expect(request).toMatchObject({ acquired: true, run: { status: 'queued' } })
    await expect(readScope(database, instance.executionScopeId)).resolves.toMatchObject({
      status: 'cooldown', blockedUntil: null,
    })
  })
})

function instanceInput(id: string) {
  return {
    id, connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
    displayName: id, enabled: true, filters: {}, createdAt: BASE,
  }
}

function recordRun(database: PgliteDatabase, connectorInstanceId: string) {
  return createPgliteConnectorRepository(database).recordRunRequest({
    connectorInstanceId, mode: 'catch_up', startedAt: DUE,
  })
}

function readScope(database: PgliteDatabase, scopeId: string) {
  return database.select().from(sourceExecutionScopes)
    .where(eq(sourceExecutionScopes.id, scopeId)).limit(1)
    .then(([scope]) => scope)
}

/**
 * Leaves the scope in a cooldown with no deadline, which admission accepts and never
 * releases, so any later change came from inside the run request.
 */
async function blockScopeWithoutDeadline(database: PgliteDatabase, scopeId: string) {
  await database.update(sourceExecutionScopes)
    .set({ status: 'cooldown', blockedUntil: null, backoffAttempt: 0 })
    .where(eq(sourceExecutionScopes.id, scopeId))
}

async function seedClaimableWork(database: PgliteDatabase, connectorInstanceId: string) {
  const repository = createPgliteConnectorRepository(database)
  const instance = await repository.upsertInstance(instanceInput(connectorInstanceId))
  await repository.recordRefreshResult({
    connectorInstanceId, mode: 'manual', startedAt: BASE,
    completedAt: '2026-07-11T12:00:01.000Z', config: {}, filters: {},
    filterSignature: 'filters:{}',
    result: {
      ...completedConnectorRefreshContract('2026-07-11'),
      observations: [], warnings: [], stats: { observations: 0 },
      coverage: { start: '2026-07-11T11:00:00.000Z', end: BASE },
      nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-checkpoint@1' },
      retryHints: {
        state: 'scheduled', reason: 'server_failure', attempt: 1, maxAttempts: 3,
        lastAttemptAt: BASE, computedDelayMs: 60_000, nextAttemptAt: DUE,
        horizonAt: LATER,
      },
    },
  })
  await blockScopeWithoutDeadline(database, instance.executionScopeId)
  return instance.executionScopeId
}

/**
 * Fires on the queued run's synchronization insert, which sits between admission and
 * the retry-work claim inside the same transaction.
 */
async function moveScopeOnSynchronizationInsert(
  client: PgliteClient,
  scopeId: string,
  moved: { status: string; blockedUntil: string; backoffAttempt: number },
) {
  await client.exec(`
    create function move_scope() returns trigger as $$
    begin
      update source_execution_scopes
        set status = '${moved.status}', blocked_until = ${moved.blockedUntil},
            backoff_attempt = ${moved.backoffAttempt}
        where id = '${scopeId}';
      return new;
    end;
    $$ language plpgsql;
    create trigger move_scope before insert on connector_run_synchronizations
    for each row execute function move_scope();
  `)
}
