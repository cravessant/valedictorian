import type { ConnectorScheduleOccurrenceSummary } from '@sparxie/sdk'

export type ScheduleOccurrenceOutcomeWriter = (input: {
  occurrenceId: string
  outcome: ConnectorScheduleOccurrenceSummary['outcome']
}) => Promise<ConnectorScheduleOccurrenceSummary>

export interface ConnectorRunOccurrenceReader {
  getOccurrenceLinkForRun(
    connectorRunId: string,
  ): Promise<ConnectorScheduleOccurrenceSummary | null>
}
