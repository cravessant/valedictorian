import { describe, expect, it } from 'vitest'
import type { ConnectorRunRecord } from './connector.repository'
import { pendingResolutionCount, publicRunStatus, runFrontiers, runOutcome } from './connector.run-record.projection'

describe('local connector run synchronization persistence boundary', () => {
  it('rejects hostile or malformed snapshots instead of publishing invented progress', () => {
    const run = fixture({ synchronization: {
      newestFrontier: { state: 'caught_up' },
      historicalBackfill: { state: 'caught_up', boundary: { earliestDate: 'not-a-date' } },
      pendingResolutionCount: -1,
      outcome: { kind: 'caught_up' },
      injected: 'ignored only by permissive parsing',
    } })
    expect(() => runFrontiers(run)).toThrow('persisted connector run synchronization')
    expect(() => runOutcome(run)).toThrow('persisted connector run synchronization')
    expect(() => pendingResolutionCount(run)).toThrow('persisted connector run synchronization')
    expect(() => publicRunStatus(['partial', '_success'].join(''))).toThrow('Invalid persisted connector run status')
  })
})

function fixture(overrides: Partial<ConnectorRunRecord>): ConnectorRunRecord {
  return {
    id: 'run-sync', executionScopeId: 'scope_fixture', connectorInstanceId: 'instance',
    mode: 'manual', status: 'completed', startedAt: '2026-07-12T12:00:00.000Z',
    completedAt: '2026-07-12T12:00:01.000Z', coverageStartedAt: null,
    coverageEndedAt: '2026-07-12T12:00:00.000Z', config: {}, filters: {},
    filterSignature: 'filters:{}', observationCount: 0, warningCount: 0,
    stats: {}, warnings: [], retryHints: null, ...overrides,
  }
}
