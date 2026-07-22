import type {
  CreateCaptureInput,
  FieldResolutionOutcome,
  ConnectorVersionedRendererSchema,
  SourceExecutionScopeId,
  TransientRetryReason,
} from "sparxie"
import type { JsonValue } from "./json.js"
import type { ResolverDeclaration } from "./normalization-types.js"
import type { ConnectorCaptureRevision } from "./capture.js"
import type {
  ConnectorDynamicOptionsDeclaration,
  ConnectorOptionValue,
} from "./dynamic-options.js"
import type {
  ConnectorAuthOutcomeReason,
  ConnectorAuthValidationStatus,
  ConnectorProviderUrlResolverReason,
} from "./connector-outcomes.js"
import type {
  ConnectorAuthDeclaration,
  ConnectorOptionRuntime,
  ConnectorProviderUrlResolverRuntime,
  ConnectorRuntime,
} from "./runtime-ports.js"
import type { JobObservation } from "./observation.js"
import type {
  ConnectorCoverageWindow,
  ConnectorRefreshResult,
} from "./refresh-result.js"

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

export type ConnectorSchemaDeclaration = ConnectorVersionedRendererSchema

export type ConnectorObservationDeclaration = {
  schemaVersion: string
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

/**
 * Captured provider identity supplied to a provider URL resolver.
 *
 * The identity is deliberately narrower than a raw provider record.  A
 * resolver may retrieve provider evidence for this identity, but it cannot
 * receive or persist connector-owned retry/scheduling state.
 */
export type ConnectorProviderUrlResolverInput = {
  providerRecordId: string
  connectorInstanceId: string
  workspaceId: string
  executionScopeId: SourceExecutionScopeId
}

export type ConnectorProviderUrlResolverEvidence = {
  kind: string
  value?: JsonValue
}

export type ConnectorProviderUrlResolverResult =
  | {
      status: "resolved"
      url: string
      method: string
      evidence?: readonly ConnectorProviderUrlResolverEvidence[]
    }
  | {
      status: "interrupted"
      reason: "cancelled" | "runtime_limit"
    }
  | {
      status: "retryable"
      reason: ConnectorProviderUrlResolverReason
      retryReason: TransientRetryReason
      serverMinimumDelayMs?: number
    }
  | {
      status: "terminal"
      reason: ConnectorProviderUrlResolverReason
      action?: "authenticate"
      parserChanged?: boolean
      evidence?: readonly ConnectorProviderUrlResolverEvidence[]
    }

export type ConnectorProviderUrlResolver = {
  id: string
  version: string
  resolve(
    input: ConnectorProviderUrlResolverInput,
    runtime: ConnectorProviderUrlResolverRuntime,
  ): Promise<ConnectorProviderUrlResolverResult>
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

export type ConnectorAuthValidationInput = {
  connectorInstanceId: string
  executionScopeId: SourceExecutionScopeId
  workspaceId: string
}

export type ConnectorAuthValidationResult = {
  status: ConnectorAuthValidationStatus
  reason: ConnectorAuthOutcomeReason
}

export type ConnectorProviderFieldResolverInput = {
  captureRevision: ConnectorCaptureRevision
  adapter: CreateCaptureInput["adapter"]
  providerSchema: CreateCaptureInput["providerSchema"]
  payload: CreateCaptureInput["payload"]
}

export type ConnectorProviderFieldResolver = {
  declaration: ResolverDeclaration
  resolve(
    input: ConnectorProviderFieldResolverInput,
  ): FieldResolutionOutcome[]
}

export type JobConnector = {
  definition: ConnectorDefinition
  providerUrlResolver?: ConnectorProviderUrlResolver
  providerFieldResolver?: ConnectorProviderFieldResolver
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
