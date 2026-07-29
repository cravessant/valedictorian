import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  connectorCheckpoints,
  connectorCaptureWork,
  connectorInstances,
  connectorRuns,
  connectorSchedules,
  sourceExecutionScopes,
  sourceExecutionSessions,
} from '../../../../db/schema'
import {
  createPgliteClient,
  createPgliteDatabase,
  type PgliteClient,
  type PgliteDatabase,
} from '../../../../db/pglite'
import { DEFAULT_WORKSPACE_ID } from '../../../../db/workspaces.schema'
import { prepareConfiguredPgliteDataPath } from '../../../../test/pglite-template'
import { createPgliteTestOwner } from '../../../../test/pglite-test-owner'
import { retireConnectorInstance } from './connector-retirement.persistence'

const clients = new Set<PgliteClient>()
const dataDirectories = new Set<string>()
const CREATED_AT = '2026-07-13T12:00:00.000Z'
const RETIRED_AT = '2026-07-13T16:00:00.000Z'

afterEach(async () => {
  await Promise.all([...clients].map((client) => client.close()))
  clients.clear()
  for (const directory of dataDirectories) {
    fs.rmSync(directory, { force: true, recursive: true })
  }
  dataDirectories.clear()
})

describe('connector retirement persistence on PGlite', () => {
  it('atomically retires owned work, preserves lineage, and survives close/reopen', async () => {
    const dataDir = createDataDirectory()
    let client = await openClient(dataDir)
    let database = createPgliteDatabase(client)
    const fixture = await seedRetirementFixture(database, 'durable')

    await expect(retireConnectorInstance(database, fixture.connectorInstanceId, RETIRED_AT))
      .resolves.toMatchObject({
        connectorInstanceId: fixture.connectorInstanceId,
        lifecycle: 'retired',
        retiredAt: RETIRED_AT,
        disposition: {
          authReferences: 'removed',
          checkpoints: 'preserved',
          configuration: 'removed',
          executionScopes: 'preserved',
          futureExecution: 'blocked',
          schedule: 'removed',
          secretValues: 'preserved_for_workspace_secret_administration',
        },
      })

    await closeClient(client)
    client = await openClient(dataDir)
    database = createPgliteDatabase(client)

    const [instance] = await database.select().from(connectorInstances)
      .where(eq(connectorInstances.id, fixture.connectorInstanceId)).limit(1)
    expect(instance).toMatchObject({
      authJson: '[]',
      configJson: '{}',
      filtersJson: '{}',
      earliestBackfillDate: null,
      enabled: false,
      updatedAt: RETIRED_AT,
      deletedAt: RETIRED_AT,
    })

    const [schedule] = await database.select().from(connectorSchedules)
      .where(eq(connectorSchedules.id, fixture.scheduleId)).limit(1)
    expect(schedule).toMatchObject({ updatedAt: RETIRED_AT, deletedAt: RETIRED_AT })

    for (const workId of fixture.workIds) {
      const [work] = await database.select().from(connectorCaptureWork)
        .where(eq(connectorCaptureWork.id, workId)).limit(1)
      expect(work).toMatchObject({
        status: 'cancelled', nextEligibleAt: null, acquisitionToken: null,
        claimedAt: null, updatedAt: RETIRED_AT,
      })
    }

    const [scope] = await database.select().from(sourceExecutionScopes)
      .where(eq(sourceExecutionScopes.id, fixture.executionScopeId)).limit(1)
    expect(scope).toMatchObject({
      actionReason: 'connector_retired',
      blockedUntil: null,
      refreshLeaseExpiresAt: null,
      refreshLeaseToken: null,
      status: 'action_required',
      updatedAt: RETIRED_AT,
    })
    expect(await database.select().from(sourceExecutionSessions)
      .where(eq(sourceExecutionSessions.executionScopeId, fixture.executionScopeId)))
      .toEqual([])

    const [preservedRun] = await database.select().from(connectorRuns)
      .where(eq(connectorRuns.id, fixture.runId)).limit(1)
    const [preservedCheckpoint] = await database.select().from(connectorCheckpoints)
      .where(eq(connectorCheckpoints.connectorInstanceId, fixture.connectorInstanceId)).limit(1)
    expect(preservedRun?.deletedAt).toBeNull()
    expect(preservedCheckpoint?.deletedAt).toBeNull()
  })

  it('rejects retirement while queued or running work is active without partial cleanup', async () => {
    const { database } = await createDatabase()
    const fixture = await seedRetirementFixture(database, 'active', { runStatus: 'running' })

    await expect(retireConnectorInstance(database, fixture.connectorInstanceId, RETIRED_AT))
      .rejects.toMatchObject({
        activeRuns: [{ connectorRunId: fixture.runId, status: 'running' }],
        cancellationRequired: true,
        code: 'connector_retirement_active_work_conflict',
        connectorInstanceId: fixture.connectorInstanceId,
        statusCode: 409,
      })

    const [instance] = await database.select().from(connectorInstances)
      .where(eq(connectorInstances.id, fixture.connectorInstanceId)).limit(1)
    const [schedule] = await database.select().from(connectorSchedules)
      .where(eq(connectorSchedules.id, fixture.scheduleId)).limit(1)
    const [scope] = await database.select().from(sourceExecutionScopes)
      .where(eq(sourceExecutionScopes.id, fixture.executionScopeId)).limit(1)
    const [session] = await database.select().from(sourceExecutionSessions)
      .where(eq(sourceExecutionSessions.executionScopeId, fixture.executionScopeId)).limit(1)
    expect(instance).toMatchObject({ enabled: true, deletedAt: null })
    expect(schedule?.deletedAt).toBeNull()
    expect(scope).toMatchObject({ status: 'refreshing', actionReason: 'refreshing_credentials' })
    expect(session?.encryptedSession).toBe('encrypted-session')
  })

  it('returns not found for missing and already-retired instances', async () => {
    const { database } = await createDatabase()
    await expect(retireConnectorInstance(database, 'missing-connector', RETIRED_AT))
      .rejects.toMatchObject({ statusCode: 404 })

    const fixture = await seedRetirementFixture(database, 'repeat')
    await retireConnectorInstance(database, fixture.connectorInstanceId, RETIRED_AT)
    await expect(retireConnectorInstance(database, fixture.connectorInstanceId, RETIRED_AT))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('rolls back every mutation when a late cleanup operation fails', async () => {
    const { client, database } = await createDatabase()
    const fixture = await seedRetirementFixture(database, 'rollback')
    await client.exec(`
      create function reject_retirement_session_delete() returns trigger as $$
      begin
        raise exception 'injected retirement failure';
      end;
      $$ language plpgsql;
      create trigger reject_retirement_session_delete
        before delete on source_execution_sessions
        for each row execute function reject_retirement_session_delete();
    `)

    await expect(retireConnectorInstance(database, fixture.connectorInstanceId, RETIRED_AT))
      .rejects.toMatchObject({ cause: { message: 'injected retirement failure' } })

    const [instance] = await database.select().from(connectorInstances)
      .where(eq(connectorInstances.id, fixture.connectorInstanceId)).limit(1)
    const [schedule] = await database.select().from(connectorSchedules)
      .where(eq(connectorSchedules.id, fixture.scheduleId)).limit(1)
    const [work] = await database.select().from(connectorCaptureWork)
      .where(eq(connectorCaptureWork.id, fixture.workIds[0])).limit(1)
    const [scope] = await database.select().from(sourceExecutionScopes)
      .where(eq(sourceExecutionScopes.id, fixture.executionScopeId)).limit(1)
    const [session] = await database.select().from(sourceExecutionSessions)
      .where(eq(sourceExecutionSessions.executionScopeId, fixture.executionScopeId)).limit(1)
    expect(instance).toMatchObject({ enabled: true, deletedAt: null })
    expect(schedule?.deletedAt).toBeNull()
    expect(work).toMatchObject({ status: 'scheduled', nextEligibleAt: '2026-07-13T12:01:00.000Z' })
    expect(scope).toMatchObject({ status: 'refreshing', actionReason: 'refreshing_credentials' })
    expect(session?.encryptedSession).toBe('encrypted-session')
  })

  it('allows only one concurrent retirement to win and converges on one tombstone', async () => {
    const { database } = await createDatabase()
    const fixture = await seedRetirementFixture(database, 'concurrent')

    const results = await Promise.allSettled([
      retireConnectorInstance(database, fixture.connectorInstanceId, RETIRED_AT),
      retireConnectorInstance(database, fixture.connectorInstanceId, RETIRED_AT),
    ])

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    const rejection = results.find(({ status }) => status === 'rejected')
    expect(rejection).toMatchObject({ status: 'rejected', reason: { statusCode: 404 } })
    const [instance] = await database.select().from(connectorInstances)
      .where(eq(connectorInstances.id, fixture.connectorInstanceId)).limit(1)
    expect(instance).toMatchObject({ deletedAt: RETIRED_AT, enabled: false })
  })
})

async function createDatabase() {
  const { client, database } = await createPgliteTestOwner()
  clients.add(client)
  return { client, database }
}

async function openClient(dataDir: string) {
  const client = await createPgliteClient({ dataDir })
  clients.add(client)
  return client
}

async function closeClient(client: PgliteClient) {
  clients.delete(client)
  await client.close()
}

function createDataDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'connector-retirement-pglite-'))
  dataDirectories.add(directory)
  prepareConfiguredPgliteDataPath(directory)
  return directory
}

