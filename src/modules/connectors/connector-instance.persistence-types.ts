import type { JsonRecord } from './connector.persistence-json'

export type ConnectorAuthMode =
  | 'none'
  | 'api_key'
  | 'bearer_token'
  | 'oauth'
  | 'cookie_jar'
  | 'browser_session'
  | 'username_password'

export interface ConnectorAuthReference {
  id: string
  mode: ConnectorAuthMode
  label?: string
  secretKey?: string
  sessionKey?: string
}

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
