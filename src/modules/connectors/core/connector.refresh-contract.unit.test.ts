import { describe, expect, it } from 'vitest'
import { assertConnectorRefreshResult } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/core/connector.refresh-contract'

const executionScopeId = 'scope_contract'
const coverage = {
  start: '2026-07-01T00:00:00.000Z',
  end: '2026-07-12T00:00:00.000Z',
}

describe('connector refresh result validation', () => {
  it.each([
    [{ ...validRefreshResult(), status: ['partial', '_success'].join('') }, /invalid connector refresh status/i],
    [without(validRefreshResult(), 'status'), /invalid connector refresh status/i],
    [{ ...validRefreshResult(), status: 'complete' }, /invalid connector refresh status/i],
    [without(validRefreshResult(), 'synchronization'), /invalid connector refresh synchronization/i],
    [{
      ...validRefreshResult(),
      synchronization: { ...validRefreshResult().synchronization, pendingResolutionCount: -1 },
    }, /invalid connector refresh synchronization/i],
    [{
      ...validRefreshResult(),
      synchronization: {
        ...validRefreshResult().synchronization,
        historicalBackfill: {
          state: 'not_started',
          boundary: { earliestDate: '2026-99-99' },
        },
      },
    }, /invalid connector refresh synchronization/i],
    [{
      ...validRefreshResult(),
      operationOutcome: { kind: 'scope_rate_limited' },
    }, /invalid connector refresh operation outcome/i],
    [{
      ...validRefreshResult(),
      operationOutcome: {
        kind: 'scope_rate_limited',
        executionScopeId,
        retryAt: 'not-a-date',
        serverMinimumDelayMs: 1,
      },
    }, /invalid connector refresh operation outcome/i],
    [{
      ...validRefreshResult(),
      operationOutcome: {
        kind: 'scope_rate_limited',
        executionScopeId,
        retryAt: '2026-07-12T12:00:00.000Z',
        serverMinimumDelayMs: -1,
      },
    }, /invalid connector refresh operation outcome/i],
    [{
      ...validRefreshResult(),
      operationOutcome: {
        kind: 'scope_rate_limited',
        executionScopeId: 'short',
        retryAt: '2026-07-12T12:00:00.000Z',
        serverMinimumDelayMs: 1,
      },
    }, /invalid connector refresh operation outcome/i],
    [{
      ...validRefreshResult(),
      operationOutcome: {
        kind: 'scope_rate_limited',
        executionScopeId: 'scope_unrelated',
        retryAt: '2026-07-12T12:00:00.000Z',
        serverMinimumDelayMs: 1,
      },
    }, /invalid connector refresh operation outcome scope/i],
  ] as const)('rejects invalid envelope or operation case %#', (result, message) => {
    expectRejectedResult(result, message)
  })

  it.each([
    { attempt: 0, lastAttemptAt: '2026-07-12T12:00:00.000Z' },
    { attempt: 1, lastAttemptAt: 'not-an-instant' },
  ])('rejects malformed retry advice %#', ({ attempt, lastAttemptAt }) => {
    expectRejectedResult({
      ...validRefreshResult(),
      retryHints: {
        state: 'scheduled',
        reason: 'server_failure',
        attempt,
        maxAttempts: 3,
        lastAttemptAt,
        computedDelayMs: 1,
        nextAttemptAt: '2026-07-12T12:00:01.000Z',
        horizonAt: '2026-07-12T13:00:00.000Z',
      },
    }, /invalid connector refresh retry advice/i)
  })

  it.each(['', 'x'.repeat(513)])('rejects invalid synchronization reason %#', (reason) => {
    expectRejectedResult({
      ...validRefreshResult(),
      status: 'failed',
      synchronization: synchronizationForOutcome({ kind: 'failed', reason }),
    }, /invalid connector refresh synchronization/i)
  })

  it('rejects contradictory terminal and synchronization outcomes', () => {
    expectRejectedResult({
      ...validRefreshResult(),
      synchronization: synchronizationForOutcome({ kind: 'failed', reason: 'failed' }),
    }, /invalid connector refresh synchronization/i)
  })

  it.each([
    { ...validRefreshResult(), coverage: { start: 'not-an-instant', end: coverage.end } },
    { ...validRefreshResult(), stats: { observations: -1 } },
    { ...validRefreshResult(), nextCheckpoint: { checkpoint: {}, schemaVersion: '' } },
    { ...validRefreshResult(), warnings: [{ code: '', message: 'warning' }] },
  ])('rejects malformed required field case %#', (result) => {
    expectRejectedResult(result, /invalid connector refresh result/i)
  })

  it('rejects mismatched operation and synchronization evidence', () => {
    const operation = {
      kind: 'scope_rate_limited',
      executionScopeId,
      retryAt: '2026-07-12T12:02:00.000Z',
      serverMinimumDelayMs: 120_000,
    }
    expectRejectedResult({
      ...validRefreshResult(),
      operationOutcome: operation,
    }, /inconsistent connector refresh operation outcome/i)
    expectRejectedResult({
      ...validRefreshResult(),
      synchronization: synchronizationForOutcome({ kind: 'cooling_down', operation }),
    }, /inconsistent connector refresh operation outcome/i)
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
      historicalBackfill: {
        state: 'caught_up',
        boundary: { earliestDate: '2026-07-01' },
      },
      pendingResolutionCount: 0,
      outcome: { kind: 'caught_up' },
    },
  }
}

function synchronizationForOutcome(outcome: {
  kind: string
  operation?: unknown
  reason?: string
}) {
  if (outcome.kind === 'caught_up') {
    return validRefreshResult().synchronization
  }
  return {
    newestFrontier: { state: 'advancing' },
    historicalBackfill: {
      state: 'advancing',
      boundary: { earliestDate: '2026-07-01' },
    },
    pendingResolutionCount: 1,
    outcome,
  }
}

function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = value
  return rest
}

function expectRejectedResult(result: unknown, message: RegExp) {
  expect(() => assertConnectorRefreshResult(result, executionScopeId)).toThrow(message)
}
