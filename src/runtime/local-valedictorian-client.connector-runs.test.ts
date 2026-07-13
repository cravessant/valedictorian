import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalValedictorianClient as createRuntimeLocalValedictorianClient } from './local-valedictorian-client'
import { createDrizzleDatabase, createFileDatabase } from '../db/sqlite'
import { createSqliteConnectorRepository } from '../modules/connectors/connector.repository'
import { createStaticConnectorRegistry } from '../modules/connectors/connector.registry'
import type { AppJobConnector } from '../modules/connectors/connector.runner'

function createTempSqlitePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-client-')), 'valedictorian.sqlite')
}


describe('runtime local Valedictorian client', () => {
  const originalReferenceTrackerPath = process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH

  beforeEach(() => {
    process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH = path.join(
      os.tmpdir(),
      'valedictorian-missing-reference-tracker.md',
    )
  })

  afterEach(() => {
    if (originalReferenceTrackerPath === undefined) {
      delete process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH
    } else {
      process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH = originalReferenceTrackerPath
    }
  })

  it('creates and updates connector instances through the local client', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              observedAt: '2026-07-08T18:00:00.000Z',
            })
            : null
        },
      },
      seedDataMode: 'none',
      sqlitePath,
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

  it('does not reinterpret legacy connector observations as sourcing findings', async () => {
    const sqlitePath = createTempSqlitePath()
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              observedAt: '2026-07-08T18:00:00.000Z',
            })
            : null
        },
      },
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'workspace-fixture',
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-08T15:00:00.000Z',
    })

    const run = await client.connectors.runs.trigger({
      connectorInstanceId: 'connector-instance-fixture',
      coverageStartedAt: '2026-07-08T17:00:00.000Z',
      coverageEndedAt: '2026-07-08T18:00:00.000Z',
      mode: 'manual',
    })
    const observations = await client.connectors.observations.list({
      connectorInstanceId: 'connector-instance-fixture',
      connectorRunId: run.id,
    })
    const findings = await client.sourcing.findings.list({
      source: 'fixture.jobs',
    })
    const checkpoints = await client.connectors.checkpoints.list({
      connectorInstanceId: 'connector-instance-fixture',
      filterSignature: 'filters:{}',
    })

    expect(run).toMatchObject({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      observationCount: 1,
      stats: {
        observations: 1,
        lifecycleCounts: {
          source: 'frozen_terminal',
          provider: { capturedRecords: 0 },
          sourcing: { added: 0 },
        },
        stage: 'finalizing',
      },
      status: 'completed',
    })
    expect(observations).toMatchObject({
      items: [
        {
          companyName: 'Example Robotics',
          roleTitle: 'Software Engineering Intern',
        },
      ],
      total: 1,
    })
    expect(findings).toMatchObject({ items: [], total: 0 })
    expect(checkpoints.items).toMatchObject([
      {
        checkpoint: {
          cursor: 'fixture:2026-07-08T18:00:00.000Z',
        },
        coverage: {
          end: '2026-07-08T18:00:00.000Z',
          start: '2026-07-01T00:00:00.000Z',
        },
      },
    ])
    sqlite.close()
  })

  it('does not use legacy observation dedupe keys as sourcing identity', async () => {
    const sqlitePath = createTempSqlitePath()
    const baseConnector = fixtureConnector({
      additionalCompanyNames: ['Example Robotics'],
      observedAt: '2026-07-08T18:00:00.000Z',
    })
    const connector: AppJobConnector = {
      ...baseConnector,
      async refresh(input, runtime) {
        const result = await baseConnector.refresh(input, runtime)
        const first = result.observations[0]
        const second = result.observations[1]

        if (!first || !second) {
          throw new Error('Expected duplicate fixture observations')
        }

        return {
          ...result,
          observations: [
            {
              ...first,
              dedupeKeys: ['provider:fixture:shared-job'],
            },
            {
              ...second,
              companyName: first.companyName,
              dedupeKeys: ['provider:fixture:shared-job'],
              links: {
                source: 'https://www.linkedin.com/jobs/view/shared-job',
                intermediary: first.links.source,
                official: null,
              },
              resolution: {
                status: 'resolved',
                method: 'fixture',
                reason: null,
              },
              roleTitle: 'Software Engineering Intern - Updated',
              sourceMetadata: {
                fixture: true,
                destinationClass: 'third_party_job_posting',
              },
            },
          ],
          stats: { observations: 2 },
        }
      },
    }
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'workspace-fixture',
    })
    const sqlite = createFileDatabase(sqlitePath)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    await repository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
    })

    const run = await client.connectors.runs.trigger({
      connectorInstanceId: 'connector-instance-fixture',
      coverageStartedAt: '2026-07-08T17:00:00.000Z',
      coverageEndedAt: '2026-07-08T18:00:00.000Z',
      mode: 'manual',
    })
    const findings = await client.sourcing.findings.list({ source: 'fixture.jobs' })

    expect(run).toMatchObject({
      observationCount: 2,
      stats: {
        lifecycleCounts: {
          source: 'frozen_terminal',
          provider: { capturedRecords: 0 },
          sourcing: { added: 0 },
        },
      },
    })
    expect(findings).toMatchObject({ total: 0, items: [] })
    sqlite.close()
  })

  it('persists two truthful non-terminal connector progress snapshots before completion', async () => {
    const sqlitePath = createTempSqlitePath()
    let releaseAuthentication: (() => void) | undefined
    let releaseNormalization: (() => void) | undefined
    const authenticationGate = new Promise<void>((resolve) => {
      releaseAuthentication = resolve
    })
    const normalizationGate = new Promise<void>((resolve) => {
      releaseNormalization = resolve
    })
    const baseConnector = fixtureConnector({ observedAt: '2026-07-08T18:00:00.000Z' })
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
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'workspace-fixture',
    })
    const sqlite = createFileDatabase(sqlitePath)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
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
    sqlite.close()
  })

  it('persists one running row before refresh settles and completes that same run', async () => {
    const sqlitePath = createTempSqlitePath()
    let releaseRefresh: (() => void) | undefined
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: {
        get(connectorId) {
          return connectorId === 'fixture.jobs'
            ? fixtureConnector({
              observedAt: '2026-07-08T18:00:00.000Z',
              waitForRefresh: refreshGate,
            })
            : null
        },
      },
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'workspace-fixture',
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

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
    sqlite.close()
  })

  it('returns one active run across clients when concurrent triggers target the same connector instance', async () => {
    const sqlitePath = createTempSqlitePath()
    let releaseRefresh: (() => void) | undefined
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    const connector = fixtureConnector({
      observedAt: '2026-07-08T18:00:00.000Z',
      waitForRefresh: refreshGate,
    })
    const refresh = vi.fn((
      input: Parameters<AppJobConnector['refresh']>[0],
      runtime: Parameters<AppJobConnector['refresh']>[1],
    ) => connector.refresh(input, runtime))
    const clientOptions = {
      connectorRegistry: createStaticConnectorRegistry([{ ...connector, refresh }]),
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'workspace-fixture',
    } as const
    const firstClient = createRuntimeLocalValedictorianClient(clientOptions)
    const secondClient = createRuntimeLocalValedictorianClient(clientOptions)
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

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
    sqlite.close()
  })

  it('runs different connector instances independently in the same workspace', async () => {
    const sqlitePath = createTempSqlitePath()
    let releaseFirstRefresh: (() => void) | undefined
    const firstRefreshGate = new Promise<void>((resolve) => {
      releaseFirstRefresh = resolve
    })
    const baseConnector = fixtureConnector({
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
    const client = createRuntimeLocalValedictorianClient({
      connectorRegistry: createStaticConnectorRegistry([connector]),
      seedDataMode: 'none',
      sqlitePath,
      workspaceId: 'workspace-fixture',
    })
    const sqlite = createFileDatabase(sqlitePath)
    const database = createDrizzleDatabase(sqlite)
    const connectorRepository = createSqliteConnectorRepository(database)

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
    sqlite.close()
  })

})

