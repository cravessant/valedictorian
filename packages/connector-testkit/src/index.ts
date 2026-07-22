import { createHash } from "node:crypto"

import type {
  ConnectorAuthGrant,
  ConnectorAuthEstablishmentResult,
  ConnectorAuthReference,
  ConnectorAuthRequirement,
  ConnectorAuthResolveInput,
  ConnectorAuthValidationResult,
  ConnectorCaptureEnvelope,
  ConnectorCaptureInput,
  ConnectorCaptureReceipt,
  ConnectorCaptureRevision,
  ConnectorCoverageWindow,
  ConnectorDelayInput,
  ConnectorDefinition,
  ConnectorProgressSnapshot,
  ConnectorRefreshStatus,
  ConnectorRefreshInput,
  ConnectorRefreshMode,
  ConnectorRefreshResult,
  ConnectorRuntime,
  CreateCaptureInput,
  JobConnector,
  JobObservation,
  FieldResolutionOutcome,
  ResolverDeclaration,
  RetryAdvice,
} from "@sparxie/valedictorian-connectors-core"
import {
  ConnectorExecutionError,
  connectorRefreshWarning,
  jobObservationSchemaVersion,
  sanitizeConnectorRefreshWarnings,
  sanitizeConnectorRefreshStats,
  sanitizeConnectorAuthValidationResult,
} from "@sparxie/valedictorian-connectors-core"
import {
  canonicalDateOnlySchema,
  connectorRunSummarySchema,
  createCaptureInputSchema,
} from "sparxie"
import { cloneJsonLike, stableJsonStringify } from "./stable-json.js"
import {
  sanitizeConnectorRunCoverage,
  sanitizeConnectorRunLifecycle,
  sanitizeRetryHints,
  type ConnectorRunCoverageWindow,
} from "./result-sanitizers.js"
import {
  isSafeCheckpointSchemaVersion,
  projectJobObservation,
} from "./result-validation.js"

export type { ConnectorRunCoverageWindow } from "./result-sanitizers.js"

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
  coverage: ConnectorRunCoverageWindow
  config: unknown
  filters: unknown
  filterSignature: string
  stats: ConnectorRefreshResult["stats"]
  warnings: ConnectorRefreshResult["warnings"]
  retryHints: RetryAdvice | null
  synchronization: ConnectorRefreshResult["synchronization"]
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
  captures: InMemoryCaptureRecord[]
  normalizations: InMemoryNormalizationRecord[]
  providerFieldResolutions: InMemoryNormalizationRecord[]
}

export type InMemoryCaptureRecord = ConnectorCaptureEnvelope & {
  receipt: ConnectorCaptureReceipt
}

export type InMemoryNormalizationRecord = {
  captureRevisionId: string
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
  resolveProviderFields: (
    connector: JobConnector,
    captureRevisionId: string,
  ) => FieldResolutionOutcome[]
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
  onCapture?: (
    envelope: ConnectorCaptureEnvelope,
  ) => void | Promise<void>
}

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

