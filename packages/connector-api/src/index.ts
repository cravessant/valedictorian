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
  politeness?: ConnectorPolitenessDefaults
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
  | "browser_session"
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
  sessionKey?: string
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
  sessionKey?: string
  value?: string
  sessionId?: string
  expiresAt?: string
  reason?: string
}

export type ConnectorAuthResolveInput = {
  id: string
  mode?: ConnectorAuthMode
}

export type ConnectorAuthRuntime = {
  resolve(input: ConnectorAuthResolveInput): Promise<ConnectorAuthGrant>
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

export type ConnectorProgressStage =
  | "authenticating"
  | "discovering"
  | "normalizing"
  | "waiting"
  | "finalizing"

export type ConnectorProgressCounts = {
  attempted: number
  discovered: number
  eligible: number
  filtered: number
  remainingTarget: number
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

export type ConnectorBrowserSessionResolveStatus =
  | "resolved"
  | "auth_required"
  | "closed"
  | "hidden"
  | "direct_apply"
  | "rate_limited"
  | "captcha"
  | "unresolved"

export type ConnectorBrowserSessionResolveInput = {
  sessionId: string
  url: string
  source: string
}

export type ConnectorBrowserSessionResolveResult = {
  status: ConnectorBrowserSessionResolveStatus
  officialUrl?: string | null
  method?: string | null
  reason?: string | null
  evidence?: JobObservationEvidence[]
}

export type ConnectorBrowserSessionRuntime = {
  resolveLink(
    input: ConnectorBrowserSessionResolveInput,
  ): Promise<ConnectorBrowserSessionResolveResult>
}

export type ConnectorCapabilityDeclaration = {
  fetchesPublicPages?: boolean
  resolvesIntermediaryLinks?: boolean
  usesBrowserSession?: boolean
  supportsIncrementalRefresh?: boolean
  supportsFiltering?: boolean
}

export type ConnectorCheckpointDeclaration = {
  schemaVersion: string
}

export type ConnectorPolitenessDefaults = {
  concurrency?: number
  minDelayMs?: number
  maxDelayMs?: number
  maxRequestsPerRun?: number
  maxBackfillDays?: number
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
  budget?: unknown
  observations?: JobObservation[]
}

export type ConnectorRuntime = {
  auth: ConnectorAuthRuntime
  browserSession?: ConnectorBrowserSessionRuntime
  cancellation?: ConnectorCancellationRuntime
  delay?: ConnectorDelayRuntime
  progress?: ConnectorProgressRuntime
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
  remainingTarget?: number
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

export type ConnectorRefreshStatus = "completed" | "partial_success"

export type ConnectorRefreshResult = {
  observations: JobObservation[]
  nextCheckpoint: ConnectorCheckpointPayload
  coverage: ConnectorCoverageWindow
  stats: ConnectorRefreshStats
  warnings: ConnectorRefreshWarning[]
  status?: ConnectorRefreshStatus
  retryHints?: unknown
}

export type ConnectorAuthValidationInput = {
  connectorInstanceId: string
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
}
