import type {
  ConnectorScheduleAdmittedMode,
  ConnectorScheduleLastRunSummary,
  ConnectorScheduleOccurrenceOutcome,
  ConnectorScheduleOccurrenceSummary,
  DispatchConnectorScheduleDueResult,
} from '@sparxie/sdk'
import type { ConnectorRunRecord } from '../ports/connector.repository.port'
import type { ScheduleOccurrenceOutcomeWriter } from '../ports/connector-schedule.repository.port'
import {
  isTerminalConnectorRunStatus,
  occurrenceOutcomeForRunStatus,
} from './connector-schedule.occurrence-outcome'

export async function resolveAdmittedScheduleDispatch({
  admitted,
  claimQueuedRunToRunning,
  executeClaimedRun,
  getRun,
  markOccurrenceOutcome,
  now,
}: {
  admitted: Extract<DispatchConnectorScheduleDueResult, { status: 'admitted' }>
  claimQueuedRunToRunning: (input: {
    connectorRunId: string
    startedAt: string
  }) => Promise<{ claimed: boolean; run: ConnectorRunRecord }>
  executeClaimedRun: (input: {
    connectorRunId: string
    mode: ConnectorScheduleAdmittedMode
    coverageEndedAt: string
    startedAt: string
  }) => Promise<ConnectorRunRecord>
  getRun: (connectorRunId: string) => Promise<ConnectorRunRecord | null>
  markOccurrenceOutcome: (input: {
    occurrenceId: string
    outcome: ConnectorScheduleOccurrenceOutcome
  }) => Promise<ConnectorScheduleOccurrenceSummary>
  now: () => Date
}): Promise<Extract<DispatchConnectorScheduleDueResult, { status: 'admitted' }>> {
  const runId = admitted.occurrence.connectorRunId
  const current = await getRun(runId)
  if (!current) {
    throw new Error(`Admitted connector run not found: ${runId}`)
  }

  if (isTerminalConnectorRunStatus(current.status)) {
    const occurrence = await syncOccurrenceForTerminalRun({
      occurrence: admitted.occurrence,
      run: current,
      markOccurrenceOutcome,
    })
    return {
      status: 'admitted',
      occurrence,
      run: mapScheduleLastRun(current),
    } as Extract<DispatchConnectorScheduleDueResult, { status: 'admitted' }>
  }

  if (current.status === 'running') {
    // Observable/reusable only — never execute an already-running run.
    return {
      status: 'admitted',
      occurrence: admitted.occurrence,
      run: mapScheduleLastRun(current),
    } as Extract<DispatchConnectorScheduleDueResult, { status: 'admitted' }>
  }

  if (current.status !== 'queued') {
    return {
      status: 'admitted',
      occurrence: admitted.occurrence,
      run: mapScheduleLastRun(current),
    } as Extract<DispatchConnectorScheduleDueResult, { status: 'admitted' }>
  }

  const startedAt = now().toISOString()
  const claim = await claimQueuedRunToRunning({
    connectorRunId: runId,
    startedAt,
  })

  if (!claim.claimed) {
    if (isTerminalConnectorRunStatus(claim.run.status)) {
      const occurrence = await syncOccurrenceForTerminalRun({
        occurrence: admitted.occurrence,
        run: claim.run,
        markOccurrenceOutcome,
      })
      return {
        status: 'admitted',
        occurrence,
        run: mapScheduleLastRun(claim.run),
      } as Extract<DispatchConnectorScheduleDueResult, { status: 'admitted' }>
    }

    // Lost CAS (another caller claimed) or unresolved non-queued state: reuse identity, do not execute.
    return {
      status: 'admitted',
      occurrence: admitted.occurrence,
      run: mapScheduleLastRun(claim.run),
    } as Extract<DispatchConnectorScheduleDueResult, { status: 'admitted' }>
  }

  const coverageEndedAt = current.coverageEndedAt ?? startedAt
  try {
    const executed = await executeClaimedRun({
      connectorRunId: claim.run.id,
      mode: admitted.occurrence.admittedMode,
      coverageEndedAt,
      startedAt,
    })
    const occurrence = await syncOccurrenceForTerminalRun({
      occurrence: admitted.occurrence,
      run: executed,
      markOccurrenceOutcome,
    })
    return {
      status: 'admitted',
      occurrence,
      run: mapScheduleLastRun(executed),
    } as Extract<DispatchConnectorScheduleDueResult, { status: 'admitted' }>
  } catch {
    const failed = await getRun(runId)
    if (!failed) {
      throw new Error(`Admitted connector run missing after execution failure: ${runId}`)
    }
    const occurrence = await syncOccurrenceForTerminalRun({
      occurrence: admitted.occurrence,
      run: failed,
      markOccurrenceOutcome,
    })
    return {
      status: 'admitted',
      occurrence,
      run: mapScheduleLastRun(failed),
    } as Extract<DispatchConnectorScheduleDueResult, { status: 'admitted' }>
  }
}

async function syncOccurrenceForTerminalRun({
  occurrence,
  run,
  markOccurrenceOutcome,
}: {
  occurrence: ConnectorScheduleOccurrenceSummary & { connectorRunId: string }
  run: ConnectorRunRecord
  markOccurrenceOutcome: (input: {
    occurrenceId: string
    outcome: ConnectorScheduleOccurrenceOutcome
  }) => Promise<ConnectorScheduleOccurrenceSummary>
}): Promise<ConnectorScheduleOccurrenceSummary & { connectorRunId: string }> {
  const outcome = occurrenceOutcomeForRunStatus(run.status)
  if (occurrence.outcome === outcome) {
    return occurrence
  }
  const updated = await markOccurrenceOutcome({
    occurrenceId: occurrence.id,
    outcome,
  })
  return {
    ...updated,
    connectorRunId: updated.connectorRunId ?? occurrence.connectorRunId,
  }
}

function mapScheduleLastRun(run: ConnectorRunRecord): ConnectorScheduleLastRunSummary {
  return {
    id: run.id,
    status: run.status as ConnectorScheduleLastRunSummary['status'],
    mode: run.mode as ConnectorScheduleLastRunSummary['mode'],
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  }
}

export type { ScheduleOccurrenceOutcomeWriter }
