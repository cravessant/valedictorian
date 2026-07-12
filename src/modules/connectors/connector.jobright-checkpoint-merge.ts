import type { ConnectorCheckpointPayload } from './connector.repository.types'
import { JOBRIGHT_CHECKPOINT_SCHEMA_V5 } from './jobright.constants'

export function restoreUnacquiredJobrightV5RetryEntries(input: {
  acquiredProviderRecordId: string
  originalCheckpoint: unknown
  returned: ConnectorCheckpointPayload
}): ConnectorCheckpointPayload {
  if (input.returned.schemaVersion !== JOBRIGHT_CHECKPOINT_SCHEMA_V5) {
    return input.returned
  }
  const originalPending = readPendingDetailRetries(input.originalCheckpoint, 'original')
  const returnedCheckpoint = readCheckpointRecord(input.returned.checkpoint, 'returned')
  const returnedPending = readPendingDetailRetries(returnedCheckpoint, 'returned')
  const acquiredSourceId = `jobright.public:${input.acquiredProviderRecordId}`
  const untouched = originalPending.filter((entry) => entry.sourceId !== acquiredSourceId)
  const acquiredReturned = returnedPending.filter((entry) => entry.sourceId === acquiredSourceId)
  const pendingDetailRetries = [...untouched, ...acquiredReturned]
  return {
    schemaVersion: input.returned.schemaVersion,
    checkpoint: {
      ...returnedCheckpoint,
      pendingDetailRetries,
      retryState: activeRetryStateFromPending(pendingDetailRetries),
    },
  }
}

function readCheckpointRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Jobright v5 ${label} checkpoint is malformed`)
  }
  return value as Record<string, unknown>
}

function readPendingDetailRetries(value: unknown, label: string): Array<Record<string, unknown>> {
  const record = readCheckpointRecord(value, label)
  if (!Array.isArray(record.pendingDetailRetries)) {
    throw new Error(`Jobright v5 ${label} checkpoint pending retry ledger is malformed`)
  }
  return record.pendingDetailRetries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Jobright v5 ${label} checkpoint pending retry entry is malformed`)
    }
    const pending = entry as Record<string, unknown>
    if (typeof pending.sourceId !== 'string' || !Object.prototype.hasOwnProperty.call(pending, 'advice')) {
      throw new Error(`Jobright v5 ${label} checkpoint pending retry entry is malformed`)
    }
    return pending
  })
}

function activeRetryStateFromPending(
  pendingDetailRetries: Array<Record<string, unknown>>,
): Array<{ sourceId: unknown; advice: unknown }> {
  return pendingDetailRetries
    .filter((entry) => entry.ownership === 'active')
    .map((entry) => ({
      sourceId: entry.sourceId,
      advice: entry.advice,
    }))
}
