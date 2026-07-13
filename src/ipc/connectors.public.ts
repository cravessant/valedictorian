import {
  connectorRunSummarySchema,
  type ConnectorRunSummary,
} from 'sparxie'
import { z } from 'zod'
import { publicConnectorRunSummary } from '../runtime/local-connector-public-run'

export interface ConnectorSkipActionResult {
  action: 'skip'
  connectorInstanceId: string
  message: string
  run: ConnectorRunSummary
  status: 'skipped'
}

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
