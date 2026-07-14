import {
  retryAdviceSchema,
  type FieldResolutionOutcome,
  type ConnectorHistoricalBackfillState,
  type ConnectorNewestFrontierState,
  type ConnectorSynchronizationOutcome,
  type RawSourceIntakeReceipt,
  type RawSourceRecordInput,
  type RawSourceRevisionReceipt,
  type ResolverDeclaration,
  type RetryAdvice,
  type SourceExecutionScopeId,
  type SourceOperationOutcome,
  type TransientRetryReason,
} from "sparxie"
import type {
  ConnectorDynamicOptionsDeclaration,
  ConnectorOptionValue,
} from "./dynamic-options.js"

export {
  parseConnectorDynamicOptionsDeclaration,
  parseConnectorOptionValue,
  type ConnectorDynamicOptionSource,
  type ConnectorDynamicOptionsDeclaration,
  type ConnectorOptionObjectSchema,
  type ConnectorOptionScalar,
  type ConnectorOptionScalarSchema,
  type ConnectorOptionValue,
  type ConnectorOptionValueSchema,
} from "./dynamic-options.js"

export type {
  CanonicalCompensation,
  CanonicalEmploymentType,
  CanonicalLocation,
  CanonicalPostedAt,
  FieldResolutionOutcome,
  JsonObject,
  JsonValue,
  RawSourceEvidenceInput,
  RawSourceIntakeReceipt,
  RawSourceRecordInput,
  RawSourceRevisionReceipt,
  ResolutionEvidence,
  ResolverDeclaration,
  RetryAdvice,
  SourceExecutionScopeId,
  SourceOperationOutcome,
  SourcingDestinationClass,
  TransientRetryReason,
  ConnectorHistoricalBackfillState,
  ConnectorNewestFrontierState,
  ConnectorSynchronizationOutcome,
} from "sparxie"
export { retryAdviceSchema, sourceExecutionScopeIdSchema } from "sparxie"

export type RetryPolicyInput = {
  attempt: number
  baseDelayMs: number
  horizonAt: string
  maxAttempts: number
  maxDelayMs: number
  reason: TransientRetryReason
  serverMinimumDelayMs?: number | null
}

export type RetryPolicyDependencies = {
  nowEpochMs(): number
  random(): number
}

const maxEcmascriptDateEpochMs = 8_640_000_000_000_000

function isPositiveSafeMillisecond(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= maxEcmascriptDateEpochMs
  )
}

