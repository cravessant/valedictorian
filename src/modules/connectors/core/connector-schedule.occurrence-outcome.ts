import type { ConnectorScheduleOccurrenceOutcome } from '@sparxie/sdk'

export const TERMINAL_CONNECTOR_RUN_STATUSES = [
  'completed',
  'failed',
  'cancelled',
  'skipped',
] as const

export type TerminalConnectorRunStatus = (typeof TERMINAL_CONNECTOR_RUN_STATUSES)[number]

export function isTerminalConnectorRunStatus(
  status: string,
): status is TerminalConnectorRunStatus {
  return (TERMINAL_CONNECTOR_RUN_STATUSES as readonly string[]).includes(status)
}

export function occurrenceOutcomeForRunStatus(
  status: string,
): ConnectorScheduleOccurrenceOutcome {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    case 'skipped':
      return 'skipped'
    default:
      return 'admitted'
  }
}
