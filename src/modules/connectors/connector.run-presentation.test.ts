import { describe, expect, it } from 'vitest'
import { connectorRunTerminalCopy } from './connector.run-presentation'

describe('connector run terminal copy', () => {
  it.each([
    ['target_met', 'Target reached'],
    ['source_exhausted', 'Provider exhausted'],
    ['backfill_horizon', 'Backfill horizon reached'],
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

  it('keeps partial success as technical secondary text', () => {
    expect(connectorRunTerminalCopy(runFixture({
      status: 'partial_success',
      stopReason: 'soft_batch_boundary',
    }))).toEqual({
      summary: 'Paused at a finite batch boundary',
      detail: '18 unique jobs remain pending. The next run resumes from the persisted checkpoint.',
      technical: 'Technical status: partial success.',
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
    retryHints: stopReason ? { stopReason } : null,
  }
}
