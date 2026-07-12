import type {
  ConnectorRefreshInput,
  ConnectorRefreshResult,
} from "@sparxie/valedictorian-connectors-core"

export function emptyRefreshResult(input: ConnectorRefreshInput): ConnectorRefreshResult {
  return {
    observations: [],
    nextCheckpoint: {
      checkpoint: {
        cursor: input.coverage.end,
      },
      schemaVersion: "fixture-checkpoint@1",
    },
    coverage: input.coverage,
    stats: {
      observations: 0,
    },
    warnings: [],
    status: "completed",
    operationOutcome: null,
    synchronization: {
      newestFrontier: { state: "caught_up" },
      historicalBackfill: {
        state: "caught_up",
        boundary: { earliestDate: input.coverage.start.slice(0, 10) },
      },
      pendingResolutionCount: 0,
      outcome: { kind: "caught_up" },
    },
  }
}
