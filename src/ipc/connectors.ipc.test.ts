import { describe, expect, it, vi } from 'vitest'
import type { LocalValedictorianClient } from '../runtime/local-valedictorian-client'
import { registerConnectorsIpc } from './connectors.ipc'

describe('connectors IPC registration', () => {
  it('registers a connector status handler against the local client', async () => {
    const reconnect = vi.fn(async () => ({
      action: 'reconnect',
      connectorInstanceId: 'connector-instance-fixture',
      grants: [{ id: 'fixture-session', mode: 'api_key', status: 'ready' }],
      message: 'Connector auth is ready.',
      status: 'ready',
    }))
    const skip = vi.fn(async () => ({
      action: 'skip',
      connectorInstanceId: 'connector-instance-fixture',
      message: 'Connector run skipped.',
      run: {
        ...connectorRunWithLocalFields(),
        connectorInstanceId: 'connector-instance-fixture',
        status: 'cancelled',
        outcome: { kind: 'cancelled', reason: 'user_skipped_auth_required_run' },
      },
      status: 'skipped',
    }))
    const connectors = {
      status: {
        reconnect,
        skip,
      },
    } as unknown as LocalValedictorianClient['connectors']
    const handlers = new Map<string, (_event: unknown) => Promise<unknown>>()

    registerConnectorsIpc(connectors, {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    })

    await expect(
      handlers.get('connectors:status:reconnect')?.(
        {},
        { connectorInstanceId: 'connector-instance-fixture' },
      ),
    ).resolves.toMatchObject({ action: 'reconnect', status: 'ready' })
    await expect(
      handlers.get('connectors:status:skip')?.(
        {},
        {
          connectorInstanceId: 'connector-instance-fixture',
          reason: 'user_skipped_auth_required_run',
        },
      ),
    ).resolves.toMatchObject({ action: 'skip', status: 'skipped' })
    expect(reconnect).toHaveBeenCalledWith({ connectorInstanceId: 'connector-instance-fixture' })
    expect(skip).toHaveBeenCalledWith({
      connectorInstanceId: 'connector-instance-fixture',
      reason: 'user_skipped_auth_required_run',
    })
  })

  it('registers connector lifecycle and run handlers against the local client', async () => {
    const list = vi.fn(async () => ({ items: [] }))
    const create = vi.fn(async (input: unknown) => ({ id: 'connector-instance', input }))
    const update = vi.fn(async (input: unknown) => ({ id: 'connector-instance', input }))
    const remove = vi.fn(async () => ({
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
    }))
    const inspect = vi.fn(async (connectorInstanceId: string) => ({
      id: connectorInstanceId,
      connectorId: 'fixture.jobs',
      connectorVersion: '1.0.0',
      displayName: 'Fixture jobs',
      enabled: true,
      auth: [],
      actionRequired: [],
      actions: [],
      lastRunAt: '2026-07-12T12:00:00.000Z',
      latestRunId: 'connector-run-fixture',
      observationCount: 1,
      severity: 'healthy',
      status: 'caught_up',
      statusLabel: 'Caught up',
      summary: 'Connector synchronization is caught up.',
      warningCount: 0,
      warnings: [],
      secretSession: 'must-not-cross-ipc',
    }))
    const listRuns = vi.fn(async () => ({
      items: [], total: 0, limit: 20, offset: 0, hasMore: false,
    }))
    const trigger = vi.fn(async () => connectorRunWithLocalFields())
    const connectors = {
      list,
      create,
      update,
      remove,
      inspect,
      runs: {
        list: listRuns,
        trigger,
      },
      status: {
        list: vi.fn(),
        reconnect: vi.fn(),
        skip: vi.fn(),
      },
    } as unknown as LocalValedictorianClient['connectors']
    const handlers = new Map<string, (_event: unknown, input?: unknown) => Promise<unknown>>()

    registerConnectorsIpc(connectors, {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    })

    await expect(handlers.get('connectors:list')?.({})).resolves.toEqual({ items: [] })
    await expect(handlers.get('connectors:create')?.({}, { id: 'connector-instance' }))
      .resolves.toMatchObject({ id: 'connector-instance' })
    await expect(
      handlers.get('connectors:update')?.(
        {},
        { connectorInstanceId: 'connector-instance', enabled: false },
      ),
    ).resolves.toMatchObject({ id: 'connector-instance' })
    await expect(handlers.get('connectors:remove')?.(
      {},
      { connectorInstanceId: 'connector-instance' },
    )).resolves.toMatchObject({ kind: 'success', result: { lifecycle: 'retired' } })
    await expect(handlers.get('connectors:inspect')?.({}, 'connector-instance'))
      .resolves.toEqual({
        id: 'connector-instance',
        connectorId: 'fixture.jobs',
        connectorVersion: '1.0.0',
        displayName: 'Fixture jobs',
        enabled: true,
        auth: [],
        actionRequired: [],
        actions: [],
        lastRunAt: '2026-07-12T12:00:00.000Z',
        latestRunId: 'connector-run-fixture',
        observationCount: 1,
        severity: 'healthy',
        status: 'caught_up',
        statusLabel: 'Caught up',
        summary: 'Connector synchronization is caught up.',
        warningCount: 0,
        warnings: [],
      })
    await expect(
      handlers.get('connectors:runs:list')?.({}, { connectorInstanceId: 'connector-instance' }),
    ).resolves.toMatchObject({ items: [] })
    await expect(
      handlers.get('connectors:runs:trigger')?.(
        {},
        { connectorInstanceId: 'connector-instance', mode: 'manual' },
      ),
    ).resolves.toMatchObject({ id: 'run-1' })

    expect(list).toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith({ id: 'connector-instance' })
    expect(update).toHaveBeenCalledWith({ connectorInstanceId: 'connector-instance', enabled: false })
    expect(remove).toHaveBeenCalledWith({ connectorInstanceId: 'connector-instance' })
    expect(inspect).toHaveBeenCalledWith('connector-instance')
    expect(listRuns).toHaveBeenCalledWith({ connectorInstanceId: 'connector-instance' })
    expect(trigger).toHaveBeenCalledWith({ connectorInstanceId: 'connector-instance', mode: 'manual' })
  })

  it('publishes the same sanitized connector run shape as HTTP', async () => {
    const run = connectorRunWithLocalFields()
    const connectors = {
      runs: {
        list: vi.fn(async () => ({
          items: [run], total: 1, limit: 20, offset: 0, hasMore: false,
        })),
        trigger: vi.fn(async () => run),
      },
    } as unknown as LocalValedictorianClient['connectors']
    const handlers = new Map<
      string,
      (_event: unknown, input?: unknown) => Promise<unknown>
    >()
    registerConnectorsIpc(connectors, {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    })

    const expected = publicRunFixture(run)
    await expect(handlers.get('connectors:runs:list')?.(
      {},
      { connectorInstanceId: 'connector-1' },
    )).resolves.toEqual({
      items: [expected], total: 1, limit: 20, offset: 0, hasMore: false,
    })
    await expect(handlers.get('connectors:runs:trigger')?.(
      {},
      { connectorInstanceId: 'connector-1' },
    )).resolves.toEqual(expected)
  })

  it('publishes a strict skip result without local run fields or the caller reason', async () => {
    const run = {
      ...connectorRunWithLocalFields(),
      status: 'cancelled',
      outcome: { kind: 'cancelled', reason: 'user_skipped_private_caller_reason' },
    }
    const connectors = {
      status: {
        skip: vi.fn(async () => ({
          action: 'skip', connectorInstanceId: 'connector-1', message: 'Connector run skipped.',
          run, status: 'skipped', internalStatusReason: 'must-not-cross-ipc',
        })),
      },
    } as unknown as LocalValedictorianClient['connectors']
    const handlers = new Map<string, (_event: unknown, input?: unknown) => Promise<unknown>>()
    registerConnectorsIpc(connectors, {
      handle(channel, handler) { handlers.set(channel, handler) },
    })

    const result = await handlers.get('connectors:status:skip')?.(
      {}, { connectorInstanceId: 'connector-1', reason: 'user_skipped_private_caller_reason' },
    )

    expect(result).toEqual({
      action: 'skip', connectorInstanceId: 'connector-1', message: 'Connector run skipped.',
      run: {
        ...publicRunFixture(run),
        outcome: { kind: 'cancelled', reason: 'user_skipped' },
      },
      status: 'skipped',
    })
    expect(JSON.stringify(result)).not.toMatch(
      /coverage|retryHints|stats|secretSession|private_caller_reason|internalStatusReason/,
    )
  })

  it('does not register an IPC-only connector status list', async () => {
    const handlers = new Map<string, (_event: unknown) => Promise<unknown>>()

    registerConnectorsIpc(null, {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    })

    expect(handlers.has('connectors:status:list')).toBe(false)
  })
})

