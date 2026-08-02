import { describe, expect, it, vi } from 'vitest'
import {
  createOwnedTestPgliteDataPath,
  createTestFixtureJobsConnector,
  createTestLocalValedictorianClient as createFreshRuntimeLocalValedictorianClient,
  getTestLocalValedictorianDatabase,
  useResettablePgliteTestLocalValedictorianClient,
  useTestMissingReferenceTrackerPath,
} from './local-valedictorian-client.test-harness'
import { createPgliteConnectorRepository } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/adapters/persistence/connector.repository'
import { createStaticConnectorRegistry } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/core/connector.registry'
import type { AppJobConnector } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/ports/connector.runner-contracts'

describe.sequential('runtime local Valedictorian client', () => {
  const createRuntimeLocalValedictorianClient
    = useResettablePgliteTestLocalValedictorianClient()
  useTestMissingReferenceTrackerPath()

  it('creates and updates connector instances through the local client', async () => {
    const client = await createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([
        createTestFixtureJobsConnector({ observedAt: '2026-07-08T18:00:00.000Z' }),
      ]),
      seedDataMode: 'none',
    })

    const created = await client.connectors.create({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      auth: [
        {
          id: 'fixture-session',
          label: 'Fixture session',
          mode: 'api_key',
          secretKey: 'fixture-session-123',
        },
      ],
      config: {
        publicFeedUrl: 'https://fixture.example/feed.json',
      },
      filters: {
        roleKeywords: ['intern'],
      },
    })
    const updated = await client.connectors.update({
      connectorInstanceId: 'connector-instance-fixture',
      displayName: 'Fixture Internships',
      enabled: false,
      filters: {
        roleKeywords: ['new grad'],
      },
    })
    const instances = await client.connectors.list()

    expect(created).toMatchObject({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      auth: [{ configured: true, id: 'fixture-session', mode: 'api_key' }],
      config: {
        publicFeedUrl: 'https://fixture.example/feed.json',
      },
      filters: {
        roleKeywords: ['intern'],
      },
    })
    expect(updated).toMatchObject({
      id: 'connector-instance-fixture',
      displayName: 'Fixture Internships',
      enabled: false,
      config: {
        publicFeedUrl: 'https://fixture.example/feed.json',
      },
      filters: {
        roleKeywords: ['new grad'],
      },
    })
    expect(instances.items).toMatchObject([
      {
        id: 'connector-instance-fixture',
        displayName: 'Fixture Internships',
        enabled: false,
      },
    ])
  })

  it('persists two truthful non-terminal connector progress snapshots before completion', async () => {
    let releaseAuthentication: (() => void) | undefined
    let releaseNormalization: (() => void) | undefined
    const authenticationGate = new Promise<void>((resolve) => {
      releaseAuthentication = resolve
    })
    const normalizationGate = new Promise<void>((resolve) => {
      releaseNormalization = resolve
    })
    const baseConnector = createTestFixtureJobsConnector({ observedAt: '2026-07-08T18:00:00.000Z' })
    const connector: AppJobConnector = {
      ...baseConnector,
      async refresh(input, runtime) {
        await runtime.progress?.report({
          stage: 'authenticating',
          counts: {
            attempted: 0,
            discovered: 0,
            eligible: 0,
            filtered: 0,
            pendingResolution: 8,
            resolvedEmployerOrAts: 0,
            resolvedThirdParty: 0,
            skipped: 0,
            unresolved: 0,
          },
        })
        await authenticationGate
        await runtime.progress?.report({
          stage: 'normalizing',
          counts: {
            attempted: 3,
            discovered: 20,
            eligible: 20,
            filtered: 0,
            resolvedEmployerOrAts: 1,
            resolvedThirdParty: 1,
            skipped: 0,
            unresolved: 1,
          },
          wait: {
            minDelayMs: 1_000,
            maxDelayMs: 2_000,
            reason: 'jobright_resolution',
          },
        })
        await normalizationGate
        return baseConnector.refresh(input, runtime)
      },
    }
    const client = await createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      seedDataMode: 'none',
      workspaceId: 'workspace-fixture',
    })
    const repository = createPgliteConnectorRepository(getTestLocalValedictorianDatabase(client))
    await repository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
    })

    const pendingRun = client.connectors.runs.trigger({
      connectorInstanceId: 'connector-instance-fixture',
      coverageStartedAt: '2026-07-08T17:00:00.000Z',
      coverageEndedAt: '2026-07-08T18:00:00.000Z',
      mode: 'manual',
    })

    await vi.waitFor(async () => {
      await expect(client.connectors.runs.list({
        connectorInstanceId: 'connector-instance-fixture',
      })).resolves.toMatchObject({
        items: [{
          status: 'running',
          stats: {
            stage: 'authenticating',
            discovered: 0,
            lifecycleCounts: { source: 'live_current' },
          },
        }],
      })
    })

    releaseAuthentication?.()
    await vi.waitFor(async () => {
      await expect(client.connectors.runs.list({
        connectorInstanceId: 'connector-instance-fixture',
      })).resolves.toMatchObject({
        items: [{
          status: 'running',
          stats: {
            attempted: 3,
            discovered: 20,
            resolvedEmployerOrAts: 1,
            resolvedThirdParty: 1,
            stage: 'normalizing',
            unresolved: 1,
            lifecycleCounts: { source: 'live_current' },
            wait: {
              maxDelayMs: 2_000,
              minDelayMs: 1_000,
              reason: 'jobright_resolution',
            },
          },
        }],
      })
    })

    releaseNormalization?.()
    await expect(pendingRun).resolves.toMatchObject({
      status: 'completed',
      stats: { lifecycleCounts: { source: 'frozen_terminal' } },
    })
  })

  it('persists one running row before refresh settles and completes that same run', async () => {
    let releaseRefresh: (() => void) | undefined
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    const client = await createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([
        createTestFixtureJobsConnector({
          observedAt: '2026-07-08T18:00:00.000Z',
          gateRefreshUntil: refreshGate,
        }),
      ]),
      seedDataMode: 'none',
      workspaceId: 'workspace-fixture',
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
    })

    const pendingRun = client.connectors.runs.trigger({
      connectorInstanceId: 'connector-instance-fixture',
      coverageStartedAt: '2026-07-08T17:00:00.000Z',
      coverageEndedAt: '2026-07-08T18:00:00.000Z',
      mode: 'manual',
    })
    let runningRunId: string | undefined

    await vi.waitFor(async () => {
      const runs = await client.connectors.runs.list({
        connectorInstanceId: 'connector-instance-fixture',
      })

      expect(runs).toMatchObject({
        items: [
          {
            completedAt: null,
            status: 'running',
          },
        ],
        total: 1,
      })
      runningRunId = runs.items[0]?.id
    })

    releaseRefresh?.()
    const completedRun = await pendingRun
    const persistedRuns = await client.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
    })

    expect(completedRun).toMatchObject({
      id: runningRunId,
      status: 'completed',
    })
    expect(persistedRuns).toMatchObject({
      items: [
        {
          id: runningRunId,
          status: 'completed',
        },
      ],
      total: 1,
    })
  })

  it('returns one active run across clients when concurrent triggers target the same connector instance', async () => {
    const pgliteDataPath = createOwnedTestPgliteDataPath('valedictorian-client-')
    let releaseRefresh: (() => void) | undefined
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    const connector = createTestFixtureJobsConnector({
      observedAt: '2026-07-08T18:00:00.000Z',
      gateRefreshUntil: refreshGate,
    })
    const refresh = vi.fn((
      input: Parameters<AppJobConnector['refresh']>[0],
      runtime: Parameters<AppJobConnector['refresh']>[1],
    ) => connector.refresh(input, runtime))
    const clientOptions = {
      connectorRegistry: createStaticConnectorRegistry([{ ...connector, refresh }]),
      seedDataMode: 'none',
      pgliteDataPath,
      workspaceId: 'workspace-fixture',
    } as const
    const firstClient = await createFreshRuntimeLocalValedictorianClient(clientOptions)
    const secondClient = await createFreshRuntimeLocalValedictorianClient({
      ...clientOptions,
      database: getTestLocalValedictorianDatabase(firstClient),
    })
    const connectorRepository = createPgliteConnectorRepository(
      getTestLocalValedictorianDatabase(firstClient),
    )

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    const triggerInput = {
      connectorInstanceId: 'connector-instance-fixture',
      coverageStartedAt: '2026-07-08T17:00:00.000Z',
      coverageEndedAt: '2026-07-08T18:00:00.000Z',
      mode: 'manual' as const,
    }
    const firstRunPromise = firstClient.connectors.runs.trigger(triggerInput)

    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1)
    })

    let activeRun: Awaited<typeof firstRunPromise>
    const secondRunPromise = secondClient.connectors.runs.trigger(triggerInput).then((run) => {
      activeRun = run
      return run
    })

    try {
      await vi.waitFor(() => {
        expect(activeRun).toMatchObject({
          connectorInstanceId: 'connector-instance-fixture',
          status: 'running',
        })
      }, { timeout: 250 })
      expect(refresh).toHaveBeenCalledTimes(1)
    } finally {
      releaseRefresh?.()
    }

    const [completedRun, returnedActiveRun] = await Promise.all([
      firstRunPromise,
      secondRunPromise,
    ])
    const runs = await secondClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
    })
    const observations = await secondClient.connectors.observations.list({
      connectorInstanceId: 'connector-instance-fixture',
    })
    const checkpoints = await secondClient.connectors.checkpoints.list({
      connectorInstanceId: 'connector-instance-fixture',
    })

    expect(returnedActiveRun.id).toBe(completedRun.id)
    expect(runs).toMatchObject({
      items: [{ id: completedRun.id, status: 'completed' }],
      total: 1,
    })
    expect(observations.total).toBe(1)
    expect(checkpoints.items).toHaveLength(1)

    const laterRun = await firstClient.connectors.runs.trigger({
      ...triggerInput,
      coverageStartedAt: '2026-07-08T18:00:00.000Z',
      coverageEndedAt: '2026-07-08T19:00:00.000Z',
    })

    expect(laterRun.id).not.toBe(completedRun.id)
    expect(laterRun.status).toBe('completed')
    expect(refresh).toHaveBeenCalledTimes(2)
    await expect(secondClient.connectors.runs.list({
      connectorInstanceId: 'connector-instance-fixture',
    })).resolves.toMatchObject({ total: 2 })
  })

  it('runs different connector instances independently in the same workspace', async () => {
    let releaseFirstRefresh: (() => void) | undefined
    const firstRefreshGate = new Promise<void>((resolve) => {
      releaseFirstRefresh = resolve
    })
    const baseConnector = createTestFixtureJobsConnector({
      observedAt: '2026-07-08T18:00:00.000Z',
    })
    const refreshedInstances: string[] = []
    const connector: AppJobConnector = {
      ...baseConnector,
      async refresh(input, runtime) {
        refreshedInstances.push(input.connectorInstanceId)

        if (input.connectorInstanceId === 'connector-instance-first') {
          await firstRefreshGate
        }

        return baseConnector.refresh(input, runtime)
      },
    }
    const client = await createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      seedDataMode: 'none',
      workspaceId: 'workspace-fixture',
    })
    const connectorRepository = createPgliteConnectorRepository(
      getTestLocalValedictorianDatabase(client),
    )

    for (const [id, displayName] of [
      ['connector-instance-first', 'First fixture jobs'],
      ['connector-instance-second', 'Second fixture jobs'],
    ] as const) {
      await connectorRepository.upsertInstance({
        id,
        connectorId: 'fixture.jobs',
        connectorVersion: '0.0.0-fixture',
        displayName,
        enabled: true,
        createdAt: '2026-07-08T15:00:00.000Z',
      })
    }

    const firstRunPromise = client.connectors.runs.trigger({
      connectorInstanceId: 'connector-instance-first',
      coverageStartedAt: '2026-07-08T17:00:00.000Z',
      coverageEndedAt: '2026-07-08T18:00:00.000Z',
      mode: 'manual',
    })

    await vi.waitFor(() => {
      expect(refreshedInstances).toEqual(['connector-instance-first'])
    })

    const secondRun = await client.connectors.runs.trigger({
      connectorInstanceId: 'connector-instance-second',
      coverageStartedAt: '2026-07-08T17:00:00.000Z',
      coverageEndedAt: '2026-07-08T18:00:00.000Z',
      mode: 'manual',
    })

    expect(secondRun).toMatchObject({
      connectorInstanceId: 'connector-instance-second',
      status: 'completed',
    })
    await expect(client.connectors.runs.list({
      connectorInstanceId: 'connector-instance-first',
    })).resolves.toMatchObject({
      items: [{ status: 'running' }],
      total: 1,
    })

    releaseFirstRefresh?.()
    await expect(firstRunPromise).resolves.toMatchObject({
      connectorInstanceId: 'connector-instance-first',
      status: 'completed',
    })
    expect(refreshedInstances).toEqual([
      'connector-instance-first',
      'connector-instance-second',
    ])
  })
})
