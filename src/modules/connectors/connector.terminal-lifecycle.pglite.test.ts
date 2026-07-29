import { describe, expect, it } from 'vitest'
import { createConnectorRepositoryTestContext } from './connector.repository.pglite-test-helpers'
import { publicConnectorRunSummary } from './connector.run-projection'
import { mapConnectorRunSummary } from './connector.run-record.projection'

describe('public terminal connector lifecycle projection', () => {
  it('publishes a valid terminal synchronization for a completed generic normalization retry', async () => {
    const { repository } = await createConnectorRepositoryTestContext()
    await repository.upsertInstance({
      id: 'generic-normalization-retry', connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
      displayName: 'Generic normalization retry', enabled: true,
      earliestBackfillDate: '2026-07-01', createdAt: '2026-07-01T00:00:00.000Z',
    })
    const requested = await repository.recordRunRequest({
      connectorInstanceId: 'generic-normalization-retry', mode: 'manual',
      startedAt: '2026-07-13T13:00:00.000Z',
    })
    await repository.markRunRunning({
      connectorRunId: requested.run.id,
      startedAt: '2026-07-13T13:00:00.000Z',
    })
    await repository.completeRun({
      connectorRunId: requested.run.id,
      completedAt: '2026-07-13T13:00:01.000Z',
      status: 'completed',
    })
    const persisted = await repository.listRuns({
      connectorInstanceId: 'generic-normalization-retry', limit: 1,
    })

    expect(publicConnectorRunSummary(mapConnectorRunSummary(persisted.items[0]!)))
      .toMatchObject({
        id: requested.run.id,
        status: 'completed',
        outcome: { kind: 'yielded', reason: 'invocation_budget' },
        lifecycleCounts: { source: 'frozen_terminal' },
      })
  })

  it.each([
    {
      name: 'cooldown',
      status: 'skipped' as const,
      operation: (executionScopeId: string) => ({
        kind: 'scope_rate_limited' as const,
        executionScopeId,
        retryAt: '2026-07-13T13:05:00.000Z',
        serverMinimumDelayMs: 300_000,
      }),
      outcome: (executionScopeId: string) => ({
        kind: 'cooling_down' as const,
        operation: {
          kind: 'scope_rate_limited' as const,
          executionScopeId,
          retryAt: '2026-07-13T13:05:00.000Z',
          serverMinimumDelayMs: 300_000,
        },
      }),
    },
    {
      name: 'authentication action',
      status: 'skipped' as const,
      operation: (executionScopeId: string) => ({
        kind: 'authentication_expired' as const,
        executionScopeId,
        requestRefresh: true as const,
      }),
      outcome: (executionScopeId: string) => ({
        kind: 'action_required' as const,
        operation: {
          kind: 'authentication_expired' as const,
          executionScopeId,
          requestRefresh: true as const,
        },
      }),
    },
    {
      name: 'failure',
      status: 'failed' as const,
      operation: () => null,
      outcome: () => ({ kind: 'failed' as const, reason: 'connector_execution_failed' as const }),
    },
  ])('publishes frozen zero-count lifecycle details for $name', async (terminal) => {
    const { repository } = await createConnectorRepositoryTestContext()
    const instance = await repository.upsertInstance({
      id: `terminal-${terminal.name.replaceAll(' ', '-')}`,
      connectorId: 'fixture.jobs',
      connectorVersion: '1.0.0',
      displayName: terminal.name,
      enabled: true,
      earliestBackfillDate: '2026-07-01',
      createdAt: '2026-07-01T00:00:00.000Z',
    })
    await repository.recordRefreshResult({
      connectorInstanceId: instance.id,
      mode: 'manual',
      startedAt: '2026-07-13T13:00:00.000Z',
      completedAt: '2026-07-13T13:00:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      result: {
        observations: [],
        nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture@1' },
        coverage: {
          start: '2026-07-01T00:00:00.000Z',
          end: '2026-07-13T13:00:00.000Z',
        },
        stats: { observations: 0 },
        warnings: [],
        status: terminal.status,
        retryHints: null,
        operationOutcome: terminal.operation(instance.executionScopeId),
        synchronization: {
          newestFrontier: { state: 'not_started' },
          historicalBackfill: {
            state: 'not_started',
            boundary: { earliestDate: '2026-07-01' },
          },
          pendingResolutionCount: 0,
          outcome: terminal.outcome(instance.executionScopeId),
        },
      },
    })

    const persisted = await repository.listRuns({
      connectorInstanceId: instance.id,
      limit: 1,
    })
    const projected = publicConnectorRunSummary(mapConnectorRunSummary(persisted.items[0]!))
    expect(projected.lifecycleCounts).toMatchObject({
      source: 'frozen_terminal',
      provider: {
        returnedRows: 0,
        validRecords: 0,
        invalidRecords: 0,
        sourceDuplicates: 0,
      },
      destination: {
        normalized: 0,
        pending: 0,
        unresolved: 0,
      },
      opportunity: {
        opportunitiesCreated: 0,
        existingJobMatches: 0,
        notFit: 0,
        rejected: 0,
      },
    })
  })
})
