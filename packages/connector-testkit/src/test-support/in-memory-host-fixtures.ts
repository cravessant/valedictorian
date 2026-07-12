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
  }
}
