import { describe, expect, it } from 'vitest'
import { createConnectorRunner, type AppJobConnector } from './connector.runner'
import type {
  ConnectorRefreshInput,
  ConnectorRefreshResult,
} from '@sparxie/valedictorian-connectors-core'
import { createSourceExecutionGovernor } from '../source-execution/source-execution-governor'
import {
  useResettablePgliteTestConnectorRepositoryContext,
} from './connector.repository.pglite-test-helpers'

const coverage = {
  start: '2026-07-01T00:00:00.000Z',
  end: '2026-07-12T00:00:00.000Z',
}

describe.sequential('connector refresh result contract', () => {
  const createConnectorRepositoryTestContext
    = useResettablePgliteTestConnectorRepositoryContext()
  it('rejects malformed cooldown evidence before mutating the execution scope', async () => {
    const { database, repository } = await createConnectorRepositoryTestContext()
    const governor = createSourceExecutionGovernor(database)
    const connector = adversarialConnector({
      ...validRefreshResult(),
      operationOutcome: {
        kind: 'scope_rate_limited', executionScopeId: 'scope_contract',
        retryAt: 'not-a-date', serverMinimumDelayMs: -1,
      },
    })
    const runner = createConnectorRunner({
      repository, sourceExecutionGovernor: governor, workspaceId: 'workspace-fixture',
    })
    const instance = await runner.registerInstance({
      id: 'contract-instance', connector, displayName: 'Contract', enabled: true,
    })

    const caught = await captureRefreshError(runner, connector, instance.id)
    expectUnexpectedConnectorExecutionError(caught)
    expect(await governor.getScope(instance.executionScopeId)).toMatchObject({
      status: 'available', blockedUntil: null,
    })
    await expect(repository.listRuns({ connectorInstanceId: instance.id }))
      .resolves.toMatchObject({ items: [], total: 0 })
    await expect(repository.getCheckpoint({
      connectorInstanceId: instance.id,
      filterSignature: 'filters:{}',
    })).resolves.toBeNull()
  })

  it('rejects scope cooldown evidence paired with a caught-up synchronization outcome before mutation', async () => {
    const { database, repository } = await createConnectorRepositoryTestContext()
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
    const runner = createConnectorRunner({
      repository, sourceExecutionGovernor: governor, workspaceId: 'workspace-fixture',
    })
    const instance = await runner.registerInstance({
      id: 'contract-instance', connector, displayName: 'Contract', enabled: true,
    })

    const caught = await captureRefreshError(runner, connector, instance.id)
    expectUnexpectedConnectorExecutionError(caught)
    expect(await governor.getScope(instance.executionScopeId)).toMatchObject({
      status: 'available', blockedUntil: null,
    })
    await expect(repository.listRuns({ connectorInstanceId: instance.id }))
      .resolves.toMatchObject({ items: [], total: 0 })
  })

  it('rejects a cooling-down synchronization outcome without matching scope evidence before persistence', async () => {
    const { repository } = await createConnectorRepositoryTestContext()
    const connector = adversarialRefreshConnector((input) => {
      const operation = {
        kind: 'scope_rate_limited' as const, executionScopeId: input.executionScopeId,
        retryAt: '2026-07-12T12:02:00.000Z', serverMinimumDelayMs: 120_000,
      }
      return {
        ...validRefreshResult(),
        synchronization: synchronizationForOutcome({ kind: 'cooling_down', operation }),
      }
    })
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
    const instance = await runner.registerInstance({
      id: 'contract-instance', connector, displayName: 'Contract', enabled: true,
    })

    const caught = await captureRefreshError(runner, connector, instance.id)
    expectUnexpectedConnectorExecutionError(caught)
    await expect(repository.listRuns({ connectorInstanceId: instance.id }))
      .resolves.toMatchObject({ items: [], total: 0 })
  })

  it.each([
    ['completed', { kind: 'caught_up' }],
    ['failed', { kind: 'failed', reason: 'fixture_failure' }],
    ['cancelled', { kind: 'cancelled', reason: 'cancelled' }],
    ['skipped', { kind: 'yielded', reason: 'invocation_budget' }],
  ] as const)('persists released %s semantics with explicit synchronization', async (status, outcome) => {
    const { repository } = await createConnectorRepositoryTestContext()
    const connector = adversarialConnector({
      ...validRefreshResult(), status,
      synchronization: synchronizationForOutcome(outcome),
    })
    const runner = createConnectorRunner({ repository, workspaceId: 'workspace-fixture' })
    await runner.registerInstance({
      id: 'contract-instance', connector, displayName: 'Contract', enabled: true,
    })

    await expect(runner.refresh(connector, {
      connectorInstanceId: 'contract-instance', mode: 'manual', coverage,
    })).resolves.toMatchObject({ status })
    const runs = await repository.listRuns({ connectorInstanceId: 'contract-instance' })
    const persistedOutcome = status === 'failed'
      ? { kind: 'failed', reason: 'connector_execution_failed' }
      : outcome
    expect(await repository.getRunSynchronization(runs.items[0]!.id)).toMatchObject({
      outcome: persistedOutcome,
    })
  })
})

function validRefreshResult(): ConnectorRefreshResult {
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

/** Adversarial fixtures deliberately return refresh results the contract forbids. */
function adversarialRefreshConnector(
  refresh: (input: ConnectorRefreshInput) => unknown,
): AppJobConnector {
  return {
    definition: { id: 'fixture.contract', version: '1.0.0' },
    async refresh(input: ConnectorRefreshInput) { return refresh(input) },
  } as unknown as AppJobConnector
}

function adversarialConnector(result: unknown): AppJobConnector {
  return adversarialRefreshConnector(() => result)
}

async function captureRefreshError(
  runner: ReturnType<typeof createConnectorRunner>,
  connector: AppJobConnector,
  connectorInstanceId: string,
): Promise<unknown> {
  try {
    await runner.refresh(connector, { connectorInstanceId, mode: 'manual', coverage })
  } catch (error) {
    return error
  }
  return null
}

function expectUnexpectedConnectorExecutionError(caught: unknown): void {
  expect(caught).toMatchObject({
    name: 'ConnectorExecutionError',
    message: 'Connector execution failed.',
    statusCode: 500,
  })
  expect((caught as Error).cause).toBeUndefined()
  expect(JSON.stringify(caught)).not.toMatch(/invalid|inconsistent connector refresh/i)
}