export function scheduleRetry(
  input: RetryPolicyInput,
  dependencies: RetryPolicyDependencies,
): RetryAdvice {
  const nowEpochMs = dependencies.nowEpochMs()
  if (!isPositiveSafeMillisecond(nowEpochMs)) {
    throw new RangeError("nowEpochMs must be a positive safe millisecond value")
  }
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
    throw new RangeError("attempt must be a positive safe integer")
  }
  if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive safe integer")
  }
  if (!isPositiveSafeMillisecond(input.baseDelayMs)) {
    throw new RangeError("baseDelayMs must be a positive safe millisecond value")
  }
  if (!isPositiveSafeMillisecond(input.maxDelayMs)) {
    throw new RangeError("maxDelayMs must be a positive safe millisecond value")
  }
  if (
    input.serverMinimumDelayMs !== undefined &&
    input.serverMinimumDelayMs !== null &&
    (!Number.isSafeInteger(input.serverMinimumDelayMs) ||
      input.serverMinimumDelayMs < 1)
  ) {
    throw new RangeError(
      "serverMinimumDelayMs must be a positive safe integer",
    )
  }
  const horizonEpochMs = Date.parse(input.horizonAt)
  if (!Number.isFinite(horizonEpochMs)) {
    throw new RangeError("horizonAt must be a finite timestamp")
  }
  const timing = {
    reason: input.reason,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    lastAttemptAt: new Date(Math.min(nowEpochMs, horizonEpochMs)).toISOString(),
    horizonAt: new Date(horizonEpochMs).toISOString(),
  }
  const sanitizedServerMinimum =
    input.serverMinimumDelayMs !== undefined &&
    input.serverMinimumDelayMs !== null
      ? { serverMinimumDelayMs: input.serverMinimumDelayMs }
      : {}
  if (input.attempt >= input.maxAttempts || nowEpochMs >= horizonEpochMs) {
    return retryAdviceSchema.parse({
      ...timing,
      state: "exhausted",
      computedDelayMs: input.serverMinimumDelayMs ?? null,
      nextAttemptAt: null,
      ...sanitizedServerMinimum,
    })
  }
  const remainingHorizonMs = horizonEpochMs - nowEpochMs
  if (
    input.serverMinimumDelayMs !== undefined &&
    input.serverMinimumDelayMs !== null &&
    input.serverMinimumDelayMs > remainingHorizonMs
  ) {
    return retryAdviceSchema.parse({
      ...timing,
      state: "exhausted",
      computedDelayMs: input.serverMinimumDelayMs,
      nextAttemptAt: null,
      ...sanitizedServerMinimum,
    })
  }
  const cap = Math.min(
    input.maxDelayMs,
    input.baseDelayMs * 2 ** (input.attempt - 1),
  )
  const random = dependencies.random()
  if (!Number.isFinite(random) || random < 0 || random >= 1) {
    throw new RangeError("random must be in [0, 1)")
  }
  const serverMinimumDelayMs = input.serverMinimumDelayMs
  const computedDelayMs =
    serverMinimumDelayMs !== undefined &&
    serverMinimumDelayMs !== null &&
    serverMinimumDelayMs > 0
      ? serverMinimumDelayMs +
        Math.floor(
          random *
            Math.max(1, Math.min(1_000, Math.floor(serverMinimumDelayMs * 0.05))),
        ) +
        1
      : Math.max(1, Math.floor(random * cap))

  if (computedDelayMs > remainingHorizonMs) {
    return retryAdviceSchema.parse({
      ...timing,
      state: "exhausted",
      computedDelayMs,
      nextAttemptAt: null,
      ...sanitizedServerMinimum,
    })
  }

  return retryAdviceSchema.parse({
    ...timing,
    state: "scheduled",
    computedDelayMs,
    ...sanitizedServerMinimum,
    nextAttemptAt: new Date(nowEpochMs + computedDelayMs).toISOString(),
  })
}

export type ConnectorDefinition = {
  id: string
  version: string
  displayName?: string
  configSchema?: ConnectorSchemaDeclaration
  filterSchema?: ConnectorSchemaDeclaration
  observation?: ConnectorObservationDeclaration
  auth?: ConnectorAuthDeclaration
  capabilities?: ConnectorCapabilityDeclaration
  checkpoint?: ConnectorCheckpointDeclaration
  dynamicOptions?: ConnectorDynamicOptionsDeclaration
}

export const jobObservationSchemaVersion = "job-observation@1"

export type ConnectorSchemaDeclaration = {
  version: string
  schema: Record<string, unknown>
}

export type ConnectorObservationDeclaration = {
  schemaVersion: string
}

export type ConnectorAuthMode =
  | "none"
  | "api_key"
  | "bearer_token"
  | "oauth"
  | "cookie_jar"
  | "username_password"

export type ConnectorAuthDeclaration = {
  modes: ConnectorAuthMode[]
  requirements?: ConnectorAuthRequirement[]
}

export type ConnectorAuthRequirement = {
  id: string
  mode: ConnectorAuthMode
  label?: string
  required?: boolean
}

export type ConnectorAuthReference = {
  id: string
  mode: ConnectorAuthMode
  label?: string
  secretKey?: string
}

export type ConnectorAuthGrantStatus =
  | "ready"
  | "missing"
  | "expired"
  | "action_required"

export type ConnectorAuthGrant = {
  id: string
  mode: ConnectorAuthMode
  status: ConnectorAuthGrantStatus
  secretKey?: string
  value?: string
  sessionId?: string
  expiresAt?: string
  reason?: string
}

export type ConnectorAuthResolveInput = {
  id: string
  mode?: ConnectorAuthMode
}

