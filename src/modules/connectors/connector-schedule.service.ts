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
import type { DrizzleDatabase } from '../../db/sqlite'
import { requireAvailableConnectorScheduling } from './connector-schedule.capability'
import { admitConnectorScheduleDue } from './connector-schedule.dispatch'
import { resolveAdmittedScheduleDispatch } from './connector-schedule.execution'
import { createConnectorScheduleError } from './connector-schedule.errors'
import type { createConnectorScheduleRepository } from './connector-schedule.repository'
import type { ConnectorRunRecord } from './connector.repository'

export type ConnectorScheduleClient = ValedictorianWorkspaceClient['connectors']['schedules']

export function createConnectorScheduleService({
  claimQueuedRunToRunning,
  connectorScheduling,
  database,
  executeClaimedRun,
  getRun,
  now,
  repository,
}: {
  claimQueuedRunToRunning: (input: {
    connectorRunId: string
    startedAt: string
  }) => Promise<{ claimed: boolean; run: ConnectorRunRecord }>
  connectorScheduling: ConnectorSchedulingCapability
  database: DrizzleDatabase
  executeClaimedRun: (input: {
    connectorRunId: string
    mode: 'scheduled' | 'catch_up'
    coverageEndedAt: string
    startedAt: string
  }) => Promise<ConnectorRunRecord>
  getRun: (connectorRunId: string) => Promise<ConnectorRunRecord | null>
  now: () => Date
  repository: ReturnType<typeof createConnectorScheduleRepository>
}): ConnectorScheduleClient {
  const requireAvailable = () => requireAvailableConnectorScheduling(connectorScheduling)

  return {
    async get(connectorInstanceId) {
      if (!connectorScheduling.available) {
        return null
      }

      return repository.getByConnectorInstanceId(connectorInstanceId)
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
        return repository.create({
          connectorInstanceId: input.connectorInstanceId,
          state: input.state,
          cadence: input.cadence,
          timezone: input.timezone,
        })
      }

      return repository.update({
        connectorInstanceId: input.connectorInstanceId,
        expectedRevision: input.expectedRevision,
        state: input.state,
        cadence: input.cadence,
        timezone: input.timezone,
      })
    },
    async pause(input: PauseConnectorScheduleInput): Promise<ConnectorScheduleSummary> {
      requireAvailable()
      return repository.pause(input)
    },
    async resume(input: ResumeConnectorScheduleInput): Promise<ConnectorScheduleSummary> {
      requireAvailable()
      return repository.resume(input)
    },
    async delete(input: DeleteConnectorScheduleInput): Promise<void> {
      requireAvailable()
      repository.delete(input)
    },
    async listAudit(
      input: ConnectorScheduleHistoryListInput,
    ): Promise<ConnectorScheduleAuditListResult> {
      requireAvailable()
      return repository.listAudit(input)
    },
    async listOccurrences(
      input: ConnectorScheduleHistoryListInput,
    ): Promise<ConnectorScheduleOccurrenceListResult> {
      requireAvailable()
      return repository.listOccurrences(input)
    },
    async dispatchDue(
      input: DispatchConnectorScheduleDueInput,
    ): Promise<DispatchConnectorScheduleDueResult> {
      const capability = requireAvailable()
      const admitted = admitConnectorScheduleDue({
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
        executeClaimedRun,
        getRun,
        markOccurrenceOutcome: (input) => repository.markOccurrenceOutcome(input),
        now,
      })
    },
  }
}
