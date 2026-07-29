import type {
  ConnectorScheduleSummary,
  DispatchConnectorScheduleDueInput,
  DispatchConnectorScheduleDueResult,
} from '@sparxie/sdk'
import type { LocalScheduledWorkSource } from '../scheduling/public'

export interface ConnectorScheduleWorkSourceOptions {
  dispatchDue: (
    input: DispatchConnectorScheduleDueInput,
    signal?: AbortSignal,
  ) => Promise<DispatchConnectorScheduleDueResult>
  listSchedules: () => Promise<ConnectorScheduleSummary[]> | ConnectorScheduleSummary[]
  now: () => Date
}

/** Adapts persisted connector schedules to the app-wide local scheduler. */
export function createConnectorScheduleWorkSource({
  dispatchDue,
  listSchedules,
  now,
}: ConnectorScheduleWorkSourceOptions): LocalScheduledWorkSource {
  const blocked = new Set<string>()
  let signalGeneration = 0

  return {
    id: 'connector-schedules',
    onSignal() {
      signalGeneration += 1
      blocked.clear()
    },
    async nextDueAt() {
      const schedules = await listSchedules()
      return earliestEligibleAt(schedules, blocked)
    },
    async runDue(signal) {
      const currentMs = now().getTime()
      const schedules = await listSchedules()
      const dueSchedules = []
      for (const schedule of schedules) {
        if (
          schedule.state !== 'enabled'
          || blocked.has(schedule.connectorInstanceId)
          || Date.parse(scheduleWorkDueAt(schedule)) > currentMs
        ) {
          continue
        }
        dueSchedules.push(schedule)
      }
      dueSchedules.sort((left, right) => (
          left.nextEligibleAt.localeCompare(right.nextEligibleAt)
          || left.connectorInstanceId.localeCompare(right.connectorInstanceId)
      ))

      for (const schedule of dueSchedules) {
        if (signal?.aborted) return
        const dispatchGeneration = signalGeneration
        const result = await dispatchDue({
          connectorInstanceId: schedule.connectorInstanceId,
          expectedRevision: schedule.revision,
        }, signal)
        if (
          dispatchGeneration === signalGeneration
          && (result.status === 'deferred_active' || result.status === 'connector_disabled')
        ) {
          blocked.add(schedule.connectorInstanceId)
        }
      }
    },
  }
}

function earliestEligibleAt(
  schedules: ConnectorScheduleSummary[],
  blocked: Set<string>,
): string | null {
  return schedules
    .filter((schedule) => schedule.state === 'enabled' && !blocked.has(schedule.connectorInstanceId))
    .map(scheduleWorkDueAt)
    .sort((left, right) => left.localeCompare(right))[0] ?? null
}

function scheduleWorkDueAt(schedule: ConnectorScheduleSummary): string {
  if (
    schedule.lastOccurrence?.outcome === 'admitted'
    && schedule.lastRun?.status === 'queued'
    && schedule.lastOccurrence.connectorRunId === schedule.lastRun.id
  ) {
    return schedule.lastOccurrence.nominalAt
  }
  return schedule.nextEligibleAt
}
