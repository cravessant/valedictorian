import type {
  ConnectorHistoricalBackfillState,
  ConnectorNewestFrontierState,
  RetryAdvice,
  SourceOperationOutcome,
} from "sparxie"
import {
  sanitizeConnectorRefreshStopReason,
  type ConnectorRefreshStopReason,
  type ConnectorRefreshWarning,
  type ConnectorSynchronizationOutcome,
} from "./connector-outcomes.js"
import type { JobObservation } from "./observation.js"

export type ConnectorCoverageWindow = {
  start: string
  end: string
}

export type ConnectorCheckpointPayload = {
  checkpoint: unknown
  schemaVersion: string
}

export type ConnectorRefreshStats = {
  observations: number
  attempted?: number
  authRequired?: number
  discovered?: number
  discoveryPages?: number
  eligible?: number
  filtered?: number
  providerReturned?: number
  providerValid?: number
  providerInvalid?: number
  sourceDuplicates?: number
  pendingResolution?: number
  resolved?: number
  resolvedEmployerOrAts?: number
  resolvedThirdParty?: number
  skipped?: number
  stopReason?: ConnectorRefreshStopReason
  totalAvailable?: number
  unresolved?: number
}

const connectorRefreshNumericStats = [
  "attempted",
  "authRequired",
  "discovered",
  "discoveryPages",
  "eligible",
  "filtered",
  "providerReturned",
  "providerValid",
  "providerInvalid",
  "sourceDuplicates",
  "pendingResolution",
  "resolved",
  "resolvedEmployerOrAts",
  "resolvedThirdParty",
  "skipped",
  "totalAvailable",
  "unresolved",
] as const satisfies readonly (keyof ConnectorRefreshStats)[]

export function sanitizeConnectorRefreshStats(
  value: unknown,
): ConnectorRefreshStats {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const stats: ConnectorRefreshStats = {
    observations: sanitizedCount(record.observations),
  }
  // These are independently reported connector aggregates. The shared ABI
  // declares no cross-provider sum relationship between its named counters.
  for (const key of connectorRefreshNumericStats) {
    if (Object.hasOwn(record, key)) stats[key] = sanitizedCount(record[key])
  }
  if (Object.hasOwn(record, "stopReason")) {
    stats.stopReason = sanitizeConnectorRefreshStopReason(record.stopReason)
  }
  return stats
}

function sanitizedCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0
}

export type ConnectorRefreshStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped"

export type ConnectorRefreshResult = {
  observations: JobObservation[]
  nextCheckpoint: ConnectorCheckpointPayload
  coverage: ConnectorCoverageWindow
  stats: ConnectorRefreshStats
  warnings: ConnectorRefreshWarning[]
  status: ConnectorRefreshStatus
  retryHints?: RetryAdvice | null
  operationOutcome: SourceOperationOutcome | null
  synchronization: {
    newestFrontier: ConnectorNewestFrontierState
    historicalBackfill: ConnectorHistoricalBackfillState
    pendingResolutionCount: number
    outcome: ConnectorSynchronizationOutcome
  }
}
