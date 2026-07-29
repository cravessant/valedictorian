import type { ConnectorStatusSeverity, ConnectorStatusState } from '@sparxie/sdk'
import type { ConnectorStatusSummaryRecord } from './connector-status.records'

export interface ConnectorOverviewStatusPageInput {
  cursorId?: string
  enabled?: boolean
  limit: number
  severity?: ConnectorStatusSeverity
  status?: ConnectorStatusState
}

export interface ConnectorOverviewStatusPage {
  items: ConnectorStatusSummaryRecord[]
  hasMore: boolean
}
