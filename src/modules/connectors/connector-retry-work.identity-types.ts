export type AcquiredRetryWork =
  | {
    kind: 'connector_capture'
    retryWorkId: string
  }
  | {
    kind: 'normalization'
    retryWorkId: string
    rawRevisionId: string
    resolverId: string
    resolverVersion: string
    inputHash: string
    lastAttemptAt: string
  }
