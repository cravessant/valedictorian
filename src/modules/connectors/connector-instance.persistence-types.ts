import type { JsonRecord } from './connector.persistence-json'
import type {
  ConnectorAuthMode,
  ConnectorAuthReference,
} from '@sparxie/valedictorian-connectors-core'

export type { ConnectorAuthMode, ConnectorAuthReference }

export interface UpsertConnectorInstanceInput {
  id: string
  connectorId: string
  connectorVersion: string
  displayName: string
  enabled: boolean
  auth?: ConnectorAuthReference[]
  config?: JsonRecord
  filters?: JsonRecord
  earliestBackfillDate?: string
  createdAt?: string
}

export interface ConnectorInstanceRecord {
  id: string
  executionScopeId: string
  connectorId: string
  connectorVersion: string
  displayName: string
  enabled: boolean
  auth: ConnectorAuthReference[]
  config: unknown
  filters: unknown
  earliestBackfillDate: string
  createdAt: string
  updatedAt: string
}
