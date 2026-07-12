import { connectorAuthModes } from 'sparxie'
import { readOptionalNullableStringField, readOptionalStringField, readRecord, readStringField } from './local-server.http'

const connectorAuthModeSet = new Set(connectorAuthModes)

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

    if (!connectorAuthModeSet.has(mode as never)) {
      throw new Error(`Invalid auth[${index}].mode: ${mode}`)
    }

    const reference = {
      id: readStringField(authRecord, 'id'),
      mode: mode as (typeof connectorAuthModes)[number],
    } as {
      id: string
      mode: (typeof connectorAuthModes)[number]
      label?: string | null
      secretKey?: string
      sessionKey?: string
    }
    const label = readOptionalNullableStringField(authRecord, 'label')
    const secretKey = readOptionalStringField(authRecord, 'secretKey')
    const sessionKey = readOptionalStringField(authRecord, 'sessionKey')

    if (label !== undefined) {
      reference.label = label
    }

    if (secretKey !== undefined) {
      reference.secretKey = secretKey
    }

    if (sessionKey !== undefined) {
      reference.sessionKey = sessionKey
    }

    return reference
  })
}

export function validateConnectorTimestamp(value: string | null | undefined, fieldName: string) {
  if (value === undefined || value === null) {
    return
  }

  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(new Date(value).getTime())) {
    throw new Error(`Invalid ${fieldName}: ${value}`)
  }
}
