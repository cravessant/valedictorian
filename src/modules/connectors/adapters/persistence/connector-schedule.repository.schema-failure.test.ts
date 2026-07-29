import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { sourceExecutionScopes } from '../../../../db/schema'
import {
  connectorInstances,
  connectorScheduleRevisions,
  connectorSchedules,
} from './connector.schema'
import type { PgliteDatabase } from '../../../../db/pglite'
import { createPgliteTestDatabase } from '../../../../test/pglite-test-owner'
import { createConnectorScheduleRepository } from './connector-schedule.repository'

const NOW = '2026-07-18T10:00:00.000Z'
const CADENCE = { kind: 'interval' as const, everyMinutes: 60 }

describe('PGlite connector schedule repository schema failures', () => {
  it('rolls back schedule and snapshot writes when an injected audit failure aborts create', async () => {
    const database = await createPgliteTestDatabase()
    await seedConnectorInstance(database, 'connector-schedule-rollback')
    const repository = createConnectorScheduleRepository(database, () => new Date(NOW))
    await database.execute(sql.raw(`
      CREATE FUNCTION reject_schedule_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'injected schedule audit failure';
      END;
      $$;
    `))
    await database.execute(sql.raw(`
      CREATE TRIGGER reject_schedule_audit_insert
        BEFORE INSERT ON connector_schedule_events
        FOR EACH ROW EXECUTE FUNCTION reject_schedule_audit();
    `))

    await expect(repository.create({
      connectorInstanceId: 'connector-schedule-rollback',
      state: 'enabled',
      cadence: CADENCE,
      timezone: 'America/Denver',
    })).rejects.toThrow('Failed query: insert into "connector_schedule_events"')
    await expect(repository.getByConnectorInstanceId('connector-schedule-rollback'))
      .resolves.toBeNull()
    await expect(database.select().from(connectorSchedules)).resolves.toEqual([])
    await expect(database.select().from(connectorScheduleRevisions)).resolves.toEqual([])
  })
})

async function seedConnectorInstance(database: PgliteDatabase, id: string) {
  await database.insert(sourceExecutionScopes).values({
    id: `scope-${id}`,
    status: 'available',
    blockedUntil: null,
    backoffAttempt: 0,
    authGeneration: 0,
    refreshLeaseToken: null,
    refreshLeaseExpiresAt: null,
    actionReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  })
  await database.insert(connectorInstances).values({
    id,
    executionScopeId: `scope-${id}`,
    connectorId: 'fixture.connector',
    connectorVersion: '1.0.0',
    displayName: 'Fixture Connector',
    enabled: true,
    configJson: '{}',
    authJson: '[]',
    filtersJson: '{}',
    earliestBackfillDate: '2026-01-01',
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  })
}
