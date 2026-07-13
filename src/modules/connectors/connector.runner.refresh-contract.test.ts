import { describe, expect, it } from 'vitest'
import { createDrizzleDatabase, createInMemoryDatabase, migrateDatabase } from '../../db/sqlite'
import { createConnectorRunner, type AppJobConnector } from './connector.runner'
import { createSqliteConnectorRepository } from './connector.repository'
import { createSourceExecutionGovernor } from '../source-execution/source-execution-governor'

const coverage = {
  start: '2026-07-01T00:00:00.000Z',
  end: '2026-07-12T00:00:00.000Z',
}

describe('connector refresh result contract', () => {
  it('rejects obsolete partial success before persisting a run or advancing a checkpoint', async () => {
    await expectRejectedResult({ ...validRefreshResult(), status: ['partial', '_success'].join('') }, /invalid connector refresh status/i)
  })

  it('rejects an absent terminal status before persistence', async () => {
    const { status: _status, ...withoutStatus } = validRefreshResult()
    await expectRejectedResult(withoutStatus, /invalid connector refresh status/i)
  })

  it('rejects a misspelled terminal status before persistence', async () => {
    await expectRejectedResult({ ...validRefreshResult(), status: 'complete' }, /invalid connector refresh status/i)
  })

  it('rejects absent synchronization before persistence', async () => {
    const { synchronization: _synchronization, ...withoutSynchronization } = validRefreshResult()
    await expectRejectedResult(withoutSynchronization, /invalid connector refresh synchronization/i)
  })

  it('rejects invalid explicit synchronization before persistence', async () => {
    await expectRejectedResult({
      ...validRefreshResult(),
      synchronization: { ...validRefreshResult().synchronization, pendingResolutionCount: -1 },
    }, /invalid connector refresh synchronization/i)
  })

  it('rejects a non-Gregorian backfill boundary before persistence', async () => {
    await expectRejectedResult({
      ...validRefreshResult(),
      synchronization: {
        ...validRefreshResult().synchronization,
        historicalBackfill: { state: 'not_started', boundary: { earliestDate: '2026-99-99' } },
      },
    }, /invalid connector refresh synchronization/i)
  })

  it('rejects an invalid typed operation outcome before persistence', async () => {
    await expectRejectedResult({
      ...validRefreshResult(), operationOutcome: { kind: 'scope_rate_limited' },
    }, /invalid connector refresh operation outcome/i)
  })

  it.each([
    { kind: 'scope_rate_limited', executionScopeId: 'scope_valid', retryAt: 'not-a-date', serverMinimumDelayMs: 1 },
    { kind: 'scope_rate_limited', executionScopeId: 'scope_valid', retryAt: '2026-07-12T12:00:00.000Z', serverMinimumDelayMs: -1 },
    { kind: 'scope_rate_limited', executionScopeId: 'short', retryAt: '2026-07-12T12:00:00.000Z', serverMinimumDelayMs: 1 },
  ])('rejects malformed released operation evidence %# before persistence', async (operationOutcome) => {
    await expectRejectedResult({ ...validRefreshResult(), operationOutcome }, /invalid connector refresh operation outcome/i)
  })

  it('rejects validly shaped operation evidence owned by another execution scope', async () => {
    await expectRejectedResult({
      ...validRefreshResult(),
      operationOutcome: {
        kind: 'scope_rate_limited', executionScopeId: 'scope_unrelated',
        retryAt: '2026-07-12T12:00:00.000Z', serverMinimumDelayMs: 1,
      },
    }, /invalid connector refresh operation outcome scope/i)
  })

  it('rejects malformed cooldown evidence before mutating the execution scope', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const governor = createSourceExecutionGovernor(database)
    const connector = adversarialConnector({
      ...validRefreshResult(),
      operationOutcome: {
        kind: 'scope_rate_limited', executionScopeId: 'scope_contract',
        retryAt: 'not-a-date', serverMinimumDelayMs: -1,
      },
    })
    const runner = createConnectorRunner({ repository, sourceExecutionGovernor: governor, workspaceId: 'workspace-fixture' })
    const instance = await runner.registerInstance({ id: 'contract-instance', connector, displayName: 'Contract', enabled: true })

    await expect(runner.refresh(connector, {
      connectorInstanceId: instance.id, mode: 'manual', coverage,
    })).rejects.toThrow(/invalid connector refresh operation outcome/i)
    expect(governor.getScope(instance.executionScopeId)).toMatchObject({ status: 'available', blockedUntil: null })
    await expect(repository.listRuns({ connectorInstanceId: instance.id })).resolves.toMatchObject({ items: [], total: 0 })
    sqlite.close()
  })

  it('rejects scope cooldown evidence paired with a caught-up synchronization outcome before mutation', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const database = createDrizzleDatabase(sqlite)
    const repository = createSqliteConnectorRepository(database)
    const governor = createSourceExecutionGovernor(database)
    const connector = {
      definition: { id: 'fixture.contract', version: '1.0.0' },
      async refresh(input) {
        return {
          ...validRefreshResult(),
          operationOutcome: {
            kind: 'scope_rate_limited' as const, executionScopeId: input.executionScopeId,
            retryAt: '2026-07-12T12:02:00.000Z', serverMinimumDelayMs: 120_000,
          },
        }
      },
    } satisfies AppJobConnector
    const runner = createConnectorRunner({ repository, sourceExecutionGovernor: governor, workspaceId: 'workspace-fixture' })
    const instance = await runner.registerInstance({ id: 'contract-instance', connector, displayName: 'Contract', enabled: true })

    await expect(runner.refresh(connector, {
      connectorInstanceId: instance.id, mode: 'manual', coverage,
    })).rejects.toThrow(/inconsistent connector refresh operation outcome/i)
    expect(governor.getScope(instance.executionScopeId)).toMatchObject({ status: 'available', blockedUntil: null })
    await expect(repository.listRuns({ connectorInstanceId: instance.id })).resolves.toMatchObject({ items: [], total: 0 })
    sqlite.close()
  })

  it('rejects a cooling-down synchronization outcome without matching scope evidence before persistence', async () => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    const connector = {
      definition: { id: 'fixture.contract', version: '1.0.0' },
      async refresh(input) {
        const operation = {
          kind: 'scope_rate_limited' as const, executionScopeId: input.executionScopeId,
          retryAt: '2026-07-12T12:02:00.000Z', serverMinimumDelayMs: 120_000,
        }
        return {
          ...validRefreshResult(),
          synchronization: synchronizationForOutcome({ kind: 'cooling_down', operation }),
        }
      },
    } satisfies AppJobConnector
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
    const instance = await runner.registerInstance({ id: 'contract-instance', connector, displayName: 'Contract', enabled: true })

    await expect(runner.refresh(connector, {
      connectorInstanceId: instance.id, mode: 'manual', coverage,
    })).rejects.toThrow(/inconsistent connector refresh operation outcome/i)
    await expect(repository.listRuns({ connectorInstanceId: instance.id })).resolves.toMatchObject({ items: [], total: 0 })
    sqlite.close()
  })

  it.each([
    { attempt: 0, lastAttemptAt: '2026-07-12T12:00:00.000Z' },
    { attempt: 1, lastAttemptAt: 'not-an-instant' },
  ])('rejects malformed released retry advice %# before persistence', async ({ attempt, lastAttemptAt }) => {
    await expectRejectedResult({
      ...validRefreshResult(),
      retryHints: {
        state: 'scheduled', reason: 'server_failure', attempt, maxAttempts: 3, lastAttemptAt,
        computedDelayMs: 1, nextAttemptAt: '2026-07-12T12:00:01.000Z',
        horizonAt: '2026-07-12T13:00:00.000Z',
      },
    }, /invalid connector refresh retry advice/i)
  })

  it.each(['', 'x'.repeat(513)])('rejects an invalid synchronization reason before persistence', async (reason) => {
    await expectRejectedResult({
      ...validRefreshResult(), status: 'failed',
      synchronization: synchronizationForOutcome({ kind: 'failed', reason }),
    }, /invalid connector refresh synchronization/i)
  })

  it('rejects contradictory terminal status and synchronization outcome', async () => {
    await expectRejectedResult({
      ...validRefreshResult(), synchronization: synchronizationForOutcome({ kind: 'failed', reason: 'failed' }),
    }, /invalid connector refresh synchronization/i)
  })

  it.each([
    { ...validRefreshResult(), coverage: { start: 'not-an-instant', end: coverage.end } },
    { ...validRefreshResult(), stats: { observations: -1 } },
    { ...validRefreshResult(), nextCheckpoint: { checkpoint: {}, schemaVersion: '' } },
    { ...validRefreshResult(), warnings: [{ code: '', message: 'warning' }] },
  ])('rejects malformed required result fields %# before persistence', async (result) => {
    await expectRejectedResult(result, /invalid connector refresh result/i)
  })

  it.each([
    ['completed', { kind: 'caught_up' }],
    ['failed', { kind: 'failed', reason: 'fixture_failure' }],
    ['cancelled', { kind: 'cancelled', reason: 'cancelled' }],
    ['skipped', { kind: 'yielded', reason: 'invocation_budget' }],
  ] as const)('persists released %s semantics with explicit synchronization', async (status, outcome) => {
    const sqlite = createInMemoryDatabase()
    migrateDatabase(sqlite)
    const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
    const connector = adversarialConnector({
      ...validRefreshResult(), status,
      synchronization: synchronizationForOutcome(outcome),
    })
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
    await runner.registerInstance({ id: 'contract-instance', connector, displayName: 'Contract', enabled: true })

    await expect(runner.refresh(connector, {
      connectorInstanceId: 'contract-instance', mode: 'manual', coverage,
    })).resolves.toMatchObject({ status })
    const runs = await repository.listRuns({ connectorInstanceId: 'contract-instance' })
    expect(repository.getRunSynchronization(runs.items[0]!.id)).toMatchObject({ outcome })
    sqlite.close()
  })
})

