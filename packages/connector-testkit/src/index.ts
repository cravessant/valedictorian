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
    displayName: "Fixture jobs",
    configSchema: {
      version: "fixture-config@1",
      schema: {
        type: "object",
        properties: {
          listUrl: {
            type: "string",
          },
        },
        additionalProperties: true,
      },
    },
    filterSchema: {
      version: "fixture-filters@1",
      schema: {
        type: "object",
        properties: {
          roleKeywords: {
            type: "array",
            items: {
              type: "string",
            },
          },
        },
        additionalProperties: true,
      },
    },
    auth: {
      modes: ["none"],
    },
    capabilities: {
      fetchesPublicPages: false,
      resolvesIntermediaryLinks: false,
      usesBrowserSession: false,
      supportsIncrementalRefresh: true,
      supportsFiltering: true,
    },
    checkpoint: {
      schemaVersion: "fixture-checkpoint@1",
    },
    politeness: {
      concurrency: 1,
      minDelayMs: 0,
      maxDelayMs: 0,
      maxRequestsPerRun: 1,
    },
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
  config?: unknown
  filters?: unknown
  createdAt: string
}

export type ConnectorRunRecord = {
  id: string
  connectorInstanceId: string
  workspaceId: string
  mode: ConnectorRefreshMode
  status: "success" | "failed"
  coverage: ConnectorCoverageWindow
  config: unknown
  filters: unknown
  filterSignature: string
  stats: {
    observations: number
  }
  warnings: ConnectorRefreshResult["warnings"]
}

export type ConnectorCheckpointRecord = {
  connectorInstanceId: string
  filterSignature: string
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
      instances.set(instance.id, cloneConnectorInstance(instance))
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

      const config = cloneJsonLike(instance.config ?? {})
      const filters = cloneJsonLike(instance.filters ?? {})
      const runConfig = cloneJsonLike(config)
      const runFilters = cloneJsonLike(filters)
      const filterSignature = signatureForFilters(filters)
      const checkpointKey = `${request.connectorInstanceId}:${filterSignature}`
      const existingCheckpoint = checkpoints.get(checkpointKey)
      const result = await connector.refresh(
        {
          connectorInstanceId: request.connectorInstanceId,
          workspaceId: request.workspaceId,
          mode: request.mode,
          coverage: request.coverage,
          config,
          filters,
          ...(existingCheckpoint
            ? { checkpoint: cloneJsonLike(existingCheckpoint.checkpoint) }
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
        config: runConfig,
        filters: runFilters,
        filterSignature,
        stats: result.stats,
        warnings: result.warnings,
      }
      runs.push(run)

      checkpoints.set(checkpointKey, {
        connectorInstanceId: request.connectorInstanceId,
        filterSignature,
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

function cloneConnectorInstance(
  instance: ConnectorInstanceRecord,
): ConnectorInstanceRecord {
  return {
    ...instance,
    ...(instance.config === undefined
      ? {}
      : { config: cloneJsonLike(instance.config) }),
    ...(instance.filters === undefined
      ? {}
      : { filters: cloneJsonLike(instance.filters) }),
  }
}

function signatureForFilters(filters: unknown): string {
  return `filters:${stableJsonStringify(filters ?? {})}`
}

function cloneJsonLike<T>(value: T): T {
  return JSON.parse(stableJsonStringify(value)) as T
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`)
      .join(",")}}`
  }

  return JSON.stringify(value)
}
