import type { ConnectorInstanceRecord } from './connector-instance.records.js'
import type { ConnectorRunRecord } from './connector-run.records.js'

export interface ConnectorStatusSummaryRecord extends ConnectorInstanceRecord {
  latestRun: ConnectorRunRecord | null
}