function validRefreshResult() {
  return {
    observations: [],
    nextCheckpoint: { checkpoint: { cursor: 'advanced' }, schemaVersion: 'fixture@1' },
    coverage,
    stats: { observations: 0 },
    warnings: [],
    status: 'completed',
    retryHints: null,
    operationOutcome: null,
    synchronization: {
      newestFrontier: { state: 'caught_up' },
      historicalBackfill: { state: 'caught_up', boundary: { earliestDate: '2026-07-01' } },
      pendingResolutionCount: 0,
      outcome: { kind: 'caught_up' },
    },
  }
}

function synchronizationForOutcome(outcome: { kind: string; reason?: string; operation?: unknown }) {
  if (outcome.kind === 'caught_up') return validRefreshResult().synchronization
  return {
    newestFrontier: { state: 'advancing' },
    historicalBackfill: { state: 'advancing', boundary: { earliestDate: '2026-07-01' } },
    pendingResolutionCount: 1,
    outcome,
  }
}

function adversarialConnector(result: unknown): AppJobConnector {
  return {
    definition: { id: 'fixture.contract', version: '1.0.0' },
    async refresh() { return result },
  } as unknown as AppJobConnector
}

async function expectRejectedResult(result: unknown, message: RegExp) {
  const sqlite = createInMemoryDatabase()
  migrateDatabase(sqlite)
  const repository = createSqliteConnectorRepository(createDrizzleDatabase(sqlite))
  const connector = adversarialConnector(result)
  const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
  await runner.registerInstance({ id: 'contract-instance', connector, displayName: 'Contract', enabled: true })

  await expect(runner.refresh(connector, {
    connectorInstanceId: 'contract-instance', mode: 'manual', coverage,
  })).rejects.toThrow(message)
  await expect(repository.listRuns({ connectorInstanceId: 'contract-instance' }))
    .resolves.toMatchObject({ items: [], total: 0 })
  await expect(repository.getCheckpoint({
    connectorInstanceId: 'contract-instance', filterSignature: 'filters:{}',
  })).resolves.toBeNull()
  sqlite.close()
}
