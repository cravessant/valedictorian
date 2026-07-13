import { ConnectorRetirementConflictError } from 'sparxie'
import { describe, expect, it, vi } from 'vitest'
import type { LocalValedictorianClient } from '../runtime/local-valedictorian-client'
import { registerConnectorsIpc } from './connectors.ipc'
import { createConnectorsPreloadApi } from './connectors.preload'

describe('connectors preload API', () => {
  it('reconstructs a typed retirement conflict across the registered IPC boundary', async () => {
    const remove = vi.fn(async () => {
      throw Object.assign(new Error('Cancel active work first.'), {
        code: 'connector_retirement_active_work_conflict',
        connectorInstanceId: 'connector-with-active-work',
        cancellationRequired: true,
        activeRuns: [{ connectorRunId: 'queued-run', status: 'queued' }],
        privateDiagnostic: 'must-not-cross-ipc',
      })
    })
    const handlers = new Map<
      string,
      (_event: unknown, input?: unknown) => Promise<unknown>
    >()
    registerConnectorsIpc({ remove } as unknown as LocalValedictorianClient['connectors'], {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    })
    const api = createConnectorsPreloadApi({
      invoke(channel, input) {
        return handlers.get(channel)!({}, input)
      },
    })

    const removal = api.remove({ connectorInstanceId: 'connector-with-active-work' })

    await expect(removal).rejects.toBeInstanceOf(ConnectorRetirementConflictError)
    await expect(removal).rejects.toMatchObject({
      conflict: {
        code: 'connector_retirement_active_work_conflict',
        connectorInstanceId: 'connector-with-active-work',
        cancellationRequired: true,
        activeRuns: [{ connectorRunId: 'queued-run', status: 'queued' }],
      },
    })
    await expect(removal).rejects.not.toHaveProperty('privateDiagnostic')
  })

  it('rejects malformed retry advice returned by connector run IPC', async () => {
    const api = createConnectorsPreloadApi({
      invoke() {
        return Promise.resolve({
          id: 'malformed-run', connectorInstanceId: 'instance', mode: 'manual', status: 'skipped',
          coverage: { start: null, end: null }, filterSignature: 'filters:{}',
          observationCount: 0, warningCount: 0, stats: {}, warnings: [],
          scheduleOccurrence: null,
          retryHints: { reason: 'legacy_unknown_reason' },
          startedAt: '2026-07-11T12:00:00.000Z', completedAt: '2026-07-11T12:00:00.000Z',
        })
      },
    })

    await expect(api.runs.trigger({ connectorInstanceId: 'instance', mode: 'manual' }))
      .rejects.toThrow()
  })

  it('invokes connector lifecycle and run IPC channels', async () => {
    const invocations: unknown[][] = []
    const api = createConnectorsPreloadApi({
      invoke(...args) {
        invocations.push(args)

        if (args[0] === 'connectors:create' || args[0] === 'connectors:update') {
          return Promise.resolve({ id: 'connector-instance' })
        }

        if (args[0] === 'connectors:remove') {
          return Promise.resolve({ kind: 'success', result: retirementResult() })
        }

        if (args[0] === 'connectors:inspect') {
          return Promise.resolve({ id: 'connector-instance', status: 'healthy' })
        }

        if (args[0] === 'connectors:runs:trigger') {
          return Promise.resolve({
            id: 'connector-run', connectorInstanceId: 'connector-instance', mode: 'manual', status: 'completed',
            executionScopeId: 'scope_connector_instance',
            filterSignature: 'filters:{}',
            observationCount: 0, warningCount: 0, warnings: [],
            scheduleOccurrence: null,
            newestFrontier: { state: 'not_started' },
            historicalBackfill: { state: 'not_started', boundary: { earliestDate: '2026-07-01' } },
            pendingResolutionCount: 0,
            outcome: { kind: 'yielded', reason: 'invocation_budget' },
            startedAt: '2026-07-11T12:00:00.000Z', completedAt: '2026-07-11T12:00:00.000Z',
          })
        }

        if (args[0] === 'connectors:runs:list') {
          return Promise.resolve({ items: [], total: 0, limit: 5, offset: 0, hasMore: false })
        }

        return Promise.resolve({ items: [] })
      },
    })
    const createInput = {
      id: 'connector-instance',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.3.0',
      displayName: 'Jobright public jobs',
      enabled: true,
      auth: [{ id: 'jobright', label: 'Jobright API key', mode: 'api_key' }],
      config: { publicFeedUrl: 'https://jobright.ai/jobs/recommend' },
      filters: {},
    } as const
    const updateInput = {
      connectorInstanceId: 'connector-instance',
      enabled: false,
    } as const
    const runsListInput = { connectorInstanceId: 'connector-instance', limit: 5 } as const
    const runTriggerInput = { connectorInstanceId: 'connector-instance', mode: 'manual' } as const

    await expect(api.list()).resolves.toEqual({ items: [] })
    await expect(api.create(createInput)).resolves.toEqual({ id: 'connector-instance' })
    await expect(api.update(updateInput)).resolves.toEqual({ id: 'connector-instance' })
    await expect(api.remove({ connectorInstanceId: 'connector-instance' }))
      .resolves.toEqual(retirementResult())
    await expect(api.inspect('connector-instance')).resolves.toEqual({
      id: 'connector-instance',
      status: 'healthy',
    })
    await expect(api.runs.list(runsListInput)).resolves.toEqual({ items: [], total: 0, limit: 5, offset: 0, hasMore: false })
    const triggered = await api.runs.trigger(runTriggerInput)
    expect(triggered).toMatchObject({ id: 'connector-run' })
    expect(triggered).not.toHaveProperty('coverage')
    expect(triggered).not.toHaveProperty('retryHints')
    expect(triggered).not.toHaveProperty('stats')
    expect(invocations).toEqual([
      ['connectors:list'],
      ['connectors:create', createInput],
      ['connectors:update', updateInput],
      ['connectors:remove', { connectorInstanceId: 'connector-instance' }],
      ['connectors:inspect', 'connector-instance'],
      ['connectors:runs:list', runsListInput],
      ['connectors:runs:trigger', runTriggerInput],
    ])
  })

  it('invokes the connector status IPC channel', async () => {
    const invocations: unknown[][] = []
    const api = createConnectorsPreloadApi({
      invoke(...args) {
        invocations.push(args)
        if (args[0] === 'connectors:status:reconnect') {
          return Promise.resolve({ action: 'reconnect', status: 'ready' })
        }

        if (args[0] === 'connectors:status:skip') {
          return Promise.resolve(publicSkippedActionFixture())
        }

        return Promise.resolve({ items: [] })
      },
    })

    await expect(
      api.status.reconnect({ connectorInstanceId: 'connector-instance-fixture' }),
    ).resolves.toEqual({ action: 'reconnect', status: 'ready' })
    await expect(
      api.status.skip({
        connectorInstanceId: 'connector-instance-fixture',
        reason: 'user_skipped_auth_required_run',
      }),
    ).resolves.toEqual(publicSkippedActionFixture())
    expect(invocations).toEqual([
      ['connectors:status:reconnect', { connectorInstanceId: 'connector-instance-fixture' }],
      [
        'connectors:status:skip',
        {
          connectorInstanceId: 'connector-instance-fixture',
          reason: 'user_skipped_auth_required_run',
        },
      ],
    ])
  })
})

