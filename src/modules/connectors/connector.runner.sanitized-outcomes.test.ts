import { describe, expect, it } from 'vitest'
import { createConnectorRunner, type AppJobConnector } from './connector.runner'
import { createConnectorRepositoryTestContext } from './connector.repository.pglite-test-helpers'

const canary = 'provider-secret-diagnostic-canary-89'
const coverage = {
  start: '2026-07-01T00:00:00.000Z',
  end: '2026-07-18T00:00:00.000Z',
}

describe('connector runner — sanitized public outcomes', () => {
  it('converts a secret-bearing refresh throw into a fixed nominal execution error', async () => {
    const { repository } = await createConnectorRepositoryTestContext()
    const connector: AppJobConnector = {
      definition: { id: 'fixture.jobs', version: '1.0.0' },
      async refresh() {
        throw createHostileAdapterFailure(canary)
      },
    }
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
    await runner.registerInstance({
      id: 'refresh-throw-instance', connector,
      displayName: 'Refresh throw fixture', enabled: true,
    })

    let caught: unknown
    try {
      await runner.refresh(connector, {
        connectorInstanceId: 'refresh-throw-instance', mode: 'manual', coverage,
      })
    } catch (error) {
      caught = error
    }

    assertFreshFixedNominal(caught, canary)
    await expect(repository.listRuns({ connectorInstanceId: 'refresh-throw-instance' }))
      .resolves.toMatchObject({ items: [], total: 0 })
  })

  it('converts a hostile Proxy refresh throw into a fixed nominal execution error', async () => {
    const { repository } = await createConnectorRepositoryTestContext()
    const connector: AppJobConnector = {
      definition: { id: 'fixture.jobs', version: '1.0.0' },
      async refresh() {
        throw createHostilePrototypeProxy(canary)
      },
    }
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
    await runner.registerInstance({
      id: 'refresh-proxy-instance', connector,
      displayName: 'Refresh proxy fixture', enabled: true,
    })

    let caught: unknown
    try {
      await runner.refresh(connector, {
        connectorInstanceId: 'refresh-proxy-instance', mode: 'manual', coverage,
      })
    } catch (error) {
      caught = error
    }

    assertFreshFixedNominal(caught, canary)
  })

  it('closes connector diagnostics before runner and PGlite projections', async () => {
    const { repository } = await createConnectorRepositoryTestContext()
    let privateAccessorRead = false
    const connector = hostileConnector(() => { privateAccessorRead = true })
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
    await runner.registerInstance({
      id: 'sanitized-outcomes-instance', connector,
      displayName: 'Sanitized outcomes fixture', enabled: true,
    })

    const run = await runner.refresh(connector, {
      connectorInstanceId: 'sanitized-outcomes-instance', mode: 'manual', coverage,
    })
    const checkpoint = await repository.getCheckpoint({
      connectorInstanceId: 'sanitized-outcomes-instance', filterSignature: 'filters:{}',
    })
    const observations = await repository.listObservations({
      connectorInstanceId: 'sanitized-outcomes-instance', connectorRunId: run.id,
    })
    const synchronization = await repository.getRunSynchronization(run.id)

    expect(run).toMatchObject({
      status: 'failed', observationCount: 1,
      retryHints: { state: 'scheduled', reason: 'server_failure', attempt: 1 },
      stats: {
        observations: 1, attempted: 2, providerInvalid: 0, stopReason: 'failed',
      },
      warnings: [{
        code: 'source.failed',
        message: 'The connector source request failed.',
      }],
    })
    expect(run.stats).not.toHaveProperty('providerBody')
    expect(run.stats).not.toHaveProperty('failures')
    expect(synchronization).toEqual({
      newestFrontier: { state: 'not_started' },
      historicalBackfill: {
        state: 'not_started', boundary: { earliestDate: '1970-01-01' },
      },
      pendingResolutionCount: 0,
      outcome: { kind: 'failed', reason: 'connector_execution_failed' },
    })
    expect(checkpoint?.checkpoint).toEqual({ cursor: 'preserved', failures: 7 })
    expect(observations).toHaveLength(1)
    expect(observations[0]).toMatchObject({ sourceRecordKey: 'fixture.jobs:preserved' })
    expect(privateAccessorRead).toBe(false)
    expect(JSON.stringify({ run, checkpoint, observations, synchronization })).not.toContain(canary)
    const requeue = await repository.recordRunRequest({
      connectorInstanceId: 'sanitized-outcomes-instance', mode: 'manual',
      startedAt: '2026-07-18T00:00:01.000Z',
    })
    expect(requeue).toMatchObject({
      acquired: true,
      acquiredWork: { kind: 'connector_capture' },
    })
  })
})

