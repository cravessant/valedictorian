import { describe, expect, it } from 'vitest'
import { createStaticConnectorRegistry } from '../core/connector.registry'
import { createConnectorRunner } from './connector.runner'
import { createConnectorRepositoryTestContext } from './persistence/connector.repository.pglite-test-helpers'
import { executeClaimedConnectorRun } from '../core/connector.claimed-execution'

describe('shared claimed connector run executor', () => {
  it('rejects a claimed run whose stored connector version drifted, without mutating anything', async () => {
    const { repository: connectorRepository } = await seededDriftFixture()
    const now = () => new Date('2026-07-13T16:00:00.000Z')
    const queued = await claimCatchUpRun(connectorRepository)
    let refreshCalls = 0

    await expect(executeClaimedConnectorRun({
      connectorRegistry: createStaticConnectorRegistry([
        checkpointResumingConnector('2.0.0', () => { refreshCalls += 1 }),
      ]),
      connectorRepository,
      connectorRunner: createConnectorRunner({
        repository: connectorRepository,
        workspaceId: 'workspace-fixture',
        now,
      }),
      connectorRunId: queued.id,
      coverageEndedAt: '2026-07-13T16:00:00.000Z',
      mode: 'catch_up',
      now,
      startedAt: '2026-07-13T16:00:00.000Z',
    })).rejects.toThrow('Connector version mismatch for fixture.upgrade: expected 2.0.0')

    expect(refreshCalls).toBe(0)
    await expect(connectorRepository.getInstance('claimed-upgrade')).resolves.toMatchObject({
      connectorVersion: '1.0.0',
      config: { pageSize: 20 },
      filters: { role: 'intern' },
    })
    await expect(connectorRepository.listCheckpoints({ connectorInstanceId: 'claimed-upgrade' }))
      .resolves.toMatchObject([{
        filterSignature: 'filters:{"role":"intern"}',
        checkpoint: { cursor: 60 },
      }])
    const failed = await connectorRepository.getRun(queued.id)
    expect(failed).toMatchObject({ id: queued.id, status: 'failed' })
    expect(JSON.stringify(failed?.warnings ?? [])).not.toMatch(/version mismatch/i)
  })

  it('resumes the persisted checkpoint when the stored connector version matches', async () => {
    const { repository: connectorRepository } = await seededDriftFixture()
    const now = () => new Date('2026-07-13T16:00:00.000Z')
    const queued = await claimCatchUpRun(connectorRepository)
    let receivedCheckpoint: unknown

    await expect(executeClaimedConnectorRun({
      connectorRegistry: createStaticConnectorRegistry([
        checkpointResumingConnector('1.0.0', (checkpoint) => { receivedCheckpoint = checkpoint }),
      ]),
      connectorRepository,
      connectorRunner: createConnectorRunner({
        repository: connectorRepository,
        workspaceId: 'workspace-fixture',
        now,
      }),
      connectorRunId: queued.id,
      coverageEndedAt: '2026-07-13T16:00:00.000Z',
      mode: 'catch_up',
      now,
      startedAt: '2026-07-13T16:00:00.000Z',
    })).resolves.toMatchObject({ id: queued.id, status: 'completed' })

    expect(receivedCheckpoint).toEqual({ cursor: 60 })
    await expect(connectorRepository.getInstance('claimed-upgrade')).resolves.toMatchObject({
      connectorVersion: '1.0.0',
      auth: [{ id: 'fixture', mode: 'api_key', secretKey: 'fixture-reference' }],
      config: { pageSize: 20 },
      filters: { role: 'intern' },
      earliestBackfillDate: '2026-07-01',
    })
  })

  it('marks the claimed run failed when registry preflight cannot resolve the connector', async () => {
    const { repository: connectorRepository } = await createConnectorRepositoryTestContext()
    const now = () => new Date('2026-07-11T13:00:00.000Z')

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-11T12:00:00.000Z',
    })

    const queued = (await connectorRepository.recordRunRequest({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      startedAt: '2026-07-11T13:00:00.000Z',
      coverageStartedAt: '2026-07-04T00:00:00.000Z',
      coverageEndedAt: '2026-07-11T13:00:00.000Z',
      filterSignature: 'filters:{}',
      filters: {},
    })).run

    const claim = await connectorRepository.claimQueuedRunToRunning({
      connectorRunId: queued.id,
      startedAt: '2026-07-11T13:00:00.000Z',
    })
    expect(claim.claimed).toBe(true)

    await expect(executeClaimedConnectorRun({
      connectorRegistry: createStaticConnectorRegistry([]),
      connectorRepository,
      connectorRunner: createConnectorRunner({
        repository: connectorRepository,
        workspaceId: 'workspace-fixture',
        now,
      }),
      connectorRunId: queued.id,
      coverageEndedAt: '2026-07-11T13:00:00.000Z',
      mode: 'manual',
      now,
      startedAt: '2026-07-11T13:00:00.000Z',
    })).rejects.toThrow(/Unsupported connector id/)

    const failed = await connectorRepository.getRun(queued.id)
    expect(failed).toMatchObject({
      id: queued.id,
      status: 'failed',
    })
    expect(JSON.stringify(failed?.warnings ?? [])).not.toMatch(/Unsupported connector/i)
  })

  it('blocks incomplete persisted settings on an already-claimed scheduled run before refresh', async () => {
    const { repository: connectorRepository } = await createConnectorRepositoryTestContext()
    const now = () => new Date('2026-07-11T13:00:00.000Z')
    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.required',
      connectorVersion: '1.0.0',
      displayName: 'Required settings fixture',
      enabled: true,
      config: {},
      filters: {},
      createdAt: '2026-07-11T12:00:00.000Z',
    })
    const queued = await claimScheduledRun(connectorRepository)
    let refreshCalls = 0

    await expect(executeClaimedConnectorRun({
      connectorRegistry: createStaticConnectorRegistry([
        requiredSettingsConnector(() => { refreshCalls += 1 }),
      ]),
      connectorRepository,
      connectorRunner: createConnectorRunner({
        repository: connectorRepository,
        workspaceId: 'workspace-fixture',
        now,
      }),
      connectorRunId: queued.id,
      coverageEndedAt: '2026-07-11T13:00:00.000Z',
      mode: 'scheduled',
      now,
      startedAt: '2026-07-11T13:00:00.000Z',
    })).rejects.toThrow(/batchSize.*required/i)

    expect(refreshCalls).toBe(0)
    const failed = await connectorRepository.getRun(queued.id)
    expect(failed).toMatchObject({ id: queued.id, status: 'failed' })
    expect(JSON.stringify(failed?.warnings ?? [])).not.toMatch(/batchSize/i)
  })

  it('blocks undeclared persisted settings on an already-claimed scheduled run before refresh', async () => {
    const { repository: connectorRepository } = await createConnectorRepositoryTestContext()
    const now = () => new Date('2026-07-11T13:00:00.000Z')
    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.required',
      connectorVersion: '1.0.0',
      displayName: 'Required settings fixture',
      enabled: true,
      config: { batchSize: 20, undeclaredSetting: 'must-not-reach-the-connector' },
      filters: {},
      createdAt: '2026-07-11T12:00:00.000Z',
    })
    const queued = await claimScheduledRun(connectorRepository)
    let refreshCalls = 0

    await expect(executeClaimedConnectorRun({
      connectorRegistry: createStaticConnectorRegistry([
        requiredSettingsConnector(() => { refreshCalls += 1 }),
      ]),
      connectorRepository,
      connectorRunner: createConnectorRunner({
        repository: connectorRepository,
        workspaceId: 'workspace-fixture',
        now,
      }),
      connectorRunId: queued.id,
      coverageEndedAt: '2026-07-11T13:00:00.000Z',
      mode: 'scheduled',
      now,
      startedAt: '2026-07-11T13:00:00.000Z',
    })).rejects.toThrow(/undeclaredSetting|not declared/i)

    expect(refreshCalls).toBe(0)
    await expect(connectorRepository.getRun(queued.id))
      .resolves.toMatchObject({ id: queued.id, status: 'failed' })
  })

  it('executes an already-claimed scheduled run when persisted settings are complete', async () => {
    const { repository: connectorRepository } = await createConnectorRepositoryTestContext()
    const now = () => new Date('2026-07-11T13:00:00.000Z')
    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.required',
      connectorVersion: '1.0.0',
      displayName: 'Required settings fixture',
      enabled: true,
      config: { batchSize: 20 },
      filters: {},
      createdAt: '2026-07-11T12:00:00.000Z',
    })
    const queued = await claimScheduledRun(connectorRepository)
    let refreshCalls = 0

    await expect(executeClaimedConnectorRun({
      connectorRegistry: createStaticConnectorRegistry([
        requiredSettingsConnector(() => { refreshCalls += 1 }),
      ]),
      connectorRepository,
      connectorRunner: createConnectorRunner({
        repository: connectorRepository,
        workspaceId: 'workspace-fixture',
        now,
      }),
      connectorRunId: queued.id,
      coverageEndedAt: '2026-07-11T13:00:00.000Z',
      mode: 'scheduled',
      now,
      startedAt: '2026-07-11T13:00:00.000Z',
    })).resolves.toMatchObject({ id: queued.id, status: 'completed' })

    expect(refreshCalls).toBe(1)
  })

  it('marks the claimed run failed when connector refresh throws', async () => {
    const { repository: connectorRepository } = await createConnectorRepositoryTestContext()
    const now = () => new Date('2026-07-11T13:00:00.000Z')

    await connectorRepository.upsertInstance({
      id: 'connector-instance-fixture',
      connectorId: 'fixture.jobs',
      connectorVersion: '0.0.0-fixture',
      displayName: 'Fixture Jobs',
      enabled: true,
      createdAt: '2026-07-11T12:00:00.000Z',
    })

    const queued = (await connectorRepository.recordRunRequest({
      connectorInstanceId: 'connector-instance-fixture',
      mode: 'manual',
      startedAt: '2026-07-11T13:00:00.000Z',
      coverageStartedAt: '2026-07-04T00:00:00.000Z',
      coverageEndedAt: '2026-07-11T13:00:00.000Z',
      filterSignature: 'filters:{}',
      filters: {},
    })).run

    await connectorRepository.claimQueuedRunToRunning({
      connectorRunId: queued.id,
      startedAt: '2026-07-11T13:00:00.000Z',
    })

    await expect(executeClaimedConnectorRun({
      connectorRegistry: createStaticConnectorRegistry([
        {
          definition: { id: 'fixture.jobs', version: '0.0.0-fixture' },
          async refresh() {
            throw new Error('refresh boom with secret detail')
          },
        },
      ]),
      connectorRepository,
      connectorRunner: createConnectorRunner({
        repository: connectorRepository,
        workspaceId: 'workspace-fixture',
        now,
      }),
      connectorRunId: queued.id,
      coverageEndedAt: '2026-07-11T13:00:00.000Z',
      mode: 'manual',
      now,
      startedAt: '2026-07-11T13:00:00.000Z',
    })).rejects.toThrow('Connector execution failed.')

    const failed = await connectorRepository.getRun(queued.id)
    expect(failed).toMatchObject({
      id: queued.id,
      status: 'failed',
    })
    expect(JSON.stringify(failed)).not.toMatch(/secret detail|refresh boom/)
  })
})