export type ConnectorAuthEstablishmentResult =
  | {
      status: "ready"
      sessionId: string
      expiresAt?: string
    }
  | {
      status: "action_required"
      reason: string
    }
  | {
      status: "rate_limited"
      reason: string
      serverMinimumDelayMs?: number
    }
  | {
      status: "retryable"
      reason: string
      retryReason: Exclude<TransientRetryReason, "rate_limit">
      serverMinimumDelayMs?: number
    }
  | {
      status: "failed"
      reason: string
      parserChanged?: boolean
    }
  | {
      status: "cancelled"
      reason: "cancelled"
    }
  | {
      status: "invocation_timeout"
      reason: "runtime_limit"
    }

export type ConnectorAuthEstablish =
  () => Promise<ConnectorAuthEstablishmentResult>

export type ConnectorAuthRuntime = {
  resolve(input: ConnectorAuthResolveInput): Promise<ConnectorAuthGrant>
  refresh(
    input: ConnectorAuthResolveInput & {
      executionScopeId: SourceExecutionScopeId
    },
    establish: ConnectorAuthEstablish,
  ): Promise<ConnectorAuthEstablishmentResult>
}

export type ConnectorDelayInput = {
  minDelayMs: number
  maxDelayMs: number
  reason?: string
}

export type ConnectorDelayRuntime = {
  wait(input: ConnectorDelayInput): Promise<number>
}

export type ConnectorCancellationRuntime = {
  /**
   * Aborts when the host requests that the current connector operation stop.
   * Connectors should preserve completed work in their returned checkpoint.
   */
  readonly signal: AbortSignal
}

export type ConnectorOption = {
  key: string
  label: string
  value: ConnectorOptionValue
}

export type ConnectorOptionQueryInput = {
  connectorInstanceId: string
  workspaceId: string
  executionScopeId: SourceExecutionScopeId
  connectorVersion: string
  filterSchemaVersion: string
  catalogVersion: string
  sourceVersion: string
  sourceId: string
  dependencies: Readonly<
    Record<string, ConnectorOptionValue | readonly ConnectorOptionValue[]>
  >
  operation:
    | { kind: "search"; search: string; limit?: number }
    | { kind: "resolve"; values: readonly ConnectorOptionValue[] }
}

export type ConnectorOptionQueryResult =
  | {
      status: "search_ready"
      options: readonly ConnectorOption[]
      truncated: boolean
    }
  | { status: "search_empty" }
  | {
      status: "resolve_ready"
      options: readonly ConnectorOption[]
      unknownValues: readonly ConnectorOptionValue[]
    }
  | { status: "auth_required"; requirementIds: readonly string[] }
  | {
      status: "error"
      code: string
      retryable: boolean
      retryAfterMs?: number
    }
  | { status: "cancelled" }

export type ConnectorOptionRuntime = {
  auth: ConnectorAuthRuntime
  cancellation?: ConnectorCancellationRuntime
}

export type ConnectorProgressStage =
  | "authenticating"
  | "discovering"
  | "normalizing"
  | "waiting"
  | "finalizing"

export type ConnectorProgressCounts = {
  attempted: number
  discovered: number
  providerReturned?: number
  providerValid?: number
  providerInvalid?: number
  sourceDuplicates?: number
  pendingResolution?: number
  /** @deprecated Connector-owned fit filtering is not a sourcing decision. */
  eligible?: number
  /** @deprecated Connector-owned fit filtering is not a sourcing decision. */
  filtered?: number
  resolvedEmployerOrAts: number
  resolvedThirdParty: number
  skipped: number
  unresolved: number
}

export type ConnectorProgressWait = {
  maxDelayMs: number
  minDelayMs: number
  reason: string
}

export type ConnectorProgressSnapshot = {
  counts: ConnectorProgressCounts
  stage: ConnectorProgressStage
  wait?: ConnectorProgressWait
}

export type ConnectorProgressRuntime = {
  /**
   * Receives ordered, best-effort observability snapshots. Connectors must await
   * async reporters only to a documented finite settlement deadline, isolate
   * reporter failures, consume late rejections, and still return their refresh
   * result and checkpoint instead of treating this port as a commit handshake.
   */
  report(snapshot: ConnectorProgressSnapshot): void | Promise<void>
}

export type ConnectorRawSourceCaptureInput = Pick<
  RawSourceRecordInput,
  | "evidence"
  | "observedAt"
  | "payload"
  | "providerRecordId"
  | "providerSchema"
  | "reportedOrigin"
>