function hostileConnector(onPrivateAccessorRead: () => void): AppJobConnector {
  const warning = withHostileExtra({
    code: 'source.failed',
    get message() { return canary },
  }, onPrivateAccessorRead)
  const stats = withHostileExtra({
    observations: 1, attempted: 2, providerInvalid: -1,
    stopReason: canary, providerBody: canary,
  }, onPrivateAccessorRead)
  const synchronization = withHostileExtra({
    newestFrontier: { state: canary },
    historicalBackfill: {
      state: canary, boundary: { earliestDate: canary },
    },
    pendingResolutionCount: -1,
    outcome: { kind: 'failed', reason: canary },
  }, onPrivateAccessorRead)
  return {
    definition: { id: 'fixture.jobs', version: '1.0.0' },
    async refresh() {
      return {
        observations: [fixtureObservation()],
        nextCheckpoint: {
          checkpoint: { cursor: 'preserved', failures: 7 }, schemaVersion: 'fixture@1',
        },
        coverage,
        stats,
        warnings: [warning],
        status: 'failed',
        retryHints: {
          state: 'scheduled', reason: 'server_failure', attempt: 1, maxAttempts: 3,
          lastAttemptAt: '2026-07-18T00:00:00.000Z', computedDelayMs: 1_000,
          nextAttemptAt: '2026-07-18T00:00:01.000Z',
          horizonAt: '2026-07-18T01:00:00.000Z',
        },
        operationOutcome: null,
        synchronization,
      }
    },
  } as unknown as AppJobConnector
}

function withHostileExtra<T extends object>(value: T, onRead: () => void): T {
  Object.defineProperty(value, 'providerPrivateAccessor', {
    enumerable: true,
    get() {
      onRead()
      throw new Error(canary)
    },
  })
  return value
}

function createHostileAdapterFailure(secret: string) {
  const failure = new Error(secret, { cause: new Error(`nested-${secret}`) })
  Object.assign(failure, {
    detail: secret,
    providerBody: { token: secret },
    nested: { diagnostic: secret },
  })
  return failure
}

function createHostilePrototypeProxy(secret: string) {
  return new Proxy(
    { message: secret, detail: secret },
    {
      getPrototypeOf() {
        throw new Error(`getPrototypeOf:${secret}`)
      },
    },
  )
}

function assertFreshFixedNominal(caught: unknown, secret: string) {
  expect(caught).toMatchObject({
    name: 'ConnectorExecutionError',
    message: 'Connector execution failed.',
    statusCode: 500,
  })
  expect(caught).toBeInstanceOf(Error)
  expect((caught as Error).cause).toBeUndefined()
  expect(Object.getOwnPropertyNames(caught as object)).toEqual([
    'stack',
    'message',
    'statusCode',
    'name',
  ])
  expect(Reflect.ownKeys(caught as object)).toEqual([
    'stack',
    'message',
    'statusCode',
    'name',
  ])
  expect(JSON.stringify(caught, Object.getOwnPropertyNames(caught as object))).not.toContain(secret)
  expect(String(caught)).not.toContain(secret)
}

function fixtureObservation() {
  return {
    connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
    parserVersion: 'fixture@1', observationSchemaVersion: 'job-observation@2',
    sourceRecordKey: 'fixture.jobs:preserved', observedAt: '2026-07-18T00:00:00.000Z',
    companyName: 'Example Robotics', roleTitle: 'Software Engineer',
    links: { source: 'https://example.test/job', intermediary: null, official: null },
    resolution: { status: 'unresolved', method: null, reason: null },
    dedupeKeys: ['fixture.jobs:preserved'], sourceMetadata: {}, evidence: [],
  }
}