async function seededDriftFixture() {
  const context = await createConnectorRepositoryTestContext()
  await context.repository.upsertInstance({
    id: 'claimed-upgrade',
    connectorId: 'fixture.upgrade',
    connectorVersion: '1.0.0',
    displayName: 'Claimed upgrade',
    enabled: true,
    auth: [{ id: 'fixture', mode: 'api_key', secretKey: 'fixture-reference' }],
    config: { pageSize: 20 },
    filters: { role: 'intern' },
    earliestBackfillDate: '2026-07-01',
    createdAt: '2026-07-11T12:00:00.000Z',
  })
  await context.repository.recordCheckpoint({
    connectorInstanceId: 'claimed-upgrade',
    filterSignature: 'filters:{"role":"intern"}',
    checkpoint: { checkpoint: { cursor: 60 }, schemaVersion: 'fixture-checkpoint@1' },
    coverage: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-12T16:00:00.000Z' },
    savedAt: '2026-07-12T16:00:00.000Z',
  })
  return context
}

async function claimCatchUpRun(
  connectorRepository: Awaited<ReturnType<typeof createConnectorRepositoryTestContext>>['repository'],
) {
  const queued = (await connectorRepository.recordRunRequest({
    connectorInstanceId: 'claimed-upgrade',
    mode: 'catch_up',
    startedAt: '2026-07-13T16:00:00.000Z',
    coverageStartedAt: '2026-07-01T00:00:00.000Z',
    coverageEndedAt: '2026-07-13T16:00:00.000Z',
    filterSignature: 'filters:{"role":"intern"}',
    filters: { role: 'intern' },
  })).run
  const claim = await connectorRepository.claimQueuedRunToRunning({
    connectorRunId: queued.id,
    startedAt: '2026-07-13T16:00:00.000Z',
  })
  expect(claim.claimed).toBe(true)
  return queued
}

