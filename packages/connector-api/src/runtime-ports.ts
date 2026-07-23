import type {
  FieldResolutionOutcome,
  SourceExecutionScopeId,
  TransientRetryReason,
} from "@sparxie/sdk"
import type { ResolverDeclaration } from "./normalization-types.js"
import type {
  ConnectorCaptureIntakeRuntime,
  ConnectorCaptureRevision,
} from "./capture.js"

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

export type ConnectorNormalizationInput = {
  captureRevision: ConnectorCaptureRevision
  resolver: ResolverDeclaration
  resolve(): Promise<FieldResolutionOutcome[]>
}

export type ConnectorNormalizationRuntime = {
  /** Executes a connector resolver under the host's trusted normalization seam. */
  run(input: ConnectorNormalizationInput): Promise<FieldResolutionOutcome[]>
}

export type ConnectorOptionRuntime = {
  auth: ConnectorAuthRuntime
  cancellation?: ConnectorCancellationRuntime
}

export type ConnectorProviderUrlResolverRuntime = {
  auth: ConnectorAuthRuntime
  cancellation?: ConnectorCancellationRuntime
}

export type ConnectorRuntime = {
  auth: ConnectorAuthRuntime
  cancellation?: ConnectorCancellationRuntime
  delay?: ConnectorDelayRuntime
  progress?: ConnectorProgressRuntime
  captureIntake?: ConnectorCaptureIntakeRuntime
  normalization?: ConnectorNormalizationRuntime
}
