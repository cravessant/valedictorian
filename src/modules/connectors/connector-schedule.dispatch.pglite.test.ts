import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/pglite'
import { schema, sourceExecutionScopes } from '../../db/schema'
import { connectorInstances, connectorRuns } from './connector.schema'
import type { PgliteDatabase } from '../../db/pglite'
import {
  createPgliteTestDatabase,
  useResettablePgliteTestOwner,
} from '../../test/pglite-test-owner'
import { admitConnectorScheduleDue } from './connector-schedule.dispatch'
import { createConnectorScheduleRepository } from './connector-schedule.repository'

const CREATED_AT = '2026-07-18T10:00:00.000Z'
const DUE_AT = '2026-07-18T11:00:00.000Z'
const CADENCE = { kind: 'interval' as const, everyMinutes: 60 }
const resettableOwner = useResettablePgliteTestOwner()

describe.sequential('PGlite connector schedule dispatch', () => {
  it('locks the connector identity shared with manual and retry admission', async () => {
    const owner = resettableOwner()
    const queries: string[] = []
    const database = drizzle(owner.client, {
      schema,
      logger: { logQuery(query) { queries.push(query) } },
    })
    await seedConnectorInstance(database, 'connector-dispatch-identity-lock')
    const repository = createConnectorScheduleRepository(database, () => new Date(CREATED_AT))
    const schedule = await repository.create({
      connectorInstanceId: 'connector-dispatch-identity-lock',
      state: 'enabled', cadence: CADENCE, timezone: 'UTC',
    })
    queries.length = 0

    await admitConnectorScheduleDue({
      database, now: () => new Date(DUE_AT), maximumCatchUpAgeMinutes: 180,
      input: {
        connectorInstanceId: schedule.connectorInstanceId,
        expectedRevision: schedule.revision,
      },
    })

    expect(queries.some((query) => /from "connector_instances"[\s\S]*for update/i.test(query)))
      .toBe(true)
  })

  it('keeps instance-first lock order compatible with retirement through one workspace owner', async () => {
    const owner = resettableOwner()
    const queries: string[] = []
    const database = drizzle(owner.client, {
      schema,
      logger: { logQuery(query) { queries.push(query) } },
    })
    await seedConnectorInstance(database, 'connector-dispatch-retirement-order')
    const scheduleRepository = createConnectorScheduleRepository(
      database,
      () => new Date(CREATED_AT),
    )
    const schedule = await scheduleRepository.create({
      connectorInstanceId: 'connector-dispatch-retirement-order',
      state: 'enabled', cadence: CADENCE, timezone: 'UTC',
    })
    queries.length = 0

    await admitConnectorScheduleDue({
      database,
      now: () => new Date(DUE_AT),
      maximumCatchUpAgeMinutes: 180,
      input: {
        connectorInstanceId: schedule.connectorInstanceId,
        expectedRevision: schedule.revision,
      },
    })

    const connectorLockIndex = queries.findIndex((query) =>
      /from "connector_instances"[\s\S]*for update/i.test(query))
    const scheduleLockIndex = queries.findIndex((query) =>
      /from "connector_schedules"[\s\S]*for update/i.test(query))
    expect(connectorLockIndex).toBeGreaterThanOrEqual(0)
    expect(scheduleLockIndex).toBeGreaterThan(connectorLockIndex)
  })

  it('converges concurrent duplicate admission on one queued run and occurrence', async () => {
    const database = await createPgliteTestDatabase()
    await seedConnectorInstance(database, 'connector-dispatch-concurrent')
    const repository = createConnectorScheduleRepository(database, () => new Date(CREATED_AT))
    const schedule = await repository.create({
      connectorInstanceId: 'connector-dispatch-concurrent',
      state: 'enabled',
      cadence: CADENCE,
      timezone: 'UTC',
    })
    const dispatch = () => admitConnectorScheduleDue({
      database,
      now: () => new Date(DUE_AT),
      maximumCatchUpAgeMinutes: 180,
      input: {
        connectorInstanceId: schedule.connectorInstanceId,
        expectedRevision: schedule.revision,
      },
    })

    const results = await Promise.all([dispatch(), dispatch()])

    expect(results).toEqual([
      expect.objectContaining({ status: 'admitted' }),
      expect.objectContaining({ status: 'admitted' }),
    ])
    if (results[0]?.status !== 'admitted' || results[1]?.status !== 'admitted') {
      throw new Error('Expected admitted schedule results')
    }
    expect(results[1].run.id).toBe(results[0].run.id)
    expect(results[1].occurrence.id).toBe(results[0].occurrence.id)
    await expect(repository.listOccurrences({
      connectorInstanceId: schedule.connectorInstanceId,
      limit: 10,
      offset: 0,
    })).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({ connectorRunId: results[0].run.id })],
    })
    await expect(database.select().from(connectorRuns)).resolves.toHaveLength(1)
  })

  it('returns paused without consuming a due occurrence or advancing eligibility', async () => {
    const { database } = resettableOwner()
    await seedConnectorInstance(database, 'connector-dispatch-paused')
    const repository = createConnectorScheduleRepository(database, () => new Date(CREATED_AT))
    const created = await repository.create({
      connectorInstanceId: 'connector-dispatch-paused',
      state: 'enabled',
      cadence: CADENCE,
      timezone: 'UTC',
    })
    const paused = await repository.pause({
      connectorInstanceId: 'connector-dispatch-paused',
      expectedRevision: created.revision,
    })

    await expect(admitConnectorScheduleDue({
      database,
      now: () => new Date(DUE_AT),
      maximumCatchUpAgeMinutes: 180,
      input: {
        connectorInstanceId: paused.connectorInstanceId,
        expectedRevision: paused.revision,
      },
    })).resolves.toEqual({ status: 'paused' })

    await expect(repository.getByConnectorInstanceId('connector-dispatch-paused')).resolves.toMatchObject({
      state: 'paused',
      nextEligibleAt: created.nextEligibleAt,
      lastOccurrence: null,
      revision: paused.revision,
    })
    await expect(database.select().from(connectorRuns)).resolves.toHaveLength(0)
  })

  it('returns connector_disabled without consuming a due occurrence or advancing eligibility', async () => {
    const { database } = resettableOwner()
    await seedConnectorInstance(database, 'connector-dispatch-disabled')
    const repository = createConnectorScheduleRepository(database, () => new Date(CREATED_AT))
    const created = await repository.create({
      connectorInstanceId: 'connector-dispatch-disabled',
      state: 'enabled',
      cadence: CADENCE,
      timezone: 'UTC',
    })
    await database.update(connectorInstances).set({ enabled: false }).where(
      eq(connectorInstances.id, 'connector-dispatch-disabled'),
    )

    await expect(admitConnectorScheduleDue({
      database,
      now: () => new Date(DUE_AT),
      maximumCatchUpAgeMinutes: 180,
      input: {
        connectorInstanceId: created.connectorInstanceId,
        expectedRevision: created.revision,
      },
    })).resolves.toEqual({ status: 'connector_disabled' })

    await expect(repository.getByConnectorInstanceId('connector-dispatch-disabled')).resolves.toMatchObject({
      state: 'enabled',
      nextEligibleAt: created.nextEligibleAt,
      lastOccurrence: null,
      revision: created.revision,
    })
    await expect(database.select().from(connectorRuns)).resolves.toHaveLength(0)
  })

  it('defers due dispatch when an active connector run exists without consuming the occurrence', async () => {
    const { database } = resettableOwner()
    await seedConnectorInstance(database, 'connector-dispatch-deferred')
    const repository = createConnectorScheduleRepository(database, () => new Date(CREATED_AT))
    const created = await repository.create({
      connectorInstanceId: 'connector-dispatch-deferred',
      state: 'enabled',
      cadence: CADENCE,
      timezone: 'UTC',
    })
    await database.insert(connectorRuns).values({
      id: 'active-deferred-run',
      executionScopeId: 'scope-connector-dispatch-deferred',
      connectorInstanceId: 'connector-dispatch-deferred',
      mode: 'manual',
      status: 'running',
      startedAt: CREATED_AT,
      completedAt: null,
      configJson: '{}',
      filtersJson: '{}',
      filterSignature: 'filters:{}',
      observationCount: 0,
      warningCount: 0,
      statsJson: '{}',
      warningsJson: '[]',
      retryHintsJson: '{}',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })

    await expect(admitConnectorScheduleDue({
      database,
      now: () => new Date(DUE_AT),
      maximumCatchUpAgeMinutes: 180,
      input: {
        connectorInstanceId: created.connectorInstanceId,
        expectedRevision: created.revision,
      },
    })).resolves.toEqual({
      status: 'deferred_active',
      activeRunId: 'active-deferred-run',
    })

    await expect(repository.getByConnectorInstanceId('connector-dispatch-deferred')).resolves.toMatchObject({
      nextEligibleAt: created.nextEligibleAt,
      lastOccurrence: null,
      revision: created.revision,
    })
  })

  it('advances eligibility without admitting when all missed nominals are outside the catch-up horizon', async () => {
    const { database } = resettableOwner()
    await seedConnectorInstance(database, 'connector-dispatch-expired-horizon')
    const repository = createConnectorScheduleRepository(database, () => new Date(CREATED_AT))
    const created = await repository.create({
      connectorInstanceId: 'connector-dispatch-expired-horizon',
      state: 'enabled',
      cadence: CADENCE,
      timezone: 'UTC',
    })

    await expect(admitConnectorScheduleDue({
      database,
      now: () => new Date('2026-07-18T13:59:00.000Z'),
      maximumCatchUpAgeMinutes: 30,
      input: {
        connectorInstanceId: created.connectorInstanceId,
        expectedRevision: created.revision,
      },
    })).resolves.toEqual({
      status: 'not_due',
      nextEligibleAt: '2026-07-18T14:00:00.000Z',
    })

    await expect(repository.getByConnectorInstanceId(created.connectorInstanceId))
      .resolves.toMatchObject({
        lastOccurrence: null,
        nextEligibleAt: '2026-07-18T14:00:00.000Z',
        revision: created.revision,
      })
    await expect(repository.listOccurrences({
      connectorInstanceId: created.connectorInstanceId,
      limit: 10,
      offset: 0,
    })).resolves.toMatchObject({ items: [], total: 0 })
    await expect(database.select().from(connectorRuns)).resolves.toHaveLength(0)
  })

  it('preserves an already active connector run when the schedule is paused', async () => {
    const { database } = resettableOwner()
    await seedConnectorInstance(database, 'connector-dispatch-active-paused')
    const repository = createConnectorScheduleRepository(database, () => new Date(CREATED_AT))
    const created = await repository.create({
      connectorInstanceId: 'connector-dispatch-active-paused',
      state: 'enabled',
      cadence: CADENCE,
      timezone: 'UTC',
    })
    await database.insert(connectorRuns).values({
      id: 'active-paused-run',
      executionScopeId: 'scope-connector-dispatch-active-paused',
      connectorInstanceId: 'connector-dispatch-active-paused',
      mode: 'manual',
      status: 'running',
      startedAt: CREATED_AT,
      completedAt: null,
      configJson: '{}',
      filtersJson: '{}',
      filterSignature: 'filters:{}',
      observationCount: 0,
      warningCount: 0,
      statsJson: '{}',
      warningsJson: '[]',
      retryHintsJson: '{}',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    const paused = await repository.pause({
      connectorInstanceId: 'connector-dispatch-active-paused',
      expectedRevision: created.revision,
    })

    await expect(database.select().from(connectorRuns)).resolves.toEqual([
      expect.objectContaining({ id: 'active-paused-run', mode: 'manual', status: 'running' }),
    ])
    await expect(admitConnectorScheduleDue({
      database,
      now: () => new Date(DUE_AT),
      maximumCatchUpAgeMinutes: 180,
      input: {
        connectorInstanceId: paused.connectorInstanceId,
        expectedRevision: paused.revision,
      },
    })).resolves.toEqual({ status: 'paused' })
  })
})

async function seedConnectorInstance(database: PgliteDatabase, id: string) {
  const executionScopeId = `scope-${id}`
  await database.insert(sourceExecutionScopes).values({
    id: executionScopeId,
    status: 'available',
    blockedUntil: null,
    backoffAttempt: 0,
    authGeneration: 0,
    refreshLeaseToken: null,
    refreshLeaseExpiresAt: null,
    actionReason: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  })
  await database.insert(connectorInstances).values({
    id,
    executionScopeId,
    connectorId: 'fixture.connector',
    connectorVersion: '1.0.0',
    displayName: 'Fixture Connector',
    enabled: true,
    configJson: '{}',
    authJson: '[]',
    filtersJson: '{}',
    earliestBackfillDate: '2026-01-01',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  })
}