export type ConnectorRawSourceIntakeRuntime = {
  /**
   * Persists a provider record with host-bound connector instance/run lineage.
   * Connectors must acknowledge every safely representable row in a bounded
   * provider batch before invoking normalization or detail resolution for any
   * row in that batch.
   */
  capture(input: ConnectorRawSourceCaptureInput): Promise<RawSourceIntakeReceipt>
}

export type ConnectorNormalizationInput = {
  rawRevision: RawSourceRevisionReceipt
  resolver: ResolverDeclaration
  resolve(): Promise<FieldResolutionOutcome[]>
}

export type ConnectorNormalizationRuntime = {
  /** Executes a connector resolver under the host's trusted normalization seam. */
  run(input: ConnectorNormalizationInput): Promise<FieldResolutionOutcome[]>
}

export type ConnectorCapabilityDeclaration = {
  fetchesPublicPages?: boolean
  resolvesIntermediaryLinks?: boolean
  supportsIncrementalRefresh?: boolean
  supportsFiltering?: boolean
}

export type ConnectorCheckpointDeclaration = {
  schemaVersion: string
}

export type ConnectorCoverageWindow = {
  start: string
  end: string
}

export type ConnectorRefreshMode = "manual" | "scheduled" | "catch_up"

export type ConnectorRefreshInput = {
  connectorInstanceId: string
  workspaceId: string
  mode: ConnectorRefreshMode
  coverage: ConnectorCoverageWindow
  checkpoint?: unknown
  config?: unknown
  filters?: unknown
  observations?: JobObservation[]
  executionScopeId: SourceExecutionScopeId
}

export type ConnectorRuntime = {
  auth: ConnectorAuthRuntime
  cancellation?: ConnectorCancellationRuntime
  delay?: ConnectorDelayRuntime
  progress?: ConnectorProgressRuntime
  rawSourceIntake?: ConnectorRawSourceIntakeRuntime
  normalization?: ConnectorNormalizationRuntime
}

export type JobObservationLinks = {
  source: string | null
  intermediary: string | null
  official: string | null
}

export type JobObservationResolutionStatus =
  | "resolved"
  | "auth_required"
  | "closed"
  | "hidden"
  | "direct_apply"
  | "rate_limited"
  | "captcha"
  | "unresolved"
  | "not_supported"

export type JobObservationResolution = {
  status: JobObservationResolutionStatus
  method: string | null
  reason: string | null
}

export type JobObservationEvidence = {
  type: string
  capturedAt: string
  sourceUrl: string | null
}

export type JobObservation = {
  connectorId: string
  connectorVersion: string
  parserVersion: string
  observationSchemaVersion: string
  sourceRecordKey: string
  observedAt: string
  companyName: string
  roleTitle: string
  locationRaw?: string | null
  descriptionText?: string | null
  pay?: unknown
  links: JobObservationLinks
  resolution: JobObservationResolution
  dedupeKeys: string[]
  sourceMetadata?: Record<string, unknown>
  evidence: JobObservationEvidence[]
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
  stopReason?: string
  totalAvailable?: number
  unresolved?: number
}

export type ConnectorRefreshWarning = {
  code: string
  message: string
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

export type ConnectorAuthValidationInput = {
  connectorInstanceId: string
  executionScopeId: SourceExecutionScopeId
  workspaceId: string
}

export type ConnectorAuthValidationStatus =
  | "ready"
  | "missing"
  | "expired"
  | "action_required"
  | "rate_limited"
  | "retryable"
  | "failed"
  | "cancelled"
  | "invocation_timeout"

export type ConnectorAuthValidationResult = {
  status: ConnectorAuthValidationStatus
  reason?: string
}

export type JobConnector = {
  definition: ConnectorDefinition
  refresh(
    input: ConnectorRefreshInput,
    runtime: ConnectorRuntime,
  ): Promise<ConnectorRefreshResult>
  validateAuth?(
    input: ConnectorAuthValidationInput,
    runtime: ConnectorRuntime,
  ): Promise<ConnectorAuthValidationResult>
  queryOptions?(
    input: ConnectorOptionQueryInput,
    runtime: ConnectorOptionRuntime,
  ): Promise<ConnectorOptionQueryResult>
}
