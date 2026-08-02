import type { SourceExecutionScopeId } from '@sparxie/sdk'
import type {
  ConnectorAuthEstablish,
  ConnectorAuthEstablishmentResult,
} from '@sparxie/valedictorian-connectors-core'

export interface ConnectorSourceExecutionScope {
  readonly authGeneration: number
  readonly status: string
  readonly actionReason?: string | null
}

export interface ConnectorSourceExecutionSessionState {
  readonly authGeneration: number
}

export interface ConnectorSourceReconnectLease {
  readonly token: string
}

export interface ConnectorSourceExecutionGovernor {
  getScope(scopeId: SourceExecutionScopeId): Promise<ConnectorSourceExecutionScope>
  loadActiveSession(
    scopeId: SourceExecutionScopeId,
  ): Promise<ConnectorSourceExecutionSessionState | null>
  acquireReconnectLease(
    scopeId: SourceExecutionScopeId,
    input: { leaseMs: number; now: string },
  ): Promise<ConnectorSourceReconnectLease | null>
  finishReconnectValidation(
    scopeId: SourceExecutionScopeId,
    input: { now: string; reason: string; status: 'action_required' | 'available'; token: string },
  ): Promise<unknown>
  blockScope(
    scopeId: SourceExecutionScopeId,
    input: { now: string; retryAfter?: string | null },
  ): Promise<unknown>
  cooldownRefresh(
    scopeId: SourceExecutionScopeId,
    input: { now: string; random?: () => number; token: string },
  ): Promise<unknown>
}

export interface ConnectorSourceSession {
  resolve(scopeId: SourceExecutionScopeId): Promise<ConnectorAuthEstablishmentResult>
  refresh(
    scopeId: SourceExecutionScopeId,
    establish: ConnectorAuthEstablish,
    input?: { allowActionRequired?: boolean },
  ): Promise<ConnectorAuthEstablishmentResult>
  reconnect(
    scopeId: SourceExecutionScopeId,
    establish: ConnectorAuthEstablish,
    token: string,
  ): Promise<ConnectorAuthEstablishmentResult>
}
