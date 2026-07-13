import type { ConnectorAuthMode } from '@sparxie/valedictorian-connectors-core'
import { readOptionalNullableStringField, readOptionalStringField, readRecord, readStringField } from './local-server.http'

const connectorAuthModeSet = new Set<ConnectorAuthMode>([
  'none', 'api_key', 'bearer_token', 'oauth', 'cookie_jar', 'username_password',
])

export function readBooleanField(record: Record<string, unknown>, field: string) {
  const value = record[field]

  if (typeof value === 'boolean') {
    return value
  }

  throw new Error(`Missing ${field}`)
}
export function readOptionalRecordField(record: Record<string, unknown>, field: string) {
  if (!(field in record)) {
    return undefined
  }

  const value = record[field]

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  throw new Error(`Invalid ${field}`)
}

export function readOptionalConnectorAuthReferences(record: Record<string, unknown>) {
  if (!('auth' in record)) {
    return undefined
  }

  const value = record.auth

  if (!Array.isArray(value)) {
    throw new Error('Invalid auth')
  }

  return value.map((entry, index) => {
    const authRecord = readRecord(entry)
    const mode = readStringField(authRecord, 'mode')

    if (!isConnectorAuthMode(mode)) {
      throw new Error(`Invalid auth[${index}].mode: ${mode}`)
    }

    const reference = {
      id: readStringField(authRecord, 'id'),
      mode,
    } as {
      id: string
      mode: ConnectorAuthMode
      label?: string | null
      secretKey?: string
    }
    const label = readOptionalNullableStringField(authRecord, 'label')
    const secretKey = readOptionalStringField(authRecord, 'secretKey')

    if (label !== undefined) {
      reference.label = label
    }

    if (secretKey !== undefined) {
      reference.secretKey = secretKey
    }

    return reference
  })
}

function isConnectorAuthMode(value: string): value is ConnectorAuthMode {
  return connectorAuthModeSet.has(value as ConnectorAuthMode)
}

export function validateConnectorTimestamp(value: string | null | undefined, fieldName: string) {
  if (value === undefined || value === null) {
    return
  }

  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(new Date(value).getTime())) {
    throw new Error(`Invalid ${fieldName}: ${value}`)
  }
}