function fixtureConnector({
  additionalCompanyNames = [],
  companyName = 'Example Robotics',
  observedAt,
  throwOnRefresh = false,
  waitForRefresh,
}: {
  additionalCompanyNames?: string[]
  companyName?: string
  observedAt: string
  throwOnRefresh?: boolean
  waitForRefresh?: Promise<void>
}): AppJobConnector {
  return {
    definition: {
      id: 'fixture.jobs',
      version: '0.0.0-fixture',
    },
    async refresh(input) {
      await waitForRefresh

      if (throwOnRefresh) {
        throw new Error('Fixture connector refresh failed')
      }
      const observations = [companyName, ...additionalCompanyNames].map((observationCompanyName, index) => {
        const slug = index === 0
          ? 'software-engineering-intern'
          : `software-engineering-intern-${index + 1}`

        return {
          connectorId: 'fixture.jobs',
          connectorVersion: '0.0.0-fixture',
          sourceRecordKey: `fixture.jobs:${slug}`,
          observedAt,
          companyName: observationCompanyName,
          roleTitle: 'Software Engineering Intern',
          locationRaw: 'Remote',
          descriptionText: 'Build fixture robots and connector proofs.',
          pay: null,
          links: {
            source: `https://example.test/jobs/${slug}`,
            intermediary: null,
            official: `https://jobs.example.com/apply/${slug}`,
          },
          resolution: {
            status: 'resolved',
            method: 'fixture',
            reason: null,
          },
          dedupeKeys: [`official:https://jobs.example.com/apply/${slug}`],
          sourceMetadata: {
            fixture: true,
            destinationClass: 'employer_or_ats',
          },
          evidence: [
            {
              type: 'fixture',
              capturedAt: observedAt,
              sourceUrl: `https://example.test/jobs/${slug}`,
            },
          ],
        }
      })

      return {
        coverage: input.coverage,
        nextCheckpoint: {
          checkpoint: {
            cursor: `fixture:${observedAt}`,
          },
          schemaVersion: 'fixture-checkpoint@1',
        },
        observations,
        stats: {
          observations: observations.length,
        },
        warnings: [],
        operationOutcome: null,
        status: 'completed',
        synchronization: {
          newestFrontier: { state: 'caught_up' },
          historicalBackfill: { state: 'caught_up', boundary: { earliestDate: input.coverage.start.slice(0, 10) } },
          pendingResolutionCount: 0,
          outcome: { kind: 'caught_up' },
        },
      }
    },
  }
}
