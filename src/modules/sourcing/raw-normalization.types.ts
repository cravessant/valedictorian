import type {
  RawSourceNormalizationResult,
  RawSourceProjectionResult,
  RawSourceRecord,
  RawSourceRecordsListQuery,
  RawSourceRecordsListResult,
} from 'sparxie'

export interface RawRecordsReadApi {
  list(query?: RawSourceRecordsListQuery): Promise<RawSourceRecordsListResult>
  get(rawRecordId: string): Promise<RawSourceRecord>
  getNormalization(rawRecordId: string): Promise<RawSourceNormalizationResult>
  getProjection(rawRevisionId: string): Promise<RawSourceProjectionResult>
}

export interface RawNormalizationRunFilter {
  connectorInstanceId: string
  connectorRunId: string
}
