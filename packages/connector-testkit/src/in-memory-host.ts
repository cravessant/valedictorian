import type {
  ConnectorAuthEstablishmentResult,
  ConnectorCaptureRevision,
  JobObservation,
} from "@sparxie/valedictorian-connectors-core"
import {
  ConnectorExecutionError,
  connectorRefreshWarning,
  sanitizeConnectorRefreshWarnings,
  sanitizeConnectorRefreshStats,
  sanitizeConnectorAuthValidationResult,
} from "@sparxie/valedictorian-connectors-core"
import { canonicalDateOnlySchema } from "sparxie"
import { cloneJsonLike, stableJsonStringify } from "./stable-json.js"
import {
  sanitizeConnectorRunCoverage,
  sanitizeConnectorRunLifecycle,
  sanitizeRetryHints,
} from "./result-sanitizers.js"
import {
  isSafeCheckpointSchemaVersion,
  projectJobObservation,
} from "./result-validation.js"
import { createConnectorRuntime } from "./connector-runtime.js"
import type {
  ConnectorCheckpointRecord,
  ConnectorInstanceRecord,
  ConnectorRunRecord,
  HostObservationRecord,
  InMemoryCaptureRecord,
  InMemoryConnectorHost,
  InMemoryConnectorHostOptions,
  InMemoryNormalizationRecord,
} from "./host-contract.js"

