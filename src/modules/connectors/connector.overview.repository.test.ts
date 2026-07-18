import { drizzle } from 'drizzle-orm/pglite'
import { describe, expect, it } from 'vitest'
import { connectorRuns, connectorRunSynchronizations, schema } from '../../db/schema'
import type { PgliteClient } from '../../db/pglite'
import { createPgliteConnectorRepository } from './connector.repository'
import { createConnectorRepositoryTestContext } from './connector.repository.pglite-test-helpers'
import { mapLocalConnectorOverviewRecord } from '../../runtime/local-connector-overview'
import type { ConnectorStatusState } from 'sparxie'

describe('PGlite connector overview repository', () => {
  it('reads one default-sized connector page and its latest synchronized runs in one query', async () => {
    const { client } = await createConnectorRepositoryTestContext()
    const queries: string[] = []
    const database = drizzle(client, {
      schema,
      logger: { logQuery(query) { queries.push(query) } },
    })
    const repository = createPgliteConnectorRepository(database)
    const instances = await Promise.all(Array.from({ length: 55 }, (_, index) => (
      repository.upsertInstance({
        id: `overview-${String(index).padStart(2, '0')}`,
        connectorId: 'fixture.overview', connectorVersion: '1.0.0',
        displayName: `Overview ${index}`, enabled: true,
        createdAt: '2026-07-13T12:00:00.000Z',
      })
    )))
    for (let index = 0; index < 250; index += 1) {
      const id = `history-${String(index).padStart(3, '0')}`
      const startedAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
      await insertRun(database, {
        connectorInstanceId: instances[0]!.id,
        executionScopeId: instances[0]!.executionScopeId,
        id,
        startedAt,
      })
      await insertSynchronization(database, id, 'caught_up')
    }
    queries.length = 0

    const page = await repository.listOverviewStatusSummaries({ limit: 50 })

    expect(page.items).toHaveLength(50)
    expect(page.items[0]).toMatchObject({
      id: 'overview-00', latestRun: { id: 'history-249' },
    })
    expect(page.items.at(-1)?.id).toBe('overview-49')
    expect(page.hasMore).toBe(true)
    expect(queries).toHaveLength(1)
    await client.exec('set enable_seqscan = off')
    const latestPlan = await explainPlan(client, `
      select run.id
      from connector_runs run
      join connector_run_synchronizations synchronization
        on synchronization.connector_run_id = run.id
      where run.connector_instance_id = $1 and run.deleted_at is null
      order by run.started_at desc, run.created_at desc, run.id desc
      limit 1
    `, [instances[0]!.id])
    expect(latestPlan).toMatch(/idx_connector_runs_instance(?:_latest)?/i)
    expect(latestPlan).not.toMatch(/seq scan/i)
    const connectorPlan = await explainPlan(client, `
      select id from connector_instances
      where deleted_at is null and id > $1
      order by id
      limit 51
    `, ['overview-00'])
    expect(connectorPlan).not.toMatch(/seq scan/i)
  })

  it('keeps SQL filters equivalent to the canonical projector for every public health state', async () => {
    const { database, repository } = await createConnectorRepositoryTestContext()
    const cases = overviewHealthCases()
    for (const item of cases) {
      const instance = await repository.upsertInstance({
        id: `health-${item.status}`, connectorId: 'fixture.overview', connectorVersion: '1.0.0',
        displayName: item.status, enabled: true, createdAt: '2026-07-13T12:00:00.000Z',
      })
      if (!item.run) continue
      await insertRun(database, {
        connectorInstanceId: instance.id, executionScopeId: instance.executionScopeId,
        id: `run-${item.status}`, startedAt: '2026-07-13T12:00:00.000Z',
        status: item.run.status, warnings: item.run.warnings,
      })
      await insertSynchronization(
        database,
        `run-${item.status}`,
        outcomeForScope(item.run.outcome, instance.executionScopeId),
        {
        backfill: item.run.backfill, newest: item.run.newest, pending: item.run.pending,
        },
      )
    }

    for (const item of cases) {
      const page = await repository.listOverviewStatusSummaries({
        limit: 100, severity: item.severity, status: item.status,
      })
      const projected = page.items.map(mapLocalConnectorOverviewRecord)
      expect(projected.map(({ id }) => id), item.status).toEqual([`health-${item.status}`])
      expect(projected[0]!.health).toMatchObject({
        severity: item.severity, status: item.status,
      })
    }
    const all = (await repository.listOverviewStatusSummaries({ limit: 100 }))
      .items.map(mapLocalConnectorOverviewRecord)
    expect(all.find(({ id }) => id === 'health-cooling_down')).toMatchObject({
      cooldown: { retryAt: '2026-07-13T12:05:00.000Z' },
      latestRun: { outcome: 'cooling_down' },
    })
    expect(all.find(({ id }) => id === 'health-blocked')).toMatchObject({
      actionRequired: [{ kind: 'configuration' }],
      health: { status: 'blocked' },
    })
  })

  it('does not synthesize overview lifecycle state from a legacy run without a snapshot', async () => {
    const { database, repository } = await createConnectorRepositoryTestContext()
    const instance = await repository.upsertInstance({
      id: 'legacy-missing-snapshot', connectorId: 'fixture.overview', connectorVersion: '1.0.0',
      displayName: 'Legacy missing snapshot', enabled: true,
      createdAt: '2026-07-13T12:00:00.000Z',
    })
    await insertRun(database, {
      connectorInstanceId: instance.id, executionScopeId: instance.executionScopeId,
      id: 'legacy-unsynchronized-run', startedAt: '2026-07-13T12:01:00.000Z',
    })

    const page = await repository.listOverviewStatusSummaries({
      limit: 1, status: 'never_run',
    })
    expect(page.items.map(mapLocalConnectorOverviewRecord)).toMatchObject([{
      id: instance.id, health: { status: 'never_run' }, latestRun: null,
    }])
  })
})

