import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { sourceExecutionScopes } from '@sparxie/valedictorian-local-runtime/testing/db/schema'
import { connectorInstances, connectorRuns } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/adapters/persistence/connector.schema'
import { createPgliteTestOwner } from '../../../../test/pglite-test-owner'
import { admitConnectorScheduleDue } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/adapters/persistence/connector-schedule.dispatch'
import { createConnectorScheduleRepository } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/adapters/persistence/connector-schedule.repository'

const CREATED_AT = '2026-07-18T10:00:00.000Z'
const DUE_AT = '2026-07-18T11:00:00.000Z'
const CADENCE = { kind: 'interval' as const, everyMinutes: 60 }

describe('PGlite connector schedule dispatch schema failures', () => {
  it('rolls back admission when an injected occurrence failure aborts the transaction', async () => {
    const { database } = await createPgliteTestOwner()
    await database.insert(sourceExecutionScopes).values({
      id: 'scope-connector-dispatch-rollback',
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
      id: 'connector-dispatch-rollback',
      executionScopeId: 'scope-connector-dispatch-rollback',
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