export function createInMemoryConnectorHost(
  options: InMemoryConnectorHostOptions = {},
): InMemoryConnectorHost {
  const instances = new Map<string, ConnectorInstanceRecord>()
  const runs: ConnectorRunRecord[] = []
  const checkpoints = new Map<string, ConnectorCheckpointRecord>()
  let observations: HostObservationRecord[] = []
  const captures: InMemoryCaptureRecord[] = []
  const normalizations: InMemoryNormalizationRecord[] = []
  const providerFieldResolutions: InMemoryNormalizationRecord[] = []
  const captureIdsByIdentity = new Map<string, string>()
  const captureRevisionsByContent = new Map<string, ConnectorCaptureRevision>()
  const revisionCountsByCapture = new Map<string, number>()
  let runCounter = 0
  let captureRecordCounter = 0
  let captureRevisionCounter = 0
  let captureOccurrenceCounter = 0
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
      let projectedRun: ConnectorRunRecord
      let projectedCheckpoint: ConnectorCheckpointRecord
      let projectedObservations: HostObservationRecord[]
      try {
        const result = await connector.refresh(
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
              captures,
              captureIdsByIdentity,
              captureRevisionsByContent,
              revisionCountsByCapture,
              nextCaptureRecordSequence: () => ++captureRecordCounter,
              nextCaptureRevisionSequence: () => ++captureRevisionCounter,
              nextCaptureOccurrenceSequence: () => ++captureOccurrenceCounter,
            },
          ),
        )
        const lifecycle = sanitizeConnectorRunLifecycle(
          result.status,
          result.synchronization,
        )
        projectedRun = {
          id: connectorRunId,
          startedAt,
          completedAt: hostTimestamp(options, startedAt),
          connectorInstanceId: request.connectorInstanceId,
          workspaceId: request.workspaceId,
          mode: request.mode,
          status: lifecycle.status,
          coverage: sanitizeConnectorRunCoverage(result.coverage),
          config: runConfig,
          filters: runFilters,
          filterSignature,
          stats: sanitizeConnectorRefreshStats(result.stats),
          warnings: sanitizeConnectorRefreshWarnings(result.warnings),
          retryHints: sanitizeRetryHints(result.retryHints),
          synchronization: lifecycle.synchronization,
        }
        const nextCheckpoint = result.nextCheckpoint
        if (!isSafeCheckpointSchemaVersion(nextCheckpoint.schemaVersion)) {
          throw new TypeError("Invalid connector checkpoint schema version")
        }
        projectedCheckpoint = {
          connectorInstanceId: request.connectorInstanceId,
          filterSignature,
          checkpoint: cloneJsonLike(nextCheckpoint.checkpoint),
          schemaVersion: nextCheckpoint.schemaVersion,
        }
        const resultObservations = result.observations
        if (!Array.isArray(resultObservations) ||
          resultObservations.length > 10_000) {
          throw new TypeError("Invalid connector observations")
        }
        projectedObservations = observations.map(cloneJsonLike)
        let projectedObservationCount = 0
        for (const rawObservation of resultObservations) {
          if (projectedObservationCount >= 10_000) {
            throw new TypeError("Invalid connector observations")
          }
          const observation = projectJobObservation(
            cloneJsonLike(rawObservation),
            connector.definition.id,
            connector.definition.version,
          )
          if (!observation) {
            throw new TypeError("Invalid connector observation")
          }
          upsertObservation(
            projectedObservations,
            instances,
            request.workspaceId,
            request.connectorInstanceId,
            observation,
          )
          projectedObservationCount += 1
        }
        projectedRun = {
          ...projectedRun,
          stats: {
            ...projectedRun.stats,
            observations: projectedObservationCount,
          },
        }
      } catch {
        const cancelled = request.signal?.aborted === true
        const failedRun: ConnectorRunRecord = {
          id: connectorRunId,
          startedAt,
          completedAt: hostTimestamp(options, startedAt),
          connectorInstanceId: request.connectorInstanceId,
          workspaceId: request.workspaceId,
          mode: request.mode,
          status: cancelled ? "cancelled" : "failed",
          coverage: sanitizeConnectorRunCoverage(request.coverage),
          config: runConfig,
          filters: runFilters,
          filterSignature,
          stats: { observations: 0 },
          warnings: cancelled
            ? []
            : [connectorRefreshWarning("connector.execution_failed")],
          retryHints: null,
          synchronization: {
            newestFrontier: { state: "advancing" },
            historicalBackfill: {
              state: "advancing",
              boundary: {
                earliestDate: coverageBoundaryDate(request.coverage.start),
              },
            },
            pendingResolutionCount: 0,
            outcome: cancelled
              ? { kind: "cancelled", reason: "cancelled" }
              : {
                  kind: "failed",
                  reason: "connector_execution_failed",
                },
          },
        }
        runs.push(failedRun)
        if (cancelled) return failedRun
        throw new ConnectorExecutionError()
      }

      runs.push(projectedRun)
      checkpoints.set(checkpointKey, projectedCheckpoint)
      observations = projectedObservations
      return projectedRun
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

      try {
        return sanitizeConnectorAuthValidationResult(
          await connector.validateAuth(
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
          ),
        )
      } catch {
        throw new ConnectorExecutionError()
      }
    },

    resolveProviderFields(connector, captureRevisionId) {
      const resolver = connector.providerFieldResolver
      if (!resolver) {
        throw new Error(`Connector does not support provider-field resolution: ${connector.definition.id}`)
      }
      const captureRecord = captures.find((c) => c.receipt.revision.id === captureRevisionId)
      if (!captureRecord) {
        throw new Error(`Unknown capture revision: ${captureRevisionId}`)
      }
      const revision = captureRecord.receipt.revision
      const adapter = captureRecord.input.adapter
      const providerSchema = captureRecord.input.providerSchema
      const payload = captureRecord.input.payload
      const decl = resolver.declaration
      const applicable = adapter.kind === "connector" && adapter.id === connector.definition.id &&
        (!decl.supportedAdapters?.kinds || decl.supportedAdapters.kinds.includes(adapter.kind)) &&
        (!decl.supportedAdapters?.ids || decl.supportedAdapters.ids.includes(adapter.id)) &&
        (!decl.supportedAdapters?.versions || decl.supportedAdapters.versions.includes(adapter.version)) &&
        (!decl.supportedProviderSchemas || (providerSchema !== null && decl.supportedProviderSchemas.includes(providerSchema))) &&
        (!decl.requiredInputs.includes("payload") || payload !== null)
      if (!applicable) {
        throw new Error(`Resolver not applicable to capture revision: ${captureRevisionId}`)
      }
      const clonedInput = {
        captureRevision: cloneJsonLike(revision),
        adapter: cloneJsonLike(adapter),
        providerSchema,
        payload: payload === null ? null : cloneJsonLike(payload),
      }
      const outcomes = cloneJsonLike(resolver.resolve(clonedInput))
      providerFieldResolutions.push({
        captureRevisionId: revision.id,
        resolver: cloneJsonLike(resolver.declaration),
        outcomes: cloneJsonLike(outcomes),
      })
      return outcomes
    },

    snapshot() {
      return {
        instances: [...instances.values()],
        runs: [...runs],
        checkpoints: [...checkpoints.values()],
        observations: [...observations],
        captures: cloneJsonLike(captures),
        normalizations: cloneJsonLike(normalizations),
        providerFieldResolutions: cloneJsonLike(providerFieldResolutions),
      }
    },
  }
}

function coverageBoundaryDate(value: string | null): string {
  const parsed = canonicalDateOnlySchema.safeParse(
    typeof value === "string" ? value.slice(0, 10) : null,
  )
  return parsed.success ? parsed.data : "1970-01-01"
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
