import type { JsonRecord } from './connector.persistence-json'

export interface ConnectorObservationLinks {
  source: string | null
  intermediary: string | null
  official: string | null
}

export interface ConnectorObservationResolution {
  status: string
  method: string | null
  reason: string | null
}

export interface ConnectorObservationEvidence {
  type: string
  capturedAt: string
  sourceUrl: string | null
}

export interface ConnectorObservationInput {
  connectorId: string
  connectorVersion: string
  parserVersion?: string | null
  observationSchemaVersion?: string | null
  sourceRecordKey: string
  observedAt: string
  companyName: string
  roleTitle: string
  locationRaw?: string | null
  descriptionText?: string | null
  pay?: unknown
  links: ConnectorObservationLinks
  resolution: ConnectorObservationResolution
  dedupeKeys: string[]
  sourceMetadata?: JsonRecord
  evidence: ConnectorObservationEvidence[]
}

export interface ConnectorObservationRecord extends ConnectorObservationInput {
  id: string
  connectorInstanceId: string
  connectorRunId: string
  sourceMetadata: JsonRecord
  createdAt: string
  updatedAt: string
}

export interface ListConnectorObservationsInput {
  connectorInstanceId: string
  connectorRunId?: string
}
