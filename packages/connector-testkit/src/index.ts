import type {
  ConnectorAuthGrant,
  ConnectorAuthReference,
  ConnectorAuthRequirement,
  ConnectorAuthResolveInput,
  ConnectorBrowserSessionResolveInput,
  ConnectorBrowserSessionResolveResult,
  ConnectorCoverageWindow,
  ConnectorDelayInput,
  ConnectorDefinition,
  ConnectorRefreshStatus,
  ConnectorRefreshInput,
  ConnectorRefreshMode,
  ConnectorRefreshResult,
  ConnectorRuntime,
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
      maxBackfillDays: 7,
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
  auth?: ConnectorAuthReference[]
  config?: unknown
  filters?: unknown
  createdAt: string
}

export type ConnectorRunRecord = {
  id: string
  connectorInstanceId: string
  workspaceId: string
  mode: ConnectorRefreshMode
  status: ConnectorRefreshStatus | "failed"
  coverage: ConnectorCoverageWindow
  config: unknown
  filters: unknown
  filterSignature: string
  stats: {
    observations: number
  }
  warnings: ConnectorRefreshResult["warnings"]
  retryHints: unknown
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

export type InMemoryConnectorBrowserSession = Pick<
  ConnectorAuthGrant,
  "expiresAt" | "reason" | "sessionId" | "status"
>

export type InMemoryConnectorHostOptions = {
  browserSessionResolver?: (
    input: ConnectorBrowserSessionResolveInput,
  ) =>
    | ConnectorBrowserSessionResolveResult
    | Promise<ConnectorBrowserSessionResolveResult>
  browserSessions?: Record<string, InMemoryConnectorBrowserSession>
  delay?: (input: ConnectorDelayInput) => number | Promise<number>
  secrets?: Record<string, string>
}

export function createInMemoryConnectorHost(
  options: InMemoryConnectorHostOptions = {},
): InMemoryConnectorHost {
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
      const connectorObservations =
        connector.definition.capabilities?.resolvesIntermediaryLinks === true
          ? observationsForWorkspace(observations, instances, request.workspaceId)
          : null
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
          ...(connectorObservations === null
            ? {}
            : { observations: connectorObservations }),
        },
        createConnectorRuntime(
          instance.auth ?? [],
          connector.definition.auth?.requirements ?? [],
          options,
        ),
      )

      runCounter += 1
      const run: ConnectorRunRecord = {
        id: `run_${runCounter}`,
        connectorInstanceId: request.connectorInstanceId,
        workspaceId: request.workspaceId,
        mode: request.mode,
        status: result.status ?? "completed",
        coverage: result.coverage,
        config: runConfig,
        filters: runFilters,
        filterSignature,
        stats: result.stats,
        warnings: result.warnings,
        retryHints: result.retryHints ?? null,
      }
      runs.push(run)

      checkpoints.set(checkpointKey, {
        connectorInstanceId: request.connectorInstanceId,
        filterSignature,
        checkpoint: result.nextCheckpoint.checkpoint,
        schemaVersion: result.nextCheckpoint.schemaVersion,
      })

      for (const observation of result.observations) {
        upsertObservation(
          observations,
          instances,
          request.workspaceId,
          request.connectorInstanceId,
          observation,
        )
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
    ...(instance.auth === undefined
      ? {}
      : { auth: cloneJsonLike(instance.auth) }),
    ...(instance.config === undefined
      ? {}
      : { config: cloneJsonLike(instance.config) }),
    ...(instance.filters === undefined
      ? {}
      : { filters: cloneJsonLike(instance.filters) }),
  }
}

function createConnectorRuntime(
  authReferences: ConnectorAuthReference[],
  authRequirements: ConnectorAuthRequirement[],
  options: InMemoryConnectorHostOptions,
): ConnectorRuntime {
  const runtime: ConnectorRuntime = {
    auth: {
      async resolve(input) {
        return resolveAuthGrant(input, authReferences, authRequirements, options)
      },
    },
  }

  if (options.browserSessionResolver) {
    runtime.browserSession = {
      async resolveLink(input) {
        return await options.browserSessionResolver!(input)
      },
    }
  }

  if (options.delay) {
    runtime.delay = {
      async wait(input) {
        return await options.delay!(input)
      },
    }
  }

  return runtime
}

