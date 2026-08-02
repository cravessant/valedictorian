import { describe, expect, it, vi } from 'vitest'
import {
  closeTestLocalValedictorianClient,
  createOwnedTestPgliteDataPath,
  createTestFixtureJobsConnector,
  createTestLocalValedictorianClient as createFreshRuntimeLocalValedictorianClient,
  getTestLocalValedictorianDatabase,
  useResettablePgliteTestLocalValedictorianClient,
  useTestMissingReferenceTrackerPath,
} from './local-valedictorian-client.test-harness'
import { completedConnectorRefreshContract } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/public/connector.refresh-result.test-helpers'
import { createPgliteConnectorRepository } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/adapters/persistence/connector.repository'
import { createConnectorRunRecoveryLifecycle } from '@sparxie/valedictorian-local-runtime/connectors'
import { createStaticConnectorRegistry } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/core/connector.registry'
import type { AppJobConnector } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/ports/connector.runner-contracts'

describe.sequential('runtime local Valedictorian client', () => {
  const createRuntimeLocalValedictorianClient
    = useResettablePgliteTestLocalValedictorianClient()
  useTestMissingReferenceTrackerPath()

  async function arrangeEnabledFixtureInstance(options: {
    connector?: AppJobConnector
    earliestBackfillDate?: string
    now?: () => Date
  } = {}) {
    const client = await createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry(
        options.connector ? [options.connector] : [],
      ),
      now: options.now,
      seedDataMode: 'none',
    })
    const connectorRepository = createPgliteConnectorRepository(
      getTestLocalValedictorianDatabase(client),
    )

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
      ...(options.earliestBackfillDate === undefined
        ? {}
        : { earliestBackfillDate: options.earliestBackfillDate }),
    })
    return { client, connectorRepository }
  }

  it('runs the same connector instance id independently in different workspace databases', async () => {
    const firstPgliteDataPath = createOwnedTestPgliteDataPath('valedictorian-client-')
    const secondPgliteDataPath = createOwnedTestPgliteDataPath('valedictorian-client-')
    let releaseFirstRefresh: (() => void) | undefined
    const firstRefreshGate = new Promise<void>((resolve) => {
      releaseFirstRefresh = resolve
    })
    const baseConnector = createTestFixtureJobsConnector({
      observedAt: '2026-07-08T18:00:00.000Z',
    })
    const refreshedWorkspaces: string[] = []
    const connector: AppJobConnector = {
      ...baseConnector,
      async refresh(input, runtime) {
        refreshedWorkspaces.push(input.workspaceId)

        if (input.workspaceId === 'workspace-first') {
          await firstRefreshGate
        }

        return baseConnector.refresh(input, runtime)
      },
    }
    const connectorRegistry = createStaticConnectorRegistry([connector])
    const firstClient = await createFreshRuntimeLocalValedictorianClient({
      connectorRegistry,
      seedDataMode: 'none',
      pgliteDataPath: firstPgliteDataPath,
      workspaceId: 'workspace-first',
    })
    const secondClient = await createFreshRuntimeLocalValedictorianClient({
      connectorRegistry,
      seedDataMode: 'none',
      pgliteDataPath: secondPgliteDataPath,
      workspaceId: 'workspace-second',
    })
    for (const database of [
      getTestLocalValedictorianDatabase(firstClient),
      getTestLocalValedictorianDatabase(secondClient),
    ]) {
      await createPgliteConnectorRepository(database).upsertInstance({
        id: 'connector-instance-fixture',
        connectorId: 'fixture.jobs',
        connectorVersion: '0.0.0-fixture',
        displayName: 'Fixture Jobs',
        enabled: true,
        createdAt: '2026-07-08T15:00:00.000Z',
      })
    }

    const triggerInput = {
      connectorInstanceId: 'connector-instance-fixture',
      coverageStartedAt: '2026-07-08T17:00:00.000Z',
      coverageEndedAt: '2026-07-08T18:00:00.000Z',
      mode: 'manual' as const,
    }
    const firstRunPromise = firstClient.connectors.runs.trigger(triggerInput)

    await vi.waitFor(() => {
      expect(refreshedWorkspaces).toEqual(['workspace-first'])
    })

    await expect(secondClient.connectors.runs.trigger(triggerInput)).resolves.toMatchObject({
      connectorInstanceId: 'connector-instance-fixture',
      status: 'completed',
    })
    await expect(firstClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
    })).resolves.toMatchObject({
      items: [{ status: 'running' }],
      total: 1,
    })

    releaseFirstRefresh?.()
    await expect(firstRunPromise).resolves.toMatchObject({ status: 'completed' })
    expect(refreshedWorkspaces).toEqual(['workspace-first', 'workspace-second'])
  })

  it('recovers an interrupted running row as an explicit cancelled result on reopen', async () => {
    const pgliteDataPath = createOwnedTestPgliteDataPath('valedictorian-client-')
    const setupClient = await createFreshRuntimeLocalValedictorianClient({ pgliteDataPath })
    const connectorRepository = createPgliteConnectorRepository(
      getTestLocalValedictorianDatabase(setupClient),
    )

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })
    const requestedRun = (await connectorRepository.recordRunRequest({
      connectorInstanceId: 'connector-instance-fixture',
      coverageStartedAt: '2026-07-08T17:00:00.000Z',
      coverageEndedAt: '2026-07-08T18:00:00.000Z',
      mode: 'manual',
      startedAt: '2026-07-08T18:00:00.000Z',
    })).run
    await connectorRepository.markRunRunning({
      connectorRunId: requestedRun.id,
      startedAt: '2026-07-08T18:00:00.000Z',
    })
    await connectorRepository.recordRefreshResult({
      connectorRunId: requestedRun.id,
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      startedAt: '2026-07-08T18:00:00.000Z',
      completedAt: '2026-07-08T18:00:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'filters:{}',
      checkpointPersistence: 'deferred',
      result: {
        operationOutcome: null,
        synchronization: {
          newestFrontier: { state: 'advancing' },
          historicalBackfill: { state: 'advancing', boundary: { earliestDate: '2026-07-08' } },
          pendingResolutionCount: 1,
          outcome: { kind: 'failed', reason: 'connector_execution_failed' },
        },
        coverage: {
          start: '2026-07-08T17:00:00.000Z',
          end: '2026-07-08T18:00:00.000Z',
        },
        nextCheckpoint: {
          checkpoint: { cursor: 'not-yet-committed' },
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations: [],
        stats: { observations: 0 },
        warnings: [{
          code: 'source.rate_limited',
          message: 'The connector source rate limited capture. Retry after the supplied delay.',
        }],
        status: 'failed',
      },
    })
    await closeTestLocalValedictorianClient(setupClient)

    const reopenedClient = await createFreshRuntimeLocalValedictorianClient({
      connectorRunRecovery: createConnectorRunRecoveryLifecycle(),
      connectorRegistry: createStaticConnectorRegistry([
        createTestFixtureJobsConnector({ observedAt: '2026-07-08T19:00:00.000Z' }),
      ]),
      now: () => new Date('2026-07-08T19:00:00.000Z'),
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId: 'workspace-fixture',
    })

    await expect(reopenedClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
    })).resolves.toMatchObject({
      items: [
        {
          completedAt: '2026-07-08T19:00:00.000Z',
          id: requestedRun.id,
          retryHints: null,
          status: 'cancelled',
          warningCount: 2,
          warnings: [
            {
              code: 'source.rate_limited',
              label: 'Rate limited',
            },
            {
              code: 'connector.interrupted',
              label: 'Run interrupted',
            },
          ],
        },
      ],
      total: 1,
    })

    const retry = await reopenedClient.connectors.runs.trigger({
      connectorInstanceId: 'connector-instance-fixture',
      coverageStartedAt: '2026-07-08T18:00:00.000Z',
      coverageEndedAt: '2026-07-08T19:00:00.000Z',
      mode: 'manual',
    })

    expect(retry).toMatchObject({ status: 'completed' })
    expect(retry.id).not.toBe(requestedRun.id)
    await expect(reopenedClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
    })).resolves.toMatchObject({
      items: [
        { id: retry.id, status: 'completed' },
        { id: requestedRun.id, status: 'cancelled' },
      ],
      total: 2,
    })
  })

  it('rejects unsupported connector run triggers instead of queueing them', async () => {
    const { client } = await arrangeEnabledFixtureInstance()

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageStartedAt: '2026-07-08T17:00:00.000Z',
        coverageEndedAt: '2026-07-08T18:00:00.000Z',
        mode: 'manual',
      }),
    ).rejects.toThrow('Unsupported connector id: fixture.jobs')
    await expect(
      client.connectors.runs.list({
        connectorInstanceId: 'connector-instance-fixture',
      }),
    ).resolves.toMatchObject({
      total: 0,
    })
  })

  it('rejects dry-run connector triggers before executing registered connectors', async () => {
    const { client } = await arrangeEnabledFixtureInstance({
      connector: createTestFixtureJobsConnector({ observedAt: '2026-07-08T18:00:00.000Z' }),
    })

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageStartedAt: '2026-07-08T17:00:00.000Z',
        coverageEndedAt: '2026-07-08T18:00:00.000Z',
        dryRun: true,
        mode: 'manual',
      }),
    ).rejects.toThrow('dryRun connector triggers are not supported')
    await expect(
      client.connectors.runs.list({
        connectorInstanceId: 'connector-instance-fixture',
      }),
    ).resolves.toMatchObject({
      total: 0,
    })
  })

  it('derives ordinary manual coverage end from the injected clock when omitted', async () => {
    const clock = '2026-07-08T18:30:00.000Z'
    const { client } = await arrangeEnabledFixtureInstance({
      connector: createTestFixtureJobsConnector({ observedAt: clock }),
      earliestBackfillDate: '2026-07-01',
      now: () => new Date(clock),
    })

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        mode: 'manual',
      }),
    ).resolves.toMatchObject({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      status: 'completed',
      coverage: {
        start: '2026-07-01T00:00:00.000Z',
        end: clock,
      },
    })
    await expect(
      client.connectors.runs.list({
        connectorInstanceId: 'connector-instance-fixture',
      }),
    ).resolves.toMatchObject({
      total: 1,
      items: [{
        coverage: {
          start: '2026-07-01T00:00:00.000Z',
          end: clock,
        },
      }],
    })
  })

  it('rejects per-run filter overrides before executing registered connectors', async () => {
    const { client } = await arrangeEnabledFixtureInstance({
      connector: createTestFixtureJobsConnector({ observedAt: '2026-07-08T18:00:00.000Z' }),
    })

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageStartedAt: '2026-07-08T17:00:00.000Z',
        coverageEndedAt: '2026-07-08T18:00:00.000Z',
        filters: { roleKeywords: ['intern'] },
        mode: 'manual',
      }),
    ).rejects.toThrow('Per-run connector filter overrides are not supported')
    await expect(
      client.connectors.runs.list({
        connectorInstanceId: 'connector-instance-fixture',
      }),
    ).resolves.toMatchObject({
      total: 0,
    })
  })

  it('records failed runs and allows a later trigger when registered connectors throw', async () => {
    const { client } = await arrangeEnabledFixtureInstance({
      connector: createTestFixtureJobsConnector({
        observedAt: '2026-07-08T18:00:00.000Z',
        failRefresh: true,
      }),
    })

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageStartedAt: '2026-07-08T17:00:00.000Z',
        coverageEndedAt: '2026-07-08T18:00:00.000Z',
        mode: 'manual',
      }),
    ).rejects.toThrow('Connector execution failed.')

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageStartedAt: '2026-07-08T18:00:00.000Z',
        coverageEndedAt: '2026-07-08T19:00:00.000Z',
        mode: 'manual',
      }),
    ).rejects.toThrow('Connector execution failed.')
    await expect(
      client.connectors.runs.list({
        connectorInstanceId: 'connector-instance-fixture',
      }),
    ).resolves.toMatchObject({
      items: [
        {
          retryHints: null,
          stats: {
            failures: 1,
            running: false,
          },
          status: 'failed',
        },
        {
          retryHints: null,
          status: 'failed',
        },
      ],
      total: 2,
    })
  })

  it('does not fail a connector run by interpreting an invalid legacy observation', async () => {
    const { client, connectorRepository } = await arrangeEnabledFixtureInstance({
      connector: createTestFixtureJobsConnector({
        observationCompanyNames: [''],
        observedAt: '2026-07-08T18:00:00.000Z',
      }),
    })
    await recordPreviousSuccessfulRefresh(connectorRepository)

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageStartedAt: '2026-07-08T17:00:00.000Z',
        coverageEndedAt: '2026-07-08T18:00:00.000Z',
        mode: 'manual',
      }),
    ).resolves.toMatchObject({ status: 'completed' })
    const runs = await client.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
    })

    expect(runs.total).toBe(2)
    expect(runs.items[0]).toMatchObject({
      retryHints: null,
      status: 'completed',
    })
    await expect(
      client.connectors.checkpoints.list({
        connectorInstanceId: 'connector-instance-fixture',
        filterSignature: 'filters:{}',
      }),
    ).resolves.toMatchObject({
      items: [
        {
          checkpoint: {
            cursor: 'fixture:2026-07-08T18:00:00.000Z',
          },
          coverage: {
            end: '2026-07-08T18:00:00.000Z',
            start: '2026-07-01T00:00:00.000Z',
          },
        },
      ],
    })
  })

  it('commits catch-up checkpoints independently of legacy observation projection', async () => {
    const { client, connectorRepository } = await arrangeEnabledFixtureInstance({
      connector: createTestFixtureJobsConnector({
        observationCompanyNames: ['Example Robotics', ''],
        observedAt: '2026-07-08T18:00:00.000Z',
      }),
    })
    await recordPreviousSuccessfulRefresh(connectorRepository)

    await expect(
      client.connectors.runs.trigger({
        connectorInstanceId: 'connector-instance-fixture',
        coverageEndedAt: '2026-07-08T18:00:00.000Z',
        mode: 'manual',
        executionIntent: 'deferred_refresh',
      }),
    ).resolves.toMatchObject({ status: 'completed' })
    const runs = await client.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
    })
    const observations = await client.connectors.observations.list({
      connectorInstanceId: 'connector-instance-fixture',
      limit: 10,
    })

    expect(runs.total).toBe(2)
    expect(runs.items[0]).toMatchObject({
      coverage: {
        end: '2026-07-08T18:00:00.000Z',
        start: '2026-07-01T00:00:00.000Z',
      },
      mode: 'manual',
      scheduleOccurrence: null,
      observationCount: 2,
      retryHints: null,
      status: 'completed',
    })
    expect(observations.total).toBe(2)
    await expect(
      client.connectors.checkpoints.list({
        connectorInstanceId: 'connector-instance-fixture',
        filterSignature: 'filters:{}',
      }),
    ).resolves.toMatchObject({
      items: [
        {
          checkpoint: {
            cursor: 'fixture:2026-07-08T18:00:00.000Z',
          },
          coverage: {
            end: '2026-07-08T18:00:00.000Z',
            start: '2026-07-01T00:00:00.000Z',
          },
        },
      ],
    })
  })


  it('gates a manual retry before connector refresh and returns the persisted not-due run', async () => {
    const base = createTestFixtureJobsConnector({ observedAt: '2026-07-11T12:00:00.000Z' })
    const refresh = vi.fn(async (input: Parameters<AppJobConnector['refresh']>[0], runtime: Parameters<AppJobConnector['refresh']>[1]) => ({
      ...await base.refresh(input, runtime),
      observations: [],
      stats: { observations: 0 },
      retryHints: {
        state: 'scheduled' as const, reason: 'rate_limit' as const,
        attempt: 1, maxAttempts: 3, lastAttemptAt: '2026-07-11T12:00:00.000Z',
        computedDelayMs: 60_000, serverMinimumDelayMs: null,
        nextAttemptAt: '2026-07-11T12:01:00.000Z', horizonAt: '2026-07-11T13:00:00.000Z',
      },
    }))
    const connector: AppJobConnector = { ...base, refresh }
    const client = await createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      now: () => new Date('2026-07-11T12:00:30.000Z'), seedDataMode: 'none',
    })
    const repository = createPgliteConnectorRepository(getTestLocalValedictorianDatabase(client))
    await repository.upsertInstance({
      id: 'retry-runtime', connectorId: connector.definition.id,
      connectorVersion: connector.definition.version, displayName: 'Retry runtime', enabled: true,
      filters: {}, createdAt: '2026-07-11T11:00:00.000Z',
    })

    await client.connectors.runs.trigger({
      connectorInstanceId: 'retry-runtime', mode: 'manual',
      coverageStartedAt: '2026-07-11T11:00:00.000Z', coverageEndedAt: '2026-07-11T12:00:00.000Z',
    })
    const early = await client.connectors.runs.trigger({
      connectorInstanceId: 'retry-runtime', mode: 'manual',
      coverageStartedAt: '2026-07-11T11:00:00.000Z', coverageEndedAt: '2026-07-11T12:00:00.000Z',
    })
    const repeated = await client.connectors.runs.trigger({
      connectorInstanceId: 'retry-runtime', mode: 'manual',
      coverageStartedAt: '2026-07-11T11:00:00.000Z', coverageEndedAt: '2026-07-11T12:00:00.000Z',
    })

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(early).toMatchObject({ status: 'skipped', retryHints: { state: 'not_due', reason: 'rate_limit' } })
    expect(repeated.id).toBe(early.id)
  })


  it('gates Jobright capture retries with the exact provider-state signature across direct, startup, and repeated triggers', async () => {
    const refresh = vi.fn(async () => {
      throw new Error('Jobright refresh must not run before due')
    })
    const connector = {
      definition: {
        id: 'jobright.resolver',
        version: '0.12.0',
        capabilities: { supportsFiltering: false },
      },
      refresh,
    } as AppJobConnector
    const client = await createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      now: () => new Date('2026-07-11T12:00:30.000Z'),
      seedDataMode: 'none',
    })
    const repository = createPgliteConnectorRepository(getTestLocalValedictorianDatabase(client))
    await repository.upsertInstance({
      id: 'jobright-capture-retry',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.12.0',
      displayName: 'Jobright capture retry',
      enabled: true,
      filters: {},
      createdAt: '2026-07-11T11:00:00.000Z',
    })
    await repository.recordRefreshResult({
      connectorInstanceId: 'jobright-capture-retry',
      mode: 'manual',
      startedAt: '2026-07-11T12:00:00.000Z',
      completedAt: '2026-07-11T12:00:01.000Z',
      config: {},
      filters: {},
      filterSignature: 'provider-state:jobright.resolver@0.12.0',
      result: {
        ...completedConnectorRefreshContract('2026-07-11'),
        observations: [],
        warnings: [],
        stats: { observations: 0 },
        coverage: { start: '2026-07-11T11:00:00.000Z', end: '2026-07-11T12:00:00.000Z' },
        nextCheckpoint: {
          checkpoint: { pendingDetailRetries: [], retryState: [], cycleId: 'capture-cycle' },
          schemaVersion: 'jobright-resolution-checkpoint@5',
        },
        retryHints: {
          state: 'scheduled', reason: 'rate_limit', attempt: 1, maxAttempts: 3,
          lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 60_000,
          nextAttemptAt: '2026-07-11T12:01:00.000Z', horizonAt: '2026-07-11T13:00:00.000Z',
        },
      },
    })

    const direct = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-capture-retry',
      mode: 'manual',
      coverageStartedAt: '2026-07-11T11:00:00.000Z',
      coverageEndedAt: '2026-07-11T12:00:00.000Z',
    })
    const repeated = await client.connectors.runs.trigger({
      connectorInstanceId: 'jobright-capture-retry',
      mode: 'manual',
      coverageStartedAt: '2026-07-11T11:00:00.000Z',
      coverageEndedAt: '2026-07-11T12:00:00.000Z',
    })
    expect(direct).toMatchObject({
      mode: 'manual',
      scheduleOccurrence: null,
      status: 'skipped',
      filterSignature: 'provider-state:jobright.resolver@0.12.0',
      retryHints: { state: 'not_due', reason: 'rate_limit' },
    })
    expect(repeated.id).toBe(direct.id)
    expect(refresh).not.toHaveBeenCalled()
  })


})

function recordPreviousSuccessfulRefresh(
  connectorRepository: ReturnType<typeof createPgliteConnectorRepository>,
) {
  return connectorRepository.recordRefreshResult({
    connectorInstanceId: 'connector-instance-fixture',
    mode: 'manual',
    startedAt: '2026-07-08T16:00:00.000Z',
    completedAt: '2026-07-08T16:00:01.000Z',
    config: {},
    filters: {},
    filterSignature: 'filters:{}',
    result: {
      ...completedConnectorRefreshContract('2026-07-08'),
      coverage: {
        start: '2026-07-08T15:00:00.000Z',
        end: '2026-07-08T16:00:00.000Z',
      },
      nextCheckpoint: {
        checkpoint: {
          cursor: 'previous-successful-cursor',
        },
        schemaVersion: 'fixture-checkpoint@1',
      },
      observations: [],
      stats: {
        observations: 0,
      },
      warnings: [],
    },
  })
}
