import { isJobTimingMode, type JobTerm, type JobTimingMode } from 'sparxie'
import { readOptionalStringField } from './local-server.http'

export function readOptionalJobTermsField(
  record: Record<string, unknown>,
): JobTerm[] | null | undefined {
  if (!('terms' in record)) return undefined
  const value = record.terms
  if (value === null) return null
  if (!Array.isArray(value)) throw new Error('terms must be an array.')
  return value as JobTerm[]
}

export function readOptionalJobTimingModeField(
  record: Record<string, unknown>,
): JobTimingMode | undefined {
  const value = readOptionalStringField(record, 'timingMode')
  if (value === undefined) return undefined
  if (!isJobTimingMode(value)) throw new Error(`Invalid timingMode: ${value}`)
  return value
}
