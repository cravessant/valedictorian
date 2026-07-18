import { describe, expect, it, onTestFinished } from 'vitest'
import { sql } from 'drizzle-orm'
import { sourceExecutionScopes } from '../../db/schema'
import { connectorInstances, connectorRuns } from '../../db/schema.connectors'
import {
  createPgliteClient,
  migratePgliteDatabase,
  type PgliteDatabase,
} from '../../db/pglite'
import { admitConnectorScheduleDue } from './connector-schedule.dispatch'
import { createConnectorScheduleRepository } from './connector-schedule.repository'

const CREATED_AT = '2026-07-18T10:00:00.000Z'
const DUE_AT = '2026-07-18T11:00:00.000Z'
const CADENCE = { kind: 'interval' as const, everyMinutes: 60 }

describe('PGlite connector schedule dispatch', () => {
  it('converges concurrent duplicate admission on one queued run and occurrence', async () => {
    const database = await createTestDatabase()
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

  it('rolls back admission when an injected occurrence failure aborts the transaction', async () => {
    const database = await createTestDatabase()
    await seedConnectorInstance(database, 'connector-dispatch-rollback')
    const repository = createConnectorScheduleRepository(database, () => new Date(CREATED_AT))
    const schedule = await repository.create({
      connectorInstanceId: 'connector-dispatch-rollback',
      state: 'enabled',
      cadence: CADENCE,
      timezone: 'UTC',
    })
    await database.execute(sql.raw(`
      CREATE FUNCTION reject_schedule_occurrence() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'injected schedule occurrence failure';
      END;
      $$;
    `))
    await database.execute(sql.raw(`
      CREATE TRIGGER reject_schedule_occurrence_insert
        BEFORE INSERT ON connector_schedule_occurrences
        FOR EACH ROW EXECUTE FUNCTION reject_schedule_occurrence();
    `))

    await expect(admitConnectorScheduleDue({
      database,
      now: () => new Date(DUE_AT),
      maximumCatchUpAgeMinutes: 180,
      input: {
        connectorInstanceId: schedule.connectorInstanceId,
        expectedRevision: schedule.revision,
      },
    })).rejects.toThrow('Failed query: insert into "connector_schedule_occurrences"')
    await expect(repository.getByConnectorInstanceId(schedule.connectorInstanceId))
      .resolves.toMatchObject({ nextEligibleAt: schedule.nextEligibleAt })
    await expect(repository.listOccurrences({
      connectorInstanceId: schedule.connectorInstanceId,
      limit: 10,
      offset: 0,
    })).resolves.toMatchObject({ total: 0, items: [] })
    await expect(database.select().from(connectorRuns)).resolves.toEqual([])
  })
})

async function createTestDatabase() {
  const client = await createPgliteClient()
  onTestFinished(() => client.close())
  return migratePgliteDatabase(client)
}

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
