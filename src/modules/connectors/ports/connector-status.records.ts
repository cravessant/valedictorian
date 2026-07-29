import type { ConnectorInstanceRecord } from './connector-instance.records'
import type { ConnectorRunRecord } from './connector-run.records'

export interface ConnectorStatusSummaryRecord extends ConnectorInstanceRecord {
  latestRun: ConnectorRunRecord | null
}
