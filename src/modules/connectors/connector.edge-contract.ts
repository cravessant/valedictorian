/**
 * Connector edge contract (issue #327).
 *
 * The connector-owned envelopes the desktop edge exchanges for retirement and
 * skip actions, relocated from `src/ipc/connectors.public.ts` without any change
 * to channel names, payloads, or return values. It depends on the sparxie
 * schemas and connector-owned run projection only, so the connectors public
 * surface carries no runtime, IPC, or Electron edge.
 */
import {
  connectorRetirementActiveWorkConflictSchema,
  connectorRetirementResultSchema,
  connectorRunSummarySchema,
  type ConnectorRetirementActiveWorkConflict,
  type ConnectorRetirementResult,
  type ConnectorRunSummary,
} from '@sparxie/sdk'
import { z } from 'zod'
import { publicConnectorRunSummary } from './connector.run-projection'

export interface ConnectorSkipActionResult {
  action: 'skip'
  connectorInstanceId: string
  message: string
  run: ConnectorRunSummary
  status: 'skipped'
}

export type ConnectorRetirementIpcEnvelope =
  | { kind: 'success'; result: ConnectorRetirementResult }
  | { kind: 'conflict'; conflict: ConnectorRetirementActiveWorkConflict }

const connectorRetirementIpcEnvelopeSchema: z.ZodType<ConnectorRetirementIpcEnvelope> =
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('success'),
      result: connectorRetirementResultSchema,
    }).strict(),
    z.object({
      kind: z.literal('conflict'),
      conflict: connectorRetirementActiveWorkConflictSchema,
    }).strict(),
  ])

const connectorSkipActionResultSchema: z.ZodType<ConnectorSkipActionResult> = z.object({
  action: z.literal('skip'),
  connectorInstanceId: z.string(),
  message: z.string(),
  run: connectorRunSummarySchema,
  status: z.literal('skipped'),
}).strict()

export function publicConnectorSkipActionResult(value: unknown): ConnectorSkipActionResult {
  const result = value && typeof value === 'object'
    ? value as Partial<ConnectorSkipActionResult>
    : {}
  return connectorSkipActionResultSchema.parse({
    action: result.action,
    connectorInstanceId: result.connectorInstanceId,
    message: result.message,
    run: publicConnectorRunSummary(result.run),
    status: result.status,
  })
}

export function connectorRetirementIpcSuccess(
  value: unknown,
): ConnectorRetirementIpcEnvelope {
  return connectorRetirementIpcEnvelopeSchema.parse({
    kind: 'success',
    result: connectorRetirementResultSchema.parse(value),
  })
}

export function connectorRetirementIpcConflict(
  error: unknown,
): ConnectorRetirementIpcEnvelope | null {
  const conflict = connectorRetirementActiveWorkConflictSchema.safeParse(
    error && typeof error === 'object' ? {
      code: 'code' in error ? error.code : undefined,
      connectorInstanceId: 'connectorInstanceId' in error
        ? error.connectorInstanceId
        : undefined,
      message: 'message' in error ? error.message : undefined,
      cancellationRequired: 'cancellationRequired' in error
        ? error.cancellationRequired
        : undefined,
      activeRuns: 'activeRuns' in error ? error.activeRuns : undefined,
    } : error,
  )
  return conflict.success
    ? connectorRetirementIpcEnvelopeSchema.parse({ kind: 'conflict', conflict: conflict.data })
    : null
}

export function parseConnectorRetirementIpcEnvelope(
  value: unknown,
): ConnectorRetirementIpcEnvelope {
  return connectorRetirementIpcEnvelopeSchema.parse(value)
}