function createConnectorRuntime(
  authReferences: ConnectorAuthReference[],
  authRequirements: ConnectorAuthRequirement[],
  options: InMemoryConnectorHostOptions,
  authRefreshFlights: Map<
    string,
    Promise<ConnectorAuthEstablishmentResult>
  >,
  signal?: AbortSignal,
  captureContext?: {
    connector: JobConnector
    connectorInstanceId: string
    connectorRunId: string
    workspaceId: string
    normalizations: InMemoryNormalizationRecord[]
    captures: InMemoryCaptureRecord[]
    captureIdsByIdentity: Map<string, string>
    captureRevisionsByContent: Map<string, ConnectorCaptureRevision>
    revisionCountsByCapture: Map<string, number>
    nextCaptureRecordSequence: () => number
    nextCaptureRevisionSequence: () => number
    nextCaptureOccurrenceSequence: () => number
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
        const persistedSession = captureContext
          ? options.authSessions?.[`connector.${captureContext.connectorInstanceId}`]
          : undefined
        if (persistedSession) {
          resolvedSessionGeneration = persistedSession.generation
        }
        return grant.status === "ready" &&
          grant.mode === "username_password" &&
          captureContext
          ? {
              ...grant,
              sessionId:
                persistedSession?.sessionId ??
                `connector.${captureContext.connectorInstanceId}`,
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

  if (captureContext) {
    runtime.captureIntake = {
      async capture(input: ConnectorCaptureInput) {
        const receivedAt = new Date().toISOString()
        const captureItemId = `${captureContext.connectorRunId}:item:${captureContext.captures.length + 1}`
        const captureInput: CreateCaptureInput = {
          evidenceMode: input.evidenceMode ?? "reported",
          adapter: {
            id: captureContext.connector.definition.id,
            kind: "connector",
            version: captureContext.connector.definition.version,
          },
          observedAt: input.observedAt,
          providerRecordId: input.providerRecordId ?? null,
          providerSchema: input.providerSchema ?? null,
          payload: cloneJsonLike(input.payload ?? null),
          evidence: cloneJsonLike(input.evidence ?? []),
        }
        // Validate the exact accepted Capture input before any persistence hook
        // or host-state append so an invalid payload fails closed and leaves no
        // persisted capture.
        const acceptedInput = createCaptureInputSchema.parse(captureInput)
        const envelope: ConnectorCaptureEnvelope = {
          input: acceptedInput,
          provenance: {
            connectorInstanceId: captureContext.connectorInstanceId,
            connectorRunId: captureContext.connectorRunId,
            executionScopeId: `connector.${captureContext.connectorInstanceId}`,
            reportedOrigin: cloneJsonLike(input.reportedOrigin ?? null),
          },
          captureItemId,
        }
        await options.onCapture?.(cloneJsonLike(envelope))
        const identity = captureStrongIdentity(
          captureContext.workspaceId,
          envelope,
        )
        let captureId = identity
          ? captureContext.captureIdsByIdentity.get(identity)
          : undefined
        if (!captureId) {
          captureId = `capture_${captureContext.nextCaptureRecordSequence()}`
          if (identity) {
            captureContext.captureIdsByIdentity.set(identity, captureId)
          }
        }
        const contentHash = captureContentHash(envelope)
        const revisionKey = `${captureId}:${contentHash}`
        const existingRevision =
          captureContext.captureRevisionsByContent.get(revisionKey)
        const revisionNumber =
          captureContext.revisionCountsByCapture.get(captureId) ?? 0
        const revision: ConnectorCaptureRevision = existingRevision
          ? { ...existingRevision, reused: true }
          : {
              id: `capture_revision_${captureContext.nextCaptureRevisionSequence()}`,
              captureId,
              revision: revisionNumber + 1,
              contentHash,
              reused: false,
              createdAt: receivedAt,
            }
        if (!existingRevision) {
          captureContext.captureRevisionsByContent.set(revisionKey, revision)
          captureContext.revisionCountsByCapture.set(
            captureId,
            revision.revision,
          )
        }
        const occurrenceSequence = captureContext.nextCaptureOccurrenceSequence()
        const receipt: ConnectorCaptureReceipt = {
          captureItemId,
          captureId,
          sourceEntityId: null,
          revision,
          occurrence: {
            id: `capture_occurrence_${occurrenceSequence}`,
            captureId,
            captureRevisionId: revision.id,
            capture: {
              connectorInstanceId: envelope.provenance.connectorInstanceId,
              connectorRunId: envelope.provenance.connectorRunId,
              executionScopeId: envelope.provenance.executionScopeId,
            },
            observedAt: input.observedAt,
            receivedAt,
          },
        }
        captureContext.captures.push({
          ...cloneJsonLike(envelope),
          receipt: cloneJsonLike(receipt),
        })
        return cloneJsonLike(receipt)
      },
    }
    runtime.normalization = {
      async run(input) {
        const outcomes = await input.resolve()
        captureContext.normalizations.push({
          captureRevisionId: input.captureRevision.id,
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

function captureStrongIdentity(
  workspaceId: string,
  envelope: ConnectorCaptureEnvelope,
): string | null {
  const providerRecordId = envelope.input.providerRecordId?.trim()
  if (envelope.input.adapter.kind !== "connector" || !providerRecordId) {
    return null
  }
  return stableJsonStringify([
    workspaceId,
    envelope.input.adapter.id,
    envelope.input.providerSchema ?? null,
    providerRecordId,
  ])
}

function captureContentHash(envelope: ConnectorCaptureEnvelope): string {
  const canonicalContent = stableJsonStringify({
    adapter: envelope.input.adapter,
    evidence: envelope.input.evidence ?? [],
    payload: envelope.input.payload ?? null,
    providerRecordId: envelope.input.providerRecordId ?? null,
    providerSchema: envelope.input.providerSchema ?? null,
    reportedOrigin: envelope.provenance.reportedOrigin ?? null,
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
