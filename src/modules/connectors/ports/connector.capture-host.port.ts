import type {
  ConnectorCaptureInput,
  ConnectorCaptureReceipt,
} from '@sparxie/valedictorian-connectors-core'

export interface ConnectorCaptureHostInput {
  readonly adapter: { readonly id: string; readonly version: string }
  readonly connectorInstanceId: string
  readonly connectorRunId: string
  readonly executionScopeId: string
  readonly input: ConnectorCaptureInput
}

export interface AppConnectorCaptureHost {
  capture(input: ConnectorCaptureHostInput): Promise<ConnectorCaptureReceipt>
}

/**
 * #325: independent post-acknowledgement provider-field work enqueue port. Called only after a
 * durable Capture accept succeeds; a failure here must never undo the acknowledgement or make the
 * connector wait for resolver execution (startup reconciliation closes any post-ack gap).
 */
export interface ProviderFieldWorkEnqueueInput {
  readonly captureId: string
  readonly captureRevision: number
  readonly contentHash: string
  readonly adapterId: string
  readonly providerSchema: string | null
}

export interface DestinationWorkEnqueueInput {
  readonly captureId: string
}