async function seedRetirementFixture(
  database: PgliteDatabase,
  suffix: string,
  options: { runStatus?: 'completed' | 'queued' | 'running' } = {},
) {
  const connectorInstanceId = `connector-${suffix}`
  const executionScopeId = `scope_retirement_${suffix}`
  const runId = `run-${suffix}`
  const scheduleId = `schedule-${suffix}`
  const workIds = [`capture-work-${suffix}`]
  const runStatus = options.runStatus ?? 'completed'

  await database.insert(sourceExecutionScopes).values({
    id: executionScopeId,
    status: 'refreshing',
    blockedUntil: CREATED_AT,
    backoffAttempt: 2,
    authGeneration: 1,
    refreshLeaseToken: 'refresh-token',
    refreshLeaseExpiresAt: '2026-07-13T18:00:00.000Z',
    actionReason: 'refreshing_credentials',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  })
  await database.insert(connectorInstances).values({
    id: connectorInstanceId,
    executionScopeId,
    connectorId: 'fixture.jobs',
    connectorVersion: '1.0.0',
    displayName: 'Retirement fixture',
    enabled: true,
    authJson: JSON.stringify([{ id: 'fixture', mode: 'api_key', secretKey: 'fixture-secret' }]),
    configJson: JSON.stringify({ pageSize: 20 }),
    filtersJson: JSON.stringify({ role: 'intern' }),
    earliestBackfillDate: '2026-07-01',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  })
  await database.insert(sourceExecutionSessions).values({
    executionScopeId,
    encryptedSession: 'encrypted-session',
    authGeneration: 1,
    updatedAt: CREATED_AT,
  })
  await database.insert(connectorRuns).values({
    id: runId,
    executionScopeId,
    connectorInstanceId,
    mode: 'manual',
    status: runStatus,
    startedAt: CREATED_AT,
    completedAt: runStatus === 'completed' ? '2026-07-13T12:05:00.000Z' : null,
    coverageStartedAt: CREATED_AT,
    coverageEndedAt: CREATED_AT,
    configJson: '{}',
    filtersJson: '{}',
    filterSignature: 'filters:{}',
    observationCount: 0,
    warningCount: 0,
    statsJson: '{}',
    warningsJson: '[]',
    retryHintsJson: 'null',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  })
  await database.insert(connectorCheckpoints).values({
    connectorInstanceId,
    filterSignature: 'filters:{}',
    checkpointJson: '{}',
    schemaVersion: 'fixture@1',
    coverageStartedAt: CREATED_AT,
    coverageEndedAt: CREATED_AT,
    savedAt: CREATED_AT,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  })
  await database.insert(connectorSchedules).values({
    id: scheduleId,
    connectorInstanceId,
    revision: `revision-${suffix}`,
    state: 'enabled',
    cadenceJson: JSON.stringify({ kind: 'interval', everyMinutes: 60 }),
    timezone: 'UTC',
    nextEligibleAt: '2026-07-13T17:00:00.000Z',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  })
  await database.insert(connectorCaptureWork).values([
    {
      id: workIds[0],
      workspaceId: DEFAULT_WORKSPACE_ID,
      idempotencyKey: `capture-work:${suffix}`,
      connectorInstanceId,
      filterSignature: 'filters:{}',
      checkpointSchemaVersion: 'fixture@1',
      checkpointGeneration: '1',
      failureReason: 'network_interruption',
      attempt: 1,
      maxAttempts: 3,
      lastAttemptAt: CREATED_AT,
      computedDelayMs: 1_000,
      nextEligibleAt: '2026-07-13T12:01:00.000Z',
      horizonAt: '2026-07-14T12:00:00.000Z',
      status: 'scheduled',
      ownerVersion: '1.0.0',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
  ])

  return { connectorInstanceId, executionScopeId, workIds, runId, scheduleId }
}