function observationsForWorkspace(
  observations: HostObservationRecord[],
  instances: Map<string, ConnectorInstanceRecord>,
  workspaceId: string,
): JobObservation[] {
  return observations
    .filter(
      (observation) =>
        instances.get(observation.connectorInstanceId)?.workspaceId ===
        workspaceId,
    )
    .map(({ connectorInstanceId: _connectorInstanceId, ...observation }) =>
      cloneJsonLike(observation),
    )
}

function upsertObservation(
  observations: HostObservationRecord[],
  instances: Map<string, ConnectorInstanceRecord>,
  workspaceId: string,
  connectorInstanceId: string,
  observation: JobObservation,
): void {
  const existingIndex = observations.findIndex(
    (storedObservation) =>
      storedObservation.sourceRecordKey === observation.sourceRecordKey &&
      instances.get(storedObservation.connectorInstanceId)?.workspaceId ===
        workspaceId,
  )
  const existingConnectorInstanceId =
    existingIndex === -1
      ? connectorInstanceId
      : observations[existingIndex]?.connectorInstanceId ?? connectorInstanceId
  const record = cloneJsonLike({
    ...observation,
    connectorInstanceId: existingConnectorInstanceId,
  })

  if (existingIndex === -1) {
    observations.push(record)
    return
  }

  observations[existingIndex] = record
}

function resolveAuthGrant(
  input: ConnectorAuthResolveInput,
  authReferences: ConnectorAuthReference[],
  authRequirements: ConnectorAuthRequirement[],
  options: InMemoryConnectorHostOptions,
): ConnectorAuthGrant {
  const reference = authReferences.find(
    (authReference) =>
      authReference.id === input.id &&
      (input.mode === undefined || authReference.mode === input.mode),
  )
  const requirement = authRequirements.find(
    (authRequirement) =>
      authRequirement.id === input.id &&
      (input.mode === undefined || authRequirement.mode === input.mode),
  )
  const mode = input.mode ?? reference?.mode ?? requirement?.mode

  if (mode === "none") {
    return {
      id: input.id,
      mode,
      status: "ready",
    }
  }

  if (!reference) {
    return {
      id: input.id,
      mode: mode ?? "none",
      reason: "auth_reference_missing",
      status: "missing",
    }
  }
  const referenceMode = reference.mode

  if (
    referenceMode === "api_key" ||
    referenceMode === "bearer_token" ||
    referenceMode === "oauth" ||
    referenceMode === "cookie_jar"
  ) {
    return resolveSecretGrant(reference, options)
  }

  const sessionKey = reference.sessionKey

  if (!sessionKey) {
    return {
      id: reference.id,
      mode: referenceMode,
      reason: "session_reference_missing",
      status: "missing",
    }
  }

  const sessionGrant = options.browserSessions?.[sessionKey]

  if (sessionGrant) {
    return {
      id: reference.id,
      mode: referenceMode,
      sessionKey,
      status: sessionGrant.status,
      ...(sessionGrant.expiresAt === undefined
        ? {}
        : { expiresAt: sessionGrant.expiresAt }),
      ...(sessionGrant.reason === undefined ? {} : { reason: sessionGrant.reason }),
      ...(sessionGrant.sessionId === undefined
        ? {}
        : { sessionId: sessionGrant.sessionId }),
    }
  }

  return {
    id: reference.id,
    mode: referenceMode,
    sessionKey,
    reason: "browser_session_action_required",
    status: "action_required",
  }
}

function resolveSecretGrant(
  reference: ConnectorAuthReference,
  options: InMemoryConnectorHostOptions,
): ConnectorAuthGrant {
  if (!reference.secretKey) {
    return {
      id: reference.id,
      mode: reference.mode,
      reason: "secret_reference_missing",
      status: "missing",
    }
  }

  const value = options.secrets?.[reference.secretKey]

  if (value === undefined) {
    return {
      id: reference.id,
      mode: reference.mode,
      reason: "secret_missing",
      secretKey: reference.secretKey,
      status: "missing",
    }
  }

  return {
    id: reference.id,
    mode: reference.mode,
    secretKey: reference.secretKey,
    status: "ready",
    value,
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