function connectorRunWithLocalFields() {
  return {
    id: 'run-1', connectorInstanceId: 'connector-1',
    executionScopeId: 'scope_connector_1', mode: 'manual', scheduleOccurrence: null,
    status: 'completed', filterSignature: 'all', observationCount: 1,
    warningCount: 0, warnings: [], newestFrontier: { state: 'advancing' },
    historicalBackfill: {
      state: 'advancing', boundary: { earliestDate: '2026-07-01' },
    },
    pendingResolutionCount: 0,
    lifecycleCounts: {
      version: 'connector-run-lifecycle-counts/v1', source: 'frozen_terminal',
      scope: {
        kind: 'connector_run', connectorRunId: 'run-1',
        executionScopeId: 'scope_connector_1',
      },
      provider: {
        returnedRows: 1, validRecords: 1, invalidRecords: 0, sourceDuplicates: 0,
        capturedRecords: 1, occurrenceCount: 1, captureShortfall: 0,
        unclassifiedRows: 0, invariant: 'reconciled', gaps: [],
      },
      destination: {
        normalized: 1, resolvedEmployerOrAts: 1, resolvedThirdParty: 0,
        unresolved: 0, pending: 0, gateRejected: 0, unclassified: 0,
        invariant: 'reconciled',
      },
      sourcing: {
        findingsAdded: 1, canonicalDuplicates: 0, notFit: 0, rejected: 0,
        actionableReview: 0, unclassified: 0, invariant: 'reconciled',
      },
    },
    outcome: { kind: 'yielded', reason: 'invocation_budget' },
    startedAt: '2026-07-13T04:00:00.000Z',
    completedAt: '2026-07-13T04:00:01.000Z',
    coverage: { start: null, end: null },
    retryHints: { token: 'must-not-cross-ipc' },
    stats: { session: 'must-not-cross-ipc' },
    secretSession: 'must-not-cross-ipc',
  }
}

function publicRunFixture(run: ReturnType<typeof connectorRunWithLocalFields>) {
  const {
    coverage: _coverage,
    retryHints: _retryHints,
    stats: _stats,
    secretSession: _secretSession,
    ...publicRun
  } = run
  return publicRun
}
