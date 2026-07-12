import type { ConnectorInstanceRecord } from './connector-instance.persistence-types'
import type { ConnectorRunRecord } from './connector-run.persistence-types'

export interface ConnectorStatusSummaryRecord extends ConnectorInstanceRecord {
  latestRun: ConnectorRunRecord | null
}
