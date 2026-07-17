import { createHash } from "node:crypto"

import type {
  ConnectorAuthGrant,
  ConnectorAuthEstablishmentResult,
  ConnectorAuthReference,
  ConnectorAuthRequirement,
  ConnectorAuthResolveInput,
  ConnectorAuthValidationResult,
  ConnectorCoverageWindow,
  ConnectorDelayInput,
  ConnectorDefinition,
  ConnectorProgressSnapshot,
  ConnectorRawSourceCaptureInput,
  ConnectorRefreshStatus,
  ConnectorRefreshInput,
  ConnectorRefreshMode,
  ConnectorRefreshResult,
  ConnectorRuntime,
  JobConnector,
  JobObservation,
  FieldResolutionOutcome,
  RawSourceIntakeReceipt,
  RawSourceRecordInput,
  RawSourceRevisionReceipt,
  ResolverDeclaration,
  RetryAdvice,
} from "@sparxie/valedictorian-connectors-core"
import { jobObservationSchemaVersion } from "@sparxie/valedictorian-connectors-core"
import { connectorRunSummarySchema } from "sparxie"

export function assertValidConnectorRunSummary(input: unknown): void {
  connectorRunSummarySchema.parse(input)
}

export type FixtureConnectorOptions = {
  observedAt: string
}

export function createFixtureConnector(
  options: FixtureConnectorOptions,
): JobConnector {
  const parserVersion = "fixture-parser@1"
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
            maxLength: 2_048,
          },
        },
        additionalProperties: true,
      },
      presentation: {
        fields: {
          "/listUrl": {
            label: "List URL",
            description: "Fixture list address used by the in-memory host.",
          },
        },
      },
    },
    filterSchema: {
      version: "fixture-filters@1",
      schema: {
        type: "object",
        properties: {
          roleKeywords: {
            type: "array",
            maxItems: 50,
            items: {
              type: "string",
              maxLength: 256,
            },
          },
        },
        additionalProperties: true,
      },
      presentation: {
        fields: {
          "/roleKeywords": {
            label: "Role keywords",
            description: "Fixture keywords used to exercise filter presentation.",
          },
        },
      },
    },
    auth: {
      modes: ["none"],
    },
    capabilities: {
      fetchesPublicPages: false,
      resolvesIntermediaryLinks: false,
      supportsIncrementalRefresh: true,
      supportsFiltering: true,
    },
    checkpoint: {
      schemaVersion: "fixture-checkpoint@1",
    },
    observation: {
      schemaVersion: jobObservationSchemaVersion,
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
        parserVersion,
        observationSchemaVersion: jobObservationSchemaVersion,
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
  startedAt: string
  completedAt: string
  connectorInstanceId: string
  workspaceId: string
  mode: ConnectorRefreshMode
  status: ConnectorRefreshStatus | "failed"
  coverage: ConnectorCoverageWindow
  config: unknown
  filters: unknown
  filterSignature: string
  stats: ConnectorRefreshResult["stats"]
  warnings: ConnectorRefreshResult["warnings"]
  retryHints: RetryAdvice | null
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
  rawCaptures: InMemoryRawCaptureRecord[]
  normalizations: InMemoryNormalizationRecord[]
}

export type InMemoryRawCaptureRecord = {
  input: RawSourceRecordInput
  receipt: RawSourceIntakeReceipt
}

export type InMemoryNormalizationRecord = {
  rawRevisionId: string
  resolver: ResolverDeclaration
  outcomes: FieldResolutionOutcome[]
}

export type InMemoryConnectorHostRefreshRequest = {
  connectorInstanceId: string
  workspaceId: string
  mode: ConnectorRefreshMode
  coverage: ConnectorCoverageWindow
  signal?: AbortSignal
}

export type InMemoryConnectorHostValidateAuthRequest = {
  connectorInstanceId: string
  workspaceId: string
}

export type InMemoryConnectorHost = {
  registerInstance: (instance: ConnectorInstanceRecord) => void
  refresh: (
    connector: JobConnector,
    request: InMemoryConnectorHostRefreshRequest,
  ) => Promise<ConnectorRunRecord>
  validateAuth: (
    connector: JobConnector,
    request: InMemoryConnectorHostValidateAuthRequest,
  ) => Promise<ConnectorAuthValidationResult>
  snapshot: () => InMemoryConnectorHostSnapshot
}

