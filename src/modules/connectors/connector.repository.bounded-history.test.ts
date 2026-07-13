import { drizzle } from 'drizzle-orm/better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  connectorRuns,
  connectorRunSynchronizations,
  schema,
} from '../../db/schema'
import { createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createSqliteConnectorRepository } from './connector.repository'

describe('SQLite connector repository bounded history', () => {
  it('keeps latest selection and a filtered one-row page bounded across legacy history', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const queries: string[] = []
    const database = drizzle(sqlite, {
      schema,
      logger: { logQuery(query) { queries.push(query) } },
    })
    const repository = createSqliteConnectorRepository(database)
    const instance = await repository.upsertInstance({
      id: 'bounded-history',
      connectorId: 'fixture.jobs',
      connectorVersion: '1.0.0',
      displayName: 'Bounded history',
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    for (let index = 0; index < 250; index += 1) {
      insertRun(database, instance.executionScopeId, {
        id: `legacy-${index.toString().padStart(3, '0')}`,
        startedAt: new Date(Date.UTC(2026, 6, 13, 12, index)).toISOString(),
      })
    }
    insertRun(database, instance.executionScopeId, {
      id: 'synchronized-latest',
      mode: 'scheduled',
      startedAt: '2026-07-13T11:00:00.000Z',
      status: 'queued',
    })
    insertSynchronization(database, 'synchronized-latest', 'in_progress')
    insertRun(database, instance.executionScopeId, {
      id: 'synchronized-completed',
      lifecycleCounts: false,
      mode: 'manual',
      startedAt: '2026-07-13T10:00:00.000Z',
      status: 'completed',
    })
    insertSynchronization(database, 'synchronized-completed', 'caught_up')

    queries.length = 0
    await expect(repository.getStatusSummary(instance.id)).resolves.toMatchObject({
      latestRun: { id: 'synchronized-latest' },
    })
    expect(queries.length).toBeLessThanOrEqual(3)

    queries.length = 0
    const page = await repository.listRuns({
      connectorInstanceId: instance.id,
      limit: 1,
      mode: 'manual',
      offset: 0,
      status: 'completed',
    })
    expect(page).toMatchObject({
      hasMore: false,
      items: [{ id: 'synchronized-completed' }],
      limit: 1,
      offset: 0,
      total: 1,
    })
    expect(page.items[0]!.stats).not.toHaveProperty('lifecycleCounts')
    expect(queries.length).toBeLessThanOrEqual(2)
    sqlite.close()
  })
})

function insertRun(
  database: ReturnType<typeof drizzle<typeof schema>>,
  executionScopeId: string,
  input: {
    id: string
    lifecycleCounts?: boolean
    mode?: string
    startedAt: string
    status?: string
  },
) {
  const status = input.status ?? 'completed'
  database.insert(connectorRuns).values({
    id: input.id,
    executionScopeId,
    connectorInstanceId: 'bounded-history',
    mode: input.mode ?? 'manual',
    status,
    startedAt: input.startedAt,
    completedAt: status === 'queued' ? null : input.startedAt,
    coverageStartedAt: null,
    coverageEndedAt: null,
    configJson: '{}',
    filtersJson: '{}',
    filterSignature: 'filters:{}',
    observationCount: 0,
    warningCount: 0,
    statsJson: JSON.stringify(input.lifecycleCounts === false
      ? {}
      : { lifecycleCounts: zeroLifecycle(input.id, executionScopeId) }),
    warningsJson: '[]',
    retryHintsJson: 'null',
    createdAt: input.startedAt,
    updatedAt: input.startedAt,
    deletedAt: null,
  }).run()
}

function insertSynchronization(
  database: ReturnType<typeof drizzle<typeof schema>>,
  connectorRunId: string,
  outcome: 'caught_up' | 'in_progress',
) {
  database.insert(connectorRunSynchronizations).values({
    connectorRunId,
    snapshotJson: JSON.stringify({
      newestFrontier: { state: 'not_started' },
      historicalBackfill: {
        state: 'not_started',
        boundary: { earliestDate: '2026-01-01' },
      },
      pendingResolutionCount: 0,
      outcome: { kind: outcome },
    }),
    createdAt: '2026-07-13T12:00:00.000Z',
    updatedAt: '2026-07-13T12:00:00.000Z',
  }).run()
}

function zeroLifecycle(connectorRunId: string, executionScopeId: string) {
  return {
    version: 'connector-run-lifecycle-counts/v1',
    source: 'frozen_terminal',
    scope: { kind: 'connector_run', connectorRunId, executionScopeId },
    provider: {
      returnedRows: 0, validRecords: 0, invalidRecords: 0, sourceDuplicates: 0,
      capturedRecords: 0, occurrenceCount: 0, captureShortfall: 0, unclassifiedRows: 0,
      invariant: 'reconciled', gaps: [],
    },
    destination: {
      normalized: 0, resolvedEmployerOrAts: 0, resolvedThirdParty: 0, unresolved: 0,
      pending: 0, gateRejected: 0, unclassified: 0, invariant: 'reconciled',
    },
    sourcing: {
      added: 0, queueDuplicate: 0, notFit: 0, rejected: 0, actionableReview: 0,
      unclassified: 0, invariant: 'reconciled',
    },
  }
}
