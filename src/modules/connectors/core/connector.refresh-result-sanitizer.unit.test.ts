import { describe, expect, it } from 'vitest'
import { sanitizeConnectorRefreshResult } from './connector.refresh-result-sanitizer'

describe('connector refresh result sanitizer', () => {
  it('projects a negative pending resolution count to zero', () => {
    const result = sanitizeConnectorRefreshResult({
      ...validRefreshResult(),
      synchronization: {
        ...validRefreshResult().synchronization,
        pendingResolutionCount: -1,
      },
    })

    expect(result.synchronization).toMatchObject({ pendingResolutionCount: 0 })
  })

  it('projects a non-Gregorian historical boundary to the safe epoch boundary', () => {
    const result = sanitizeConnectorRefreshResult({
      ...validRefreshResult(),
      synchronization: {
        ...validRefreshResult().synchronization,
        historicalBackfill: {
          state: 'not_started',
          boundary: { earliestDate: '2026-99-99' },
        },
      },
    })

    expect(result.synchronization).toMatchObject({
      historicalBackfill: { boundary: { earliestDate: '1970-01-01' } },
    })
  })

  it.each(['', 'x'.repeat(513)])(
    'projects an invalid failure reason to the public fallback',
    (reason) => {
      const result = sanitizeConnectorRefreshResult({
        ...validRefreshResult(),
        status: 'failed',
        synchronization: {
          ...validRefreshResult().synchronization,
          outcome: { kind: 'failed', reason },
        },
      })

      expect(result.synchronization).toMatchObject({
        outcome: { kind: 'failed', reason: 'connector_execution_failed' },
      })
    },
  )
})

function validRefreshResult() {
  return {
    observations: [],
    nextCheckpoint: { checkpoint: { cursor: 'advanced' }, schemaVersion: 'fixture@1' },
    coverage: {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-07-12T00:00:00.000Z',
    },
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