export type InMemoryConnectorHostOptions = {
  authSessions?: Record<string, {
    expiresAt?: string
    generation: number
    sessionId: string
  }>
  delay?: (input: ConnectorDelayInput) => number | Promise<number>
  progress?: (
    snapshot: ConnectorProgressSnapshot,
  ) => void | Promise<void>
  secrets?: Record<string, string>
  now?: () => string
  onRawCapture?: (
    input: RawSourceRecordInput,
  ) => void | Promise<void>
}

export function createInMemoryConnectorHost(
  options: InMemoryConnectorHostOptions = {},
): InMemoryConnectorHost {
  const instances = new Map<string, ConnectorInstanceRecord>()
  const runs: ConnectorRunRecord[] = []
  const checkpoints = new Map<string, ConnectorCheckpointRecord>()
  const observations: HostObservationRecord[] = []
  const rawCaptures: InMemoryRawCaptureRecord[] = []
  const normalizations: InMemoryNormalizationRecord[] = []
  const rawRecordIdsByIdentity = new Map<string, string>()
  const rawRevisionsByContent = new Map<string, RawSourceRevisionReceipt>()
  const revisionCountsByRawRecord = new Map<string, number>()
  let runCounter = 0
  let rawRecordCounter = 0
  let rawRevisionCounter = 0
  let rawOccurrenceCounter = 0
  const authRefreshFlights = new Map<
    string,
    Promise<ConnectorAuthEstablishmentResult>
  >()

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
      runCounter += 1
      const connectorRunId = `run_${runCounter}`
      const startedAt = hostTimestamp(options)
      let result: ConnectorRefreshResult
      try {
        result = await connector.refresh(
          {
            connectorInstanceId: request.connectorInstanceId,
            workspaceId: request.workspaceId,
            mode: request.mode,
            executionScopeId: `connector.${request.connectorInstanceId}`,
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
            authRefreshFlights,
            request.signal,
            {
              connector,
              connectorInstanceId: request.connectorInstanceId,
              connectorRunId,
              workspaceId: request.workspaceId,
              normalizations,
              rawCaptures,
              rawRecordIdsByIdentity,
              rawRevisionsByContent,
              revisionCountsByRawRecord,
              nextRawRecordSequence: () => ++rawRecordCounter,
              nextRawRevisionSequence: () => ++rawRevisionCounter,
              nextRawOccurrenceSequence: () => ++rawOccurrenceCounter,
            },
          ),
        )
      } catch (error) {
        runs.push({
          id: connectorRunId,
          startedAt,
          completedAt: hostTimestamp(options, startedAt),
          connectorInstanceId: request.connectorInstanceId,
          workspaceId: request.workspaceId,
          mode: request.mode,
          status: "failed",
          coverage: cloneJsonLike(request.coverage),
          config: runConfig,
          filters: runFilters,
          filterSignature,
          stats: { observations: 0 },
          warnings: [
            {
              code: "connector_refresh_failed",
              message: "Connector refresh failed before returning a result.",
            },
          ],
          retryHints: null,
        })
        throw error
      }

      const run: ConnectorRunRecord = {
        id: connectorRunId,
        startedAt,
        completedAt: hostTimestamp(options, startedAt),
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

    async validateAuth(connector, request) {
      if (typeof connector.validateAuth !== "function") {
        throw new Error(
          `Connector does not support auth validation: ${connector.definition.id}`,
        )
      }

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

      return await connector.validateAuth(
        {
          connectorInstanceId: request.connectorInstanceId,
          executionScopeId: `connector.${request.connectorInstanceId}`,
          workspaceId: request.workspaceId,
        },
        createConnectorRuntime(
          instance.auth ?? [],
          connector.definition.auth?.requirements ?? [],
          options,
          authRefreshFlights,
        ),
      )
    },

    snapshot() {
      return {
        instances: [...instances.values()],
        runs: [...runs],
        checkpoints: [...checkpoints.values()],
        observations: [...observations],
        rawCaptures: cloneJsonLike(rawCaptures),
        normalizations: cloneJsonLike(normalizations),
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
  authRefreshFlights: Map<
    string,
    Promise<ConnectorAuthEstablishmentResult>
  >,
  signal?: AbortSignal,
  rawContext?: {
    connector: JobConnector
    connectorInstanceId: string
    connectorRunId: string
    workspaceId: string
    normalizations: InMemoryNormalizationRecord[]
    rawCaptures: InMemoryRawCaptureRecord[]
    rawRecordIdsByIdentity: Map<string, string>
    rawRevisionsByContent: Map<string, RawSourceRevisionReceipt>
    revisionCountsByRawRecord: Map<string, number>
    nextRawRecordSequence: () => number
    nextRawRevisionSequence: () => number
    nextRawOccurrenceSequence: () => number
  },
): ConnectorRuntime {
  let resolvedSessionGeneration: number | undefined
  const runtime: ConnectorRuntime = {
    auth: {
      async resolve(input) {
        const grant = resolveAuthGrant(
          input,
          authReferences,
          authRequirements,
          options,
        )
        const persistedSession = rawContext
          ? options.authSessions?.[`connector.${rawContext.connectorInstanceId}`]
          : undefined
        if (persistedSession) {
          resolvedSessionGeneration = persistedSession.generation
        }
        return grant.status === "ready" &&
          grant.mode === "username_password" &&
          rawContext
          ? {
              ...grant,
              sessionId:
                persistedSession?.sessionId ??
                `connector.${rawContext.connectorInstanceId}`,
            }
          : grant
      },
      async refresh(input, establish) {
        const existingFlight = authRefreshFlights.get(input.executionScopeId)
        if (existingFlight) return await existingFlight

        const currentSession = options.authSessions?.[input.executionScopeId]
        if (
          currentSession &&
          resolvedSessionGeneration !== undefined &&
          currentSession.generation > resolvedSessionGeneration
        ) {
          return {
            status: "ready",
            sessionId: currentSession.sessionId,
            ...(currentSession.expiresAt === undefined
              ? {}
              : { expiresAt: currentSession.expiresAt }),
          }
        }
        const observedGeneration =
          options.authSessions?.[input.executionScopeId]?.generation ?? 0
        const flight = (async (): Promise<ConnectorAuthEstablishmentResult> => {
          const established = await establish()
          const canonical = options.authSessions?.[input.executionScopeId]
          if (canonical && canonical.generation > observedGeneration) {
            return {
              status: "ready",
              sessionId: canonical.sessionId,
              ...(canonical.expiresAt === undefined
                ? {}
                : { expiresAt: canonical.expiresAt }),
            }
          }
          if (established.status !== "ready") return established
          const persisted = {
            generation: observedGeneration + 1,
            sessionId: established.sessionId,
            ...(established.expiresAt === undefined
              ? {}
              : { expiresAt: established.expiresAt }),
          }
          options.authSessions ??= {}
          options.authSessions[input.executionScopeId] = persisted
          return established
        })()
        authRefreshFlights.set(input.executionScopeId, flight)
        try {
          return await flight
        } finally {
          if (authRefreshFlights.get(input.executionScopeId) === flight) {
            authRefreshFlights.delete(input.executionScopeId)
          }
        }
      },
    },
  }

  if (rawContext) {
    runtime.rawSourceIntake = {
      async capture(input: ConnectorRawSourceCaptureInput) {
        const receivedAt = new Date().toISOString()
        const intakeItemId = `${rawContext.connectorRunId}:item:${rawContext.rawCaptures.length + 1}`
        const boundInput: RawSourceRecordInput = {
          ...cloneJsonLike(input),
          intakeItemId,
          adapter: {
            id: rawContext.connector.definition.id,
            kind: "connector",
            version: rawContext.connector.definition.version,
          },
          capture: {
            connectorInstanceId: rawContext.connectorInstanceId,
            connectorRunId: rawContext.connectorRunId,
            executionScopeId: `connector.${rawContext.connectorInstanceId}`,
          },
        }
        await options.onRawCapture?.(cloneJsonLike(boundInput))
        const identity = rawStrongIdentity(
          rawContext.workspaceId,
          boundInput,
        )
        let rawRecordId = identity
          ? rawContext.rawRecordIdsByIdentity.get(identity)
          : undefined
        if (!rawRecordId) {
          rawRecordId = `raw_${rawContext.nextRawRecordSequence()}`
          if (identity) {
            rawContext.rawRecordIdsByIdentity.set(identity, rawRecordId)
          }
        }
        const contentHash = rawSourceContentHash(boundInput)
        const revisionKey = `${rawRecordId}:${contentHash}`
        const existingRevision = rawContext.rawRevisionsByContent.get(revisionKey)
        const revisionNumber =
          rawContext.revisionCountsByRawRecord.get(rawRecordId) ?? 0
        const revision: RawSourceRevisionReceipt = existingRevision
          ? { ...existingRevision, reused: true }
          : {
              id: `raw_revision_${rawContext.nextRawRevisionSequence()}`,
              rawRecordId,
              revision: revisionNumber + 1,
              contentHash,
              reused: false,
              createdAt: receivedAt,
            }
        if (!existingRevision) {
          rawContext.rawRevisionsByContent.set(revisionKey, revision)
          rawContext.revisionCountsByRawRecord.set(
            rawRecordId,
            revision.revision,
          )
        }
        const occurrenceSequence = rawContext.nextRawOccurrenceSequence()
        const receipt: RawSourceIntakeReceipt = {
          intakeItemId,
          rawRecordId,
          sourceEntityId: null,
          revision,
          occurrence: {
            id: `raw_occurrence_${occurrenceSequence}`,
            rawRecordId,
            rawRevisionId: revision.id,
            capture: boundInput.capture ?? null,
            observedAt: input.observedAt,
            receivedAt,
          },
        }
        rawContext.rawCaptures.push({
          input: cloneJsonLike(boundInput),
          receipt: cloneJsonLike(receipt),
        })
        return cloneJsonLike(receipt)
      },
    }
    runtime.normalization = {
      async run(input) {
        const outcomes = await input.resolve()
        rawContext.normalizations.push({
          rawRevisionId: input.rawRevision.id,
          resolver: cloneJsonLike(input.resolver),
          outcomes: cloneJsonLike(outcomes),
        })
        return cloneJsonLike(outcomes)
      },
    }
  }

  if (signal) {
    runtime.cancellation = { signal }
  }

  if (options.delay) {
    runtime.delay = {
      async wait(input) {
        return await options.delay!(input)
      },
    }
  }

  if (options.progress) {
    runtime.progress = {
      report(snapshot) {
        return options.progress!(cloneJsonLike(snapshot))
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
  return resolveSecretGrant(reference, options)
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

function rawStrongIdentity(
  workspaceId: string,
  input: RawSourceRecordInput,
): string | null {
  const providerRecordId = input.providerRecordId?.trim()
  if (input.adapter.kind !== "connector" || !providerRecordId) return null
  return stableJsonStringify([
    workspaceId,
    input.adapter.id,
    input.providerSchema ?? null,
    providerRecordId,
  ])
}

function rawSourceContentHash(input: RawSourceRecordInput): string {
  const canonicalContent = stableJsonStringify({
    adapter: input.adapter,
    evidence: input.evidence ?? [],
    payload: input.payload ?? null,
    providerRecordId: input.providerRecordId ?? null,
    providerSchema: input.providerSchema ?? null,
    reportedOrigin: input.reportedOrigin ?? null,
  })
  return `sha256:${createHash("sha256").update(canonicalContent).digest("hex")}`
}

function signatureForFilters(filters: unknown): string {
  return `filters:${stableJsonStringify(filters ?? {})}`
}

function hostTimestamp(
  options: InMemoryConnectorHostOptions,
  notBefore?: string,
): string {
  const candidate = options.now?.() ?? new Date().toISOString()
  const candidateEpoch = Date.parse(candidate)
  const notBeforeEpoch = notBefore === undefined ? null : Date.parse(notBefore)
  if (!Number.isFinite(candidateEpoch)) {
    return notBefore ?? new Date().toISOString()
  }
  if (notBeforeEpoch !== null && candidateEpoch < notBeforeEpoch) {
    return notBefore ?? new Date(candidateEpoch).toISOString()
  }
  return new Date(candidateEpoch).toISOString()
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
