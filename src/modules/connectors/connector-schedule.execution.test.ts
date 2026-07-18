import { describe, expect, it, vi } from 'vitest'
import type { DispatchConnectorScheduleDueResult } from 'sparxie'
import type { ConnectorRunRecord } from './connector.repository'
import { resolveAdmittedScheduleDispatch } from './connector-schedule.execution'

const NOW = '2026-07-18T11:00:00.000Z'

describe('connector schedule admitted execution reconciliation', () => {
  it('claims and executes a queued admitted run before recording its terminal outcome', async () => {
    const queued = run('queued')
    const completed = run('completed')
    const markOccurrenceOutcome = vi.fn(async ({ outcome }) => ({
      ...admitted.occurrence,
      outcome,
    }))

    const result = await resolveAdmittedScheduleDispatch({
      admitted,
      getRun: async () => queued,
      claimQueuedRunToRunning: async () => ({ claimed: true, run: run('running') }),
      executeClaimedRun: async () => completed,
      markOccurrenceOutcome,
      now: () => new Date(NOW),
    })

    expect(result).toMatchObject({
      status: 'admitted',
      occurrence: { outcome: 'completed' },
      run: { status: 'completed' },
    })
    expect(markOccurrenceOutcome).toHaveBeenCalledWith({
      occurrenceId: admitted.occurrence.id,
      outcome: 'completed',
    })
  })

  it('reuses a running admitted run without executing or rewriting its occurrence', async () => {
    const executeClaimedRun = vi.fn(async () => run('completed'))
    const markOccurrenceOutcome = vi.fn(async () => admitted.occurrence)

    const result = await resolveAdmittedScheduleDispatch({
      admitted,
      getRun: async () => run('running'),
      claimQueuedRunToRunning: async () => ({ claimed: false, run: run('running') }),
      executeClaimedRun,
      markOccurrenceOutcome,
      now: () => new Date(NOW),
    })

    expect(result).toMatchObject({ run: { status: 'running' }, occurrence: { outcome: 'admitted' } })
    expect(executeClaimedRun).not.toHaveBeenCalled()
    expect(markOccurrenceOutcome).not.toHaveBeenCalled()
  })

  it('reconciles an already-terminal admitted run without executing it again', async () => {
    const executeClaimedRun = vi.fn(async () => run('completed'))
    const markOccurrenceOutcome = vi.fn(async ({ outcome }) => ({
      ...admitted.occurrence,
      outcome,
    }))

    const result = await resolveAdmittedScheduleDispatch({
      admitted,
      getRun: async () => run('failed'),
      claimQueuedRunToRunning: async () => ({ claimed: false, run: run('failed') }),
      executeClaimedRun,
      markOccurrenceOutcome,
      now: () => new Date(NOW),
    })

    expect(result).toMatchObject({ run: { status: 'failed' }, occurrence: { outcome: 'failed' } })
    expect(executeClaimedRun).not.toHaveBeenCalled()
    expect(markOccurrenceOutcome).toHaveBeenCalledWith({
      occurrenceId: admitted.occurrence.id,
      outcome: 'failed',
    })
  })
})

const admitted = {
  status: 'admitted' as const,
  occurrence: {
    id: 'occurrence-1',
    scheduleId: 'schedule-1',
    scheduleRevision: 'revision-1',
    nominalAt: NOW,
    idempotencyKey: 'revision-1:2026-07-18T11:00:00.000Z',
    admittedMode: 'scheduled' as const,
    outcome: 'admitted' as const,
    connectorRunId: 'run-1',
    createdAt: NOW,
  },
  run: {
    id: 'run-1',
    status: 'queued' as const,
    mode: 'scheduled' as const,
    startedAt: NOW,
    completedAt: null,
  },
} satisfies Extract<DispatchConnectorScheduleDueResult, { status: 'admitted' }>

function run(status: ConnectorRunRecord['status']): ConnectorRunRecord {
  return {
    id: 'run-1',
    executionScopeId: 'scope-1',
    connectorInstanceId: 'connector-1',
    mode: 'scheduled',
    status,
    startedAt: NOW,
    completedAt: status === 'queued' || status === 'running' ? null : NOW,
    coverageStartedAt: '2026-01-01T00:00:00.000Z',
    coverageEndedAt: NOW,
    config: {},
    filters: {},
    filterSignature: 'filters:{}',
    observationCount: 0,
    warningCount: 0,
    stats: {},
    warnings: [],
    retryHints: null,
  }
}
