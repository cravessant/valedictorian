import { connectorObservations } from '../../db/schema'
import type { ConnectorObservationEvidence, ConnectorObservationLinks, ConnectorObservationRecord, ConnectorObservationResolution } from './connector-observation.persistence-types'
import type { JsonRecord } from './connector.persistence-json'

export function mapConnectorObservation(
  row: typeof connectorObservations.$inferSelect,
): ConnectorObservationRecord {
  return {
    id: row.id,
    connectorInstanceId: row.connectorInstanceId,
    connectorRunId: row.connectorRunId,
    connectorId: row.connectorId,
    connectorVersion: row.connectorVersion,
    parserVersion: row.parserVersion ?? null,
    observationSchemaVersion: row.observationSchemaVersion ?? null,
    sourceRecordKey: row.sourceRecordKey,
    observedAt: row.observedAt,
    companyName: row.companyName,
    roleTitle: row.roleTitle,
    locationRaw: row.locationRaw,
    descriptionText: row.descriptionText,
    pay: JSON.parse(row.payJson) as unknown,
    links: JSON.parse(row.linksJson) as ConnectorObservationLinks,
    resolution: JSON.parse(row.resolutionJson) as ConnectorObservationResolution,
    dedupeKeys: JSON.parse(row.dedupeKeysJson) as string[],
    sourceMetadata: JSON.parse(row.sourceMetadataJson) as JsonRecord,
    evidence: JSON.parse(row.evidenceJson) as ConnectorObservationEvidence[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