function retirementResult() {
  return {
    connectorInstanceId: 'connector-instance',
    lifecycle: 'retired' as const,
    retiredAt: '2026-07-13T16:00:00.000Z',
    requirements: {
      connectorImplementation: 'not_required' as const,
      authenticationValidation: 'not_required' as const,
    },
    disposition: {
      configuration: 'removed' as const,
      schedule: 'removed' as const,
      checkpoints: 'preserved' as const,
      executionScopes: 'preserved' as const,
      futureExecution: 'blocked' as const,
      authReferences: 'removed' as const,
      secretValues: 'preserved_for_workspace_secret_administration' as const,
    },
    preservedLineage: {
      connectorRuns: true as const,
      rawSourceRecords: true as const,
      normalizationAttempts: true as const,
      canonicalCandidates: true as const,
      sourcingFindings: true as const,
    },
  }
}

function publicSkippedActionFixture() {
  return {
    action: 'skip' as const,
    connectorInstanceId: 'connector-instance-fixture',
    message: 'Connector run skipped.',
    run: {
      id: 'connector-run-skipped', connectorInstanceId: 'connector-instance-fixture',
      executionScopeId: 'scope_connector_instance', mode: 'manual' as const,
      scheduleOccurrence: null, status: 'cancelled' as const, filterSignature: 'filters:{}',
      observationCount: 0, warningCount: 0, warnings: [],
      newestFrontier: { state: 'not_started' as const },
      historicalBackfill: {
        state: 'not_started' as const, boundary: { earliestDate: '2026-07-01' as const },
      },
      pendingResolutionCount: 0,
      outcome: { kind: 'cancelled' as const, reason: 'user_skipped' },
      startedAt: '2026-07-11T12:00:00.000Z', completedAt: '2026-07-11T12:00:00.000Z',
    },
    status: 'skipped' as const,
  }
}
