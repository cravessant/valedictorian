import { describe, expect, it, vi } from 'vitest'
import type { ConnectorScheduleSummary } from '@sparxie/sdk'
import { createConnectorScheduleWorkSource } from '../modules/connectors/connector-schedule.source'

describe('local connector schedule source recovery', () => {
  it('immediately resumes an admitted queued run after the schedule cadence advanced', async () => {
    const dispatchDue = vi.fn(async () => ({
      status: 'admitted' as const,
      occurrence: queuedSchedule.lastOccurrence!,
      run: queuedSchedule.lastRun!,
    }))
    const source = createConnectorScheduleWorkSource({
      dispatchDue,
      listSchedules: () => [queuedSchedule],
      now: () => new Date('2026-07-15T12:05:00.000Z'),
    })

    await expect(source.nextDueAt()).resolves.toBe('2026-07-15T12:00:00.000Z')
    await source.runDue()

    expect(dispatchDue).toHaveBeenCalledOnce()
    expect(dispatchDue).toHaveBeenCalledWith({
      connectorInstanceId: 'queued-connector',
      expectedRevision: 'queued-revision',
    }, undefined)
  })
})

const queuedSchedule: ConnectorScheduleSummary = {
  id: 'queued-schedule',
  connectorInstanceId: 'queued-connector',
  revision: 'queued-revision',
  state: 'enabled',
  cadence: { kind: 'interval', everyMinutes: 60 },
  timezone: 'UTC',
  nextEligibleAt: '2026-07-15T13:00:00.000Z',
  createdAt: '2026-07-15T11:00:00.000Z',
  updatedAt: '2026-07-15T12:00:00.000Z',
  lastOccurrence: {
    id: 'queued-occurrence',
    scheduleId: 'queued-schedule',
    scheduleRevision: 'queued-revision',
    nominalAt: '2026-07-15T12:00:00.000Z',
    idempotencyKey: 'queued-revision:2026-07-15T12:00:00.000Z',
    admittedMode: 'scheduled',
    outcome: 'admitted',
    connectorRunId: 'queued-run',
    createdAt: '2026-07-15T12:00:00.000Z',
  },
  lastRun: {
    id: 'queued-run',
    status: 'queued',
    mode: 'scheduled',
    startedAt: '2026-07-15T12:00:00.000Z',
    completedAt: null,
  },
}
