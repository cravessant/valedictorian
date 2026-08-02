import { describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pglite'
import { schema, sourceExecutionScopes } from '@sparxie/valedictorian-local-runtime/testing/db/schema'
import { connectorInstances } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/adapters/persistence/connector.schema'
import {
  type PgliteDatabase,
} from '@sparxie/valedictorian-local-runtime/database'
import { useResettablePgliteTestOwner } from '../../../../test/pglite-test-owner'
import { createConnectorScheduleRepository } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/adapters/persistence/connector-schedule.repository'

const NOW = '2026-07-18T10:00:00.000Z'
const CADENCE = { kind: 'interval' as const, everyMinutes: 60 }

const resettableOwner = useResettablePgliteTestOwner()

describe.sequential('PGlite connector schedule repository', () => {
  it('reads each page and total from one PostgreSQL snapshot', async () => {
    const owner = resettableOwner()
    const database = drizzle(owner.client, { schema })
    await seedConnectorInstance(database, 'connector-schedule-page-snapshot')
    const repository = createConnectorScheduleRepository(database, () => new Date(NOW))
    await repository.create({
      connectorInstanceId: 'connector-schedule-page-snapshot',
      state: 'enabled', cadence: CADENCE, timezone: 'UTC',
    })

    const query = vi.spyOn(owner.client, 'query')
    await repository.listAudit({
      connectorInstanceId: 'connector-schedule-page-snapshot', limit: 10, offset: 0,
    })
    const auditQueries = query.mock.calls.filter(([statement]) =>
      statement.includes('connector_schedule_events'))
    expect(auditQueries).toHaveLength(1)

    query.mockClear()
    await repository.listOccurrences({
      connectorInstanceId: 'connector-schedule-page-snapshot', limit: 10, offset: 0,
    })
    const occurrenceQueries = query.mock.calls.filter(([statement]) =>
      statement.includes('connector_schedule_occurrences'))
    expect(occurrenceQueries).toHaveLength(1)
  })

  it('creates a schedule with an immutable revision snapshot', async () => {
    const database = await createTestDatabase()
    await seedConnectorInstance(database, 'connector-schedule-create')
    const repository = createConnectorScheduleRepository(database, () => new Date(NOW))

    const created = await repository.create({
      connectorInstanceId: 'connector-schedule-create',
      state: 'enabled',
      cadence: CADENCE,
      timezone: 'America/Denver',
    })

    await expect(repository.getByConnectorInstanceId('connector-schedule-create'))
      .resolves.toEqual(created)
    await expect(repository.getRevisionSnapshot(created.revision)).resolves.toEqual({
      revision: created.revision,
      scheduleId: created.id,
      state: 'enabled',
      cadence: CADENCE,
      timezone: 'America/Denver',
      createdAt: NOW,
    })
  })

  it('lists equally eligible schedules in deterministic connector order', async () => {
    const database = await createTestDatabase()
    await seedConnectorInstance(database, 'connector-schedule-b')
    await seedConnectorInstance(database, 'connector-schedule-a')
    const repository = createConnectorScheduleRepository(database, () => new Date(NOW))
    for (const connectorInstanceId of ['connector-schedule-b', 'connector-schedule-a']) {
      await repository.create({
        connectorInstanceId,
        state: 'enabled',
        cadence: CADENCE,
        timezone: 'America/Denver',
      })
    }

    await expect(repository.listEnabled()).resolves.toMatchObject([
      { connectorInstanceId: 'connector-schedule-a' },
      { connectorInstanceId: 'connector-schedule-b' },
    ])
  })

  it('allows one revision CAS winner and preserves immutable snapshots in stable order', async () => {
    const database = await createTestDatabase()
    await seedConnectorInstance(database, 'connector-schedule-cas')
    const repository = createConnectorScheduleRepository(database, () => new Date(NOW))
    const created = await repository.create({
      connectorInstanceId: 'connector-schedule-cas',
      state: 'enabled',
      cadence: CADENCE,
      timezone: 'America/Denver',
    })

    const results = await Promise.allSettled([
      repository.update({
        connectorInstanceId: 'connector-schedule-cas',
        expectedRevision: created.revision,
        state: 'enabled',
        cadence: { kind: 'interval', everyMinutes: 120 },
        timezone: 'America/Denver',
      }),
      repository.update({
        connectorInstanceId: 'connector-schedule-cas',
        expectedRevision: created.revision,
        state: 'paused',
        cadence: { kind: 'interval', everyMinutes: 180 },
        timezone: 'UTC',
      }),
    ])
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({
      reason: { code: 'stale_schedule_revision' },
    })
    await expect(repository.getRevisionSnapshot(created.revision)).resolves.toMatchObject({
      state: 'enabled',
      cadence: CADENCE,
      timezone: 'America/Denver',
    })
    const snapshots = await repository.listRevisionSnapshots(created.id)
    expect(snapshots).toHaveLength(2)
    expect(snapshots.map(({ revision }) => revision)).toEqual(
      snapshots.map(({ revision }) => revision).sort((left, right) => left.localeCompare(right)),
    )
  })

  it('converges concurrent duplicate creation on one persisted schedule', async () => {
    const database = await createTestDatabase()
    await seedConnectorInstance(database, 'connector-schedule-duplicate')
    const repository = createConnectorScheduleRepository(database, () => new Date(NOW))
    const input = {
      connectorInstanceId: 'connector-schedule-duplicate',
      state: 'enabled' as const,
      cadence: CADENCE,
      timezone: 'America/Denver',
    }

    const results = await Promise.allSettled([
      repository.create(input),
      repository.create(input),
    ])

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: 'stale_schedule_revision' }) }),
    ])
    await expect(repository.getByConnectorInstanceId(input.connectorInstanceId))
      .resolves.toMatchObject({ connectorInstanceId: input.connectorInstanceId })
  })

  it('persists update, pause, resume, delete, and audit history in deterministic order', async () => {
    const database = await createTestDatabase()
    await seedConnectorInstance(database, 'connector-schedule-lifecycle')
    let clock = NOW
    const repository = createConnectorScheduleRepository(database, () => new Date(clock))
    const created = await repository.create({
      connectorInstanceId: 'connector-schedule-lifecycle',
      state: 'enabled',
      cadence: CADENCE,
      timezone: 'America/Denver',
    })
    clock = '2026-07-18T10:01:00.000Z'
    const updated = await repository.update({
      connectorInstanceId: created.connectorInstanceId,
      expectedRevision: created.revision,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 120 },
      timezone: 'UTC',
    })
    clock = '2026-07-18T10:02:00.000Z'
    const paused = await repository.pause({
      connectorInstanceId: created.connectorInstanceId,
      expectedRevision: updated.revision,
    })
    clock = '2026-07-18T10:03:00.000Z'
    const resumed = await repository.resume({
      connectorInstanceId: created.connectorInstanceId,
      expectedRevision: paused.revision,
    })
    clock = '2026-07-18T10:04:00.000Z'
    await repository.delete({
      connectorInstanceId: created.connectorInstanceId,
      expectedRevision: resumed.revision,
    })

    await expect(repository.getByConnectorInstanceId(created.connectorInstanceId))
      .resolves.toBeNull()
    await expect(repository.listRevisionSnapshots(created.id)).resolves.toHaveLength(5)
    await expect(repository.listAudit({
      connectorInstanceId: created.connectorInstanceId,
      limit: 10,
      offset: 0,
    })).resolves.toMatchObject({
      total: 5,
      items: [
        { action: 'deleted', at: '2026-07-18T10:04:00.000Z' },
        { action: 'resumed', at: '2026-07-18T10:03:00.000Z' },
        { action: 'paused', at: '2026-07-18T10:02:00.000Z' },
        { action: 'upserted', at: '2026-07-18T10:01:00.000Z' },
        { action: 'upserted', at: NOW },
      ],
    })
  })

})

async function createTestDatabase() {
  return resettableOwner().database
}

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