async function insertRun(
  database: ReturnType<typeof drizzle<typeof schema>>,
  input: {
    connectorInstanceId: string
    executionScopeId: string
    id: string
    startedAt: string
    status?: string
    warnings?: Array<{ code: string; message: string }>
  },
) {
  const warnings = input.warnings ?? []
  await database.insert(connectorRuns).values({
    id: input.id, connectorInstanceId: input.connectorInstanceId,
    executionScopeId: input.executionScopeId, mode: 'manual', status: input.status ?? 'completed',
    startedAt: input.startedAt,
    completedAt: input.status === 'queued' || input.status === 'running' ? null : input.startedAt,
    coverageStartedAt: null, coverageEndedAt: null, configJson: '{}', filtersJson: '{}',
    filterSignature: 'filters:{}', observationCount: 0, warningCount: warnings.length,
    statsJson: '{}', warningsJson: JSON.stringify(warnings), retryHintsJson: 'null',
    createdAt: input.startedAt, updatedAt: input.startedAt, deletedAt: null,
  })
}

async function insertSynchronization(
  database: ReturnType<typeof drizzle<typeof schema>>,
  connectorRunId: string,
  outcome: string | Record<string, unknown>,
  progress: { backfill?: string; newest?: string; pending?: number } = {},
) {
  const outcomeKind = typeof outcome === 'string' ? outcome : outcome.kind
  const defaultProgressState = outcomeKind === 'caught_up' ? 'caught_up' : 'not_started'
  await database.insert(connectorRunSynchronizations).values({
    connectorRunId,
    snapshotJson: JSON.stringify({
      newestFrontier: { state: progress.newest ?? defaultProgressState },
      historicalBackfill: {
        state: progress.backfill ?? defaultProgressState,
        boundary: { earliestDate: '2026-01-01' },
      },
      pendingResolutionCount: progress.pending ?? 0,
      outcome: typeof outcome === 'string' ? { kind: outcome } : outcome,
    }),
    createdAt: '2026-07-13T12:00:00.000Z',
    updatedAt: '2026-07-13T12:00:00.000Z',
  })
}

async function explainPlan(client: PgliteClient, query: string, parameters: unknown[]) {
  const result = await client.query<Record<'QUERY PLAN', string>>(`explain ${query}`, parameters)
  return result.rows.map((row) => row['QUERY PLAN']).join('\n')
}

function overviewHealthCases(): Array<{
  severity: 'healthy' | 'warning' | 'blocked'
  status: ConnectorStatusState
  run: null | {
    status: string
    outcome: string | Record<string, unknown>
    newest?: string
    backfill?: string
    pending?: number
    warnings?: Array<{ code: string; message: string }>
  }
}> {
  return [
    { status: 'never_run', severity: 'warning', run: null },
    { status: 'queued', severity: 'warning', run: { status: 'queued', outcome: 'in_progress', newest: 'not_started', backfill: 'not_started' } },
    { status: 'checking_newest', severity: 'warning', run: { status: 'running', outcome: 'in_progress', newest: 'advancing', backfill: 'not_started' } },
    { status: 'backfilling', severity: 'warning', run: { status: 'running', outcome: 'in_progress', newest: 'caught_up', backfill: 'advancing' } },
    { status: 'resolving', severity: 'warning', run: { status: 'running', outcome: 'in_progress', newest: 'caught_up', backfill: 'caught_up', pending: 1 } },
    { status: 'caught_up', severity: 'healthy', run: { status: 'completed', outcome: 'caught_up' } },
    { status: 'boundary_exhausted', severity: 'healthy', run: { status: 'completed', outcome: 'boundary_exhausted', backfill: 'boundary_reached' } },
    { status: 'source_exhausted', severity: 'healthy', run: { status: 'completed', outcome: 'source_exhausted', backfill: 'source_exhausted' } },
    { status: 'cooling_down', severity: 'warning', run: { status: 'skipped', outcome: { kind: 'cooling_down', operation: { kind: 'scope_rate_limited', executionScopeId: 'scope_health_cooling_down', retryAt: '2026-07-13T12:05:00.000Z', serverMinimumDelayMs: null } } } },
    { status: 'authentication_required', severity: 'blocked', run: { status: 'skipped', outcome: { kind: 'action_required', operation: { kind: 'authentication_expired', executionScopeId: 'scope_health_authentication_required', requestRefresh: true } } } },
    { status: 'skipped', severity: 'warning', run: { status: 'completed', outcome: { kind: 'yielded', reason: 'invocation_budget' } } },
    { status: 'cancelled', severity: 'warning', run: { status: 'cancelled', outcome: { kind: 'cancelled', reason: 'connector_run_cancelled' } } },
    { status: 'failed', severity: 'blocked', run: { status: 'failed', outcome: { kind: 'failed', reason: 'connector_run_failed' } } },
    { status: 'blocked', severity: 'blocked', run: { status: 'failed', outcome: { kind: 'failed', reason: 'connector_run_failed' }, warnings: [{ code: 'jobright_raw_intake_unavailable', message: 'private runtime detail' }] } },
  ]
}

function outcomeForScope(
  outcome: string | Record<string, unknown>,
  executionScopeId: string,
): string | Record<string, unknown> {
  if (typeof outcome === 'string' || !outcome.operation || typeof outcome.operation !== 'object') {
    return outcome
  }
  return {
    ...outcome,
    operation: { ...(outcome.operation as Record<string, unknown>), executionScopeId },
  }
}
