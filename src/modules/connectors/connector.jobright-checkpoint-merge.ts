import type { ConnectorCheckpointPayload } from './connector.repository.types'

export function restoreUnacquiredJobrightV4RetryEntries(input: {
  acquiredProviderRecordId: string
  originalCheckpoint: unknown
  returned: ConnectorCheckpointPayload
}): ConnectorCheckpointPayload {
  if (input.returned.schemaVersion !== 'jobright-resolution-checkpoint@4') {
    return input.returned
  }
  if (!input.originalCheckpoint || typeof input.originalCheckpoint !== 'object' || Array.isArray(input.originalCheckpoint)) {
    throw new Error('Jobright v4 original checkpoint is malformed')
  }
  if (!input.returned.checkpoint || typeof input.returned.checkpoint !== 'object' || Array.isArray(input.returned.checkpoint)) {
    throw new Error('Jobright v4 returned checkpoint is malformed')
  }
  const original = input.originalCheckpoint as Record<string, unknown>
  const returned = input.returned.checkpoint as Record<string, unknown>
  if (!Array.isArray(original.retryState) || !Array.isArray(returned.retryState)) {
    throw new Error('Jobright v4 checkpoint retry state is malformed')
  }
  const acquiredSourceId = `jobright.public:${input.acquiredProviderRecordId}`
  const untouched = original.retryState.filter((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Jobright v4 checkpoint retry entry is malformed')
    }
    return (entry as { sourceId?: unknown }).sourceId !== acquiredSourceId
  })
  const acquiredReturned = returned.retryState.filter((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Jobright v4 checkpoint retry entry is malformed')
    }
    return (entry as { sourceId?: unknown }).sourceId === acquiredSourceId
  })
  return {
    schemaVersion: input.returned.schemaVersion,
    checkpoint: {
      ...returned,
      retryState: [...untouched, ...acquiredReturned],
    },
  }
}
