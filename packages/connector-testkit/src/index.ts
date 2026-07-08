import type {
  ConnectorCoverageWindow,
  ConnectorDefinition,
  ConnectorRefreshInput,
  ConnectorRefreshMode,
  ConnectorRefreshResult,
  JobConnector,
  JobObservation,
} from "@valedictorian-connectors/core"

export type FixtureConnectorOptions = {
  observedAt: string
}

export function createFixtureConnector(
  options: FixtureConnectorOptions,
): JobConnector {
  const definition: ConnectorDefinition = {
    id: "fixture.jobs",
    version: "0.0.0-fixture",
  }

  return {
    definition,
    async refresh(
      input: ConnectorRefreshInput,
    ): Promise<ConnectorRefreshResult> {
      const observation: JobObservation = {
        connectorId: definition.id,
        connectorVersion: definition.version,
        sourceRecordKey: "fixture.jobs:software-engineering-intern",
        observedAt: options.observedAt,
        companyName: "Example Robotics",
        roleTitle: "Software Engineering Intern",
        locationRaw: "Remote",
        descriptionText: "Build fixture robots and connector proofs.",
        pay: null,
        links: {
          source: "https://example.test/jobs/software-engineering-intern",
          intermediary: null,
          official: "https://example.test/apply/software-engineering-intern",
        },
        resolution: {
          status: "resolved",
          method: "fixture",
          reason: null,
        },
        dedupeKeys: [
          "official:https://example.test/apply/software-engineering-intern",
          "source:fixture.jobs:software-engineering-intern",
        ],
        sourceMetadata: {
          fixture: true,
        },
        evidence: [
          {
            type: "fixture",
            capturedAt: options.observedAt,
            sourceUrl:
              "https://example.test/jobs/software-engineering-intern",
          },
        ],
      }

      return {
        observations: [observation],
        nextCheckpoint: {
          checkpoint: {
            cursor: `fixture:${options.observedAt}`,
          },
          schemaVersion: "fixture-checkpoint@1",
        },
        coverage: input.coverage,
        stats: {
          observations: 1,
        },
        warnings: [],
      }
    },
  }
}

export type ConnectorInstanceRecord = {
  id: string
  connectorId: string
  connectorVersion: string
  workspaceId: string
  displayName: string
  enabled: boolean
  createdAt: string
}

export type ConnectorRunRecord = {
  id: string
  connectorInstanceId: string
  workspaceId: string
  mode: ConnectorRefreshMode
  status: "success" | "failed"
  coverage: ConnectorCoverageWindow
  stats: {
    observations: number
  }
  warnings: ConnectorRefreshResult["warnings"]
}

export type ConnectorCheckpointRecord = {
  connectorInstanceId: string
  checkpoint: unknown
  schemaVersion: string
}

export type HostObservationRecord = JobObservation & {
  connectorInstanceId: string
}

export type InMemoryConnectorHostSnapshot = {
  instances: ConnectorInstanceRecord[]
  runs: ConnectorRunRecord[]
  checkpoints: ConnectorCheckpointRecord[]
  observations: HostObservationRecord[]
}

export type InMemoryConnectorHostRefreshRequest = {
  connectorInstanceId: string
  workspaceId: string
  mode: ConnectorRefreshMode
  coverage: ConnectorCoverageWindow
}

export type InMemoryConnectorHost = {
  registerInstance: (instance: ConnectorInstanceRecord) => void
  refresh: (
    connector: JobConnector,
    request: InMemoryConnectorHostRefreshRequest,
  ) => Promise<ConnectorRunRecord>
  snapshot: () => InMemoryConnectorHostSnapshot
}

export function createInMemoryConnectorHost(): InMemoryConnectorHost {
  const instances = new Map<string, ConnectorInstanceRecord>()
  const runs: ConnectorRunRecord[] = []
  const checkpoints = new Map<string, ConnectorCheckpointRecord>()
  const observations: HostObservationRecord[] = []
  let runCounter = 0

  return {
    registerInstance(instance) {
      instances.set(instance.id, { ...instance })
    },

    async refresh(connector, request) {
      const instance = instances.get(request.connectorInstanceId)
      if (!instance) {
        throw new Error(
          `Unknown connector instance: ${request.connectorInstanceId}`,
        )
      }
      if (instance.workspaceId !== request.workspaceId) {
        throw new Error(
          `Workspace mismatch for connector instance: ${request.connectorInstanceId}`,
        )
      }

      const existingCheckpoint = checkpoints.get(request.connectorInstanceId)
      const result = await connector.refresh(
        {
          connectorInstanceId: request.connectorInstanceId,
          workspaceId: request.workspaceId,
          mode: request.mode,
          coverage: request.coverage,
          ...(existingCheckpoint
            ? { checkpoint: existingCheckpoint.checkpoint }
            : {}),
        },
        {},
      )

      runCounter += 1
      const run: ConnectorRunRecord = {
        id: `run_${runCounter}`,
        connectorInstanceId: request.connectorInstanceId,
        workspaceId: request.workspaceId,
        mode: request.mode,
        status: "success",
        coverage: result.coverage,
        stats: result.stats,
        warnings: result.warnings,
      }
      runs.push(run)

      checkpoints.set(request.connectorInstanceId, {
        connectorInstanceId: request.connectorInstanceId,
        checkpoint: result.nextCheckpoint.checkpoint,
        schemaVersion: result.nextCheckpoint.schemaVersion,
      })

      for (const observation of result.observations) {
        observations.push({
          ...observation,
          connectorInstanceId: request.connectorInstanceId,
        })
      }

      return run
    },

    snapshot() {
      return {
        instances: [...instances.values()],
        runs: [...runs],
        checkpoints: [...checkpoints.values()],
        observations: [...observations],
      }
    },
  }
}
