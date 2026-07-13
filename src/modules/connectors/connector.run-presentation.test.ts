import { describe, expect, it } from 'vitest'
import { connectorRunTerminalCopy } from './connector.run-presentation'

describe('connector run terminal copy', () => {
  it.each([
    ['target_met', 'Target reached'],
    ['source_exhausted', 'Provider exhausted'],
    ['backfill_horizon', 'Backfill horizon reached'],
    ['coverage_start_reached', 'Reached the selected earliest backfill date'],
    ['cycle_attempt_limit', 'Cycle attempt limit reached'],
    ['discovery_page_limit', 'Finite discovery page limit reached'],
    ['discovery_record_limit', 'Finite discovery record limit reached'],
    ['soft_batch_boundary', 'Paused at a finite batch boundary'],
    ['runtime_limit', 'Paused at the run time limit'],
    ['rate_limited', 'Paused until retry'],
    ['retryable_failure', 'Paused until retry'],
    ['auth_required', 'Needs action'],
    ['challenge', 'Needs action'],
    ['failed', 'Needs action'],
    ['invalid_discovery_position', 'Needs action'],
    ['cancelled', 'Cancelled'],
  ])('maps persisted stop reason %s to human terminal copy', (stopReason, summary) => {
    expect(connectorRunTerminalCopy(runFixture({ stopReason })).summary).toBe(summary)
  })

  it('uses persisted sourcing outcomes when no connector stop reason explains completion', () => {
    expect(connectorRunTerminalCopy(runFixture({
      stopReason: null,
      sourcing: { added: 0, queueDuplicate: 2, notFit: 0, rejected: 0 },
    })).summary).toBe('Completed with queue duplicates')
    expect(connectorRunTerminalCopy(runFixture({
      stopReason: null,
      sourcing: { added: 0, queueDuplicate: 0, notFit: 1, rejected: 1 },
    })).summary).toBe('Completed with sourcing rejections')
  })

  it('uses the persisted stop reason without a legacy technical status', () => {
    expect(connectorRunTerminalCopy(runFixture({
      status: 'completed',
      stopReason: 'soft_batch_boundary',
    }))).toEqual({
      summary: 'Paused at a finite batch boundary',
      detail: '18 unique jobs remain pending. The next run resumes from the persisted checkpoint.',
      technical: null,
    })
  })

  it('falls back to persisted warning codes when an older run has no stop reason', () => {
    expect(connectorRunTerminalCopy({
      ...runFixture({ stopReason: null }),
      warnings: [{ code: 'jobright_raw_intake_unavailable' }],
    }).summary).toBe('Needs action')
    expect(connectorRunTerminalCopy({
      ...runFixture({ stopReason: null }),
      warnings: [{ code: 'jobright_retryable_failure' }],
    }).summary).toBe('Paused until retry')
  })

  it('derives retry terminal copy from typed retry advice', () => {
    expect(connectorRunTerminalCopy({
      ...runFixture({ stopReason: null }),
      retryHints: {
        state: 'scheduled', reason: 'server_failure', attempt: 2, maxAttempts: 4,
        lastAttemptAt: '2026-07-11T12:00:00.000Z', computedDelayMs: 60_000,
        nextAttemptAt: '2026-07-11T12:01:00.000Z', horizonAt: '2026-07-11T13:00:00.000Z',
      },
    }).summary).toBe('Paused until retry')
  })
})

function runFixture({
  status = 'completed',
  stopReason,
  sourcing = { added: 1, queueDuplicate: 0, notFit: 0, rejected: 0 },
}: {
  status?: string
  stopReason: string | null
  sourcing?: { added: number; queueDuplicate: number; notFit: number; rejected: number }
}) {
  return {
    status,
    stats: {
      ...(stopReason ? { stopReason } : {}),
      lifecycleCounts: {
        destination: { pending: 18 },
        sourcing: { ...sourcing, actionableReview: 0, unclassified: 0 },
      },
    },
    retryHints: null,
  }
}
