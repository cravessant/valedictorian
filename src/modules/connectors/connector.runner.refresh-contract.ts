import type { ConnectorRefreshResult } from '@sparxie/valedictorian-connectors-core'
import { z } from 'zod'
import {
  connectorRunSummarySchema,
  retryAdviceSchema,
  sourceOperationOutcomeSchema,
  type SourceExecutionScopeId,
} from 'sparxie'

type ConnectorRunTerminalStatus = 'cancelled' | 'completed' | 'failed' | 'skipped'

const connectorRefreshEnvelopeSchema = z.object({
  observations: z.array(z.unknown()),
  nextCheckpoint: z.object({
    checkpoint: z.unknown(),
    schemaVersion: z.string().min(1).max(128),
  }).strict(),
  coverage: z.object({
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
  }).strict(),
  stats: z.object({ observations: z.number().int().nonnegative() }).passthrough(),
  warnings: z.array(z.object({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(2048),
  }).strict()),
  status: z.enum(['completed', 'failed', 'cancelled', 'skipped']),
  retryHints: z.unknown().optional(),
  operationOutcome: z.unknown(),
  synchronization: z.unknown(),
}).strict()

export function assertConnectorRefreshResult(
  value: unknown,
  executionScopeId: SourceExecutionScopeId,
): asserts value is ConnectorRefreshResult {
  if (!isRecord(value)) throw new Error('Invalid connector refresh result')
  const status = connectorRefreshStatus(value.status)
  if (!('synchronization' in value)) throw new Error('Invalid connector refresh synchronization')
  if (!connectorRefreshEnvelopeSchema.safeParse(value).success) {
    throw new Error('Invalid connector refresh result')
  }
  if (value.retryHints !== undefined
    && value.retryHints !== null
    && !retryAdviceSchema.safeParse(value.retryHints).success) {
    throw new Error('Invalid connector refresh retry advice')
  }
  if (value.operationOutcome !== null
    && !sourceOperationOutcomeSchema.safeParse(value.operationOutcome).success) {
    throw new Error('Invalid connector refresh operation outcome')
  }
  if (isRecord(value.operationOutcome)
    && (value.operationOutcome.kind === 'authentication_expired'
      || value.operationOutcome.kind === 'scope_rate_limited')
    && value.operationOutcome.executionScopeId !== executionScopeId) {
    throw new Error('Invalid connector refresh operation outcome scope')
  }
  assertSynchronization(value.synchronization, status, executionScopeId)
  assertOperationConsistency(
    value.operationOutcome,
    value.synchronization as ConnectorRefreshResult['synchronization'],
  )
}

function connectorRefreshStatus(value: unknown): ConnectorRunTerminalStatus {
  if (value === 'cancelled' || value === 'completed' || value === 'failed' || value === 'skipped') {
    return value
  }
  throw new Error(`Invalid connector refresh status: ${String(value)}`)
}

function assertSynchronization(
  value: unknown,
  status: ConnectorRunTerminalStatus,
  executionScopeId: SourceExecutionScopeId,
) {
  const result = connectorRunSummarySchema.safeParse({
    id: 'connector-refresh-validation',
    connectorInstanceId: 'connector-refresh-validation',
    executionScopeId,
    status,
    filterSignature: 'connector-refresh-validation',
    observationCount: 0,
    warningCount: 0,
    warnings: [],
    newestFrontier: isRecord(value) ? value.newestFrontier : undefined,
    historicalBackfill: isRecord(value) ? value.historicalBackfill : undefined,
    pendingResolutionCount: isRecord(value) ? value.pendingResolutionCount : undefined,
    outcome: isRecord(value) ? value.outcome : undefined,
    startedAt: '2000-01-01T00:00:00.000Z',
    completedAt: '2000-01-01T00:00:00.000Z',
    mode: 'manual',
    scheduleOccurrence: null,
  })
  if (!isRecord(value) || !result.success) {
    throw new Error('Invalid connector refresh synchronization')
  }
}

function assertOperationConsistency(
  operationOutcome: unknown,
  synchronization: ConnectorRefreshResult['synchronization'],
) {
  const synchronizationOutcome = synchronization.outcome
  const requiredKind = isRecord(operationOutcome)
    ? operationOutcome.kind === 'scope_rate_limited'
      ? 'cooling_down'
      : operationOutcome.kind === 'authentication_expired'
        ? 'action_required'
        : null
    : null
  const synchronizationRequiresOperation = synchronizationOutcome.kind === 'cooling_down'
    || synchronizationOutcome.kind === 'action_required'
  if (requiredKind !== null
    && (synchronizationOutcome.kind !== requiredKind
      || !sameScopeOperation(operationOutcome, synchronizationOutcome.operation))) {
    throw new Error('Inconsistent connector refresh operation outcome')
  }
  if (synchronizationRequiresOperation
    && !sameScopeOperation(operationOutcome, synchronizationOutcome.operation)) {
    throw new Error('Inconsistent connector refresh operation outcome')
  }
}

function sameScopeOperation(left: unknown, right: unknown) {
  if (!isRecord(left) || !isRecord(right) || left.kind !== right.kind) return false
  if (left.kind === 'authentication_expired') {
    return left.executionScopeId === right.executionScopeId
      && left.requestRefresh === right.requestRefresh
  }
  if (left.kind === 'scope_rate_limited') {
    return left.executionScopeId === right.executionScopeId
      && left.retryAt === right.retryAt
      && left.serverMinimumDelayMs === right.serverMinimumDelayMs
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
