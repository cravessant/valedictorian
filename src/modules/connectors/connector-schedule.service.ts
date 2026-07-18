import type {
  ConnectorScheduleAuditListResult,
  ConnectorScheduleHistoryListInput,
  ConnectorScheduleOccurrenceListResult,
  ConnectorScheduleSummary,
  ConnectorSchedulingCapability,
  DeleteConnectorScheduleInput,
  DispatchConnectorScheduleDueInput,
  DispatchConnectorScheduleDueResult,
  PauseConnectorScheduleInput,
  ResumeConnectorScheduleInput,
  UpsertConnectorScheduleInput,
  ValedictorianWorkspaceClient,
} from 'sparxie'
import type { PgliteDatabase } from '../../db/pglite'
import { requireAvailableConnectorScheduling } from './connector-schedule.capability'
import { admitConnectorScheduleDue } from './connector-schedule.dispatch'
import { resolveAdmittedScheduleDispatch } from './connector-schedule.execution'
import { createConnectorScheduleError } from './connector-schedule.errors'
import type { createConnectorScheduleRepository } from './connector-schedule.repository'
import type { ConnectorRunRecord } from './connector.repository'

export type ConnectorScheduleClient = ValedictorianWorkspaceClient['connectors']['schedules']
export type ConnectorScheduleService = ConnectorScheduleClient & {
  dispatchDueWithSignal(
    input: DispatchConnectorScheduleDueInput,
    signal?: AbortSignal,
  ): Promise<DispatchConnectorScheduleDueResult>
}

export function createConnectorScheduleService({
  claimQueuedRunToRunning,
  connectorScheduling,
  database,
  executeClaimedRun,
  getRun,
  now,
  onScheduleChanged,
  repository,
}: {
  claimQueuedRunToRunning: (input: {
    connectorRunId: string
    startedAt: string
  }) => Promise<{ claimed: boolean; run: ConnectorRunRecord }>
  connectorScheduling: ConnectorSchedulingCapability
  database: PgliteDatabase
  executeClaimedRun: (input: {
    connectorRunId: string
    mode: 'scheduled' | 'catch_up'
    coverageEndedAt: string
    signal?: AbortSignal
    startedAt: string
  }) => Promise<ConnectorRunRecord>
  getRun: (connectorRunId: string) => Promise<ConnectorRunRecord | null>
  now: () => Date
  onScheduleChanged?: () => void
  repository: ReturnType<typeof createConnectorScheduleRepository>
}): ConnectorScheduleService {
  const requireAvailable = () => requireAvailableConnectorScheduling(connectorScheduling)
  const dispatchDue = async (
    input: DispatchConnectorScheduleDueInput,
    signal?: AbortSignal,
  ): Promise<DispatchConnectorScheduleDueResult> => {
    const capability = requireAvailable()
    const admitted = await admitConnectorScheduleDue({
      database,
      now,
      maximumCatchUpAgeMinutes: capability.maximumCatchUpAgeMinutes,
      input,
    })

    if (admitted.status !== 'admitted') {
      return admitted
    }

    return resolveAdmittedScheduleDispatch({
      admitted,
      claimQueuedRunToRunning,
      executeClaimedRun: (input) => executeClaimedRun({
        ...input,
        ...(signal ? { signal } : {}),
      }),
      getRun,
      markOccurrenceOutcome: (input) => repository.markOccurrenceOutcome(input),
      now,
    })
  }

  return {
    async get(connectorInstanceId) {
      if (!connectorScheduling.available) {
        return null
      }

      const schedule = await repository.getByConnectorInstanceId(connectorInstanceId)
      return schedule
    },
    async upsert(input: UpsertConnectorScheduleInput): Promise<ConnectorScheduleSummary> {
      const capability = requireAvailable()

      if (!capability.supportedCadences.includes(input.cadence.kind)) {
        throw createConnectorScheduleError(
          'invalid_cadence',
          `Unsupported cadence kind: ${input.cadence.kind}`,
        )
      }

      if (
        input.cadence.kind === 'interval'
        && input.cadence.everyMinutes < capability.minimumIntervalMinutes
      ) {
        throw createConnectorScheduleError(
          'schedule_too_frequent',
          `Interval must be at least ${capability.minimumIntervalMinutes} minutes`,
        )
      }

      if (input.expectedRevision === null) {
        const created = await repository.create({
          connectorInstanceId: input.connectorInstanceId,
          state: input.state,
          cadence: input.cadence,
          timezone: input.timezone,
        })
        onScheduleChanged?.()
        return created
      }

      const updated = await repository.update({
        connectorInstanceId: input.connectorInstanceId,
        expectedRevision: input.expectedRevision,
        state: input.state,
        cadence: input.cadence,
        timezone: input.timezone,
      })
      onScheduleChanged?.()
      return updated
    },
    async pause(input: PauseConnectorScheduleInput): Promise<ConnectorScheduleSummary> {
      requireAvailable()
      const paused = await repository.pause(input)
      onScheduleChanged?.()
      return paused
    },
    async resume(input: ResumeConnectorScheduleInput): Promise<ConnectorScheduleSummary> {
      requireAvailable()
      const resumed = await repository.resume(input)
      onScheduleChanged?.()
      return resumed
    },
    async delete(input: DeleteConnectorScheduleInput): Promise<void> {
      requireAvailable()
      await repository.delete(input)
      onScheduleChanged?.()
    },
    async listAudit(
      input: ConnectorScheduleHistoryListInput,
    ): Promise<ConnectorScheduleAuditListResult> {
      requireAvailable()
      const audit = await repository.listAudit(input)
      return audit
    },
    async listOccurrences(
      input: ConnectorScheduleHistoryListInput,
    ): Promise<ConnectorScheduleOccurrenceListResult> {
      requireAvailable()
      const occurrences = await repository.listOccurrences(input)
      return occurrences
    },
    async dispatchDue(
      input: DispatchConnectorScheduleDueInput,
    ): Promise<DispatchConnectorScheduleDueResult> {
      return dispatchDue(input)
    },
    async dispatchDueWithSignal(input, signal) {
      return dispatchDue(input, signal)
    },
  }
}