function checkpointResumingConnector(version: string, onRefresh: (checkpoint: unknown) => void) {
  return {
    definition: {
      id: 'fixture.upgrade',
      version,
      checkpoint: { schemaVersion: 'fixture-checkpoint@1' },
    },
    async refresh(input: { checkpoint?: unknown; coverage: { start: string; end: string } }) {
      onRefresh(input.checkpoint)
      return {
        coverage: input.coverage,
        nextCheckpoint: { checkpoint: { cursor: 80 }, schemaVersion: 'fixture-checkpoint@1' },
        observations: [],
        operationOutcome: null,
        retryHints: null,
        status: 'completed' as const,
        stats: { observations: 0 },
        synchronization: {
          newestFrontier: { state: 'caught_up' as const },
          historicalBackfill: {
            state: 'caught_up' as const,
            boundary: { earliestDate: input.coverage.start.slice(0, 10) },
          },
          pendingResolutionCount: 0,
          outcome: { kind: 'caught_up' as const },
        },
        warnings: [],
      }
    },
  }
}

async function claimScheduledRun(
  connectorRepository: Awaited<ReturnType<typeof createConnectorRepositoryTestContext>>['repository'],
) {
  const queued = (await connectorRepository.recordRunRequest({
    connectorInstanceId: 'connector-instance-fixture',
    mode: 'scheduled',
    startedAt: '2026-07-11T13:00:00.000Z',
    coverageStartedAt: '2026-07-04T00:00:00.000Z',
    coverageEndedAt: '2026-07-11T13:00:00.000Z',
    filterSignature: 'filters:{}',
    filters: {},
  })).run
  const claim = await connectorRepository.claimQueuedRunToRunning({
    connectorRunId: queued.id,
    startedAt: '2026-07-11T13:00:00.000Z',
  })
  expect(claim.claimed).toBe(true)
  return queued
}

function requiredSettingsConnector(onRefresh: () => void) {
  return {
    definition: {
      id: 'fixture.required',
      version: '1.0.0',
      configSchema: {
        version: 'fixture-required-config@1',
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: { batchSize: { type: 'integer' as const, enum: [10, 20] } },
          required: ['batchSize'],
        },
      },
    },
    async refresh(input: { coverage: { start: string; end: string } }) {
      onRefresh()
      return {
        coverage: input.coverage,
        nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-checkpoint@1' },
        observations: [],
        operationOutcome: null,
        retryHints: null,
        status: 'completed' as const,
        stats: { observations: 0 },
        synchronization: {
          newestFrontier: { state: 'caught_up' as const },
          historicalBackfill: {
            state: 'caught_up' as const,
            boundary: { earliestDate: input.coverage.start.slice(0, 10) },
          },
          pendingResolutionCount: 0,
          outcome: { kind: 'caught_up' as const },
        },
        warnings: [],
      }
    },
  }
}
