import type {
  ConnectorCaptureInput,
  ConnectorCaptureReceipt,
} from '@sparxie/valedictorian-connectors-core'
import { createCaptureInputSchema } from 'sparxie'
import type { CaptureService, JsonValue } from '../capture/capture.service'

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

export function createConnectorCaptureHost({
  captureService,
  workspaceId,
}: {
  captureService: CaptureService
  now?: () => Date
  workspaceId: string
}): AppConnectorCaptureHost {
  return {
    async capture({ adapter, connectorInstanceId, connectorRunId, executionScopeId, input }) {
      const captureInput = createCaptureInputSchema.parse({
        evidenceMode: input.evidenceMode ?? 'reported',
        adapter: { ...adapter, kind: 'connector' },
        observedAt: input.observedAt,
        providerRecordId: input.providerRecordId ?? null,
        providerSchema: input.providerSchema ?? null,
        payload: input.payload ?? null,
        evidence: input.evidence ?? [],
      })
      const connectorProvenance = {
        connectorInstanceId,
        connectorRunId,
        executionScopeId,
        reportedOrigin: input.reportedOrigin ?? null,
      }
      const accepted = await captureService.accept({
        workspaceId,
        provenance: {
          adapterId: adapter.id,
          adapterKind: 'connector',
          adapterVersion: adapter.version,
          providerRecordId: captureInput.providerRecordId,
          providerSchema: captureInput.providerSchema,
          observedAt: captureInput.observedAt,
        },
        evidenceMode: captureInput.evidenceMode,
        evidence: captureInput.evidence.map((item) => ({
          kind: item.kind,
          label: item.label,
          value: item.value as JsonValue,
        })),
        payload: captureInput.payload as JsonValue,
        connectorProvenance,
        actor: { type: 'system', id: connectorInstanceId },
      })
      if (!accepted.ok) {
        throw new Error(`connector_capture_${accepted.code}`)
      }
      if (!accepted.connectorRevision) {
        throw new Error('connector_capture_revision_missing')
      }

      const captureId = accepted.capture.id
      const acceptedRevision = accepted.connectorRevision
      const revisionId = `${captureId}:${acceptedRevision.revision}`
      const occurrenceId = acceptedRevision.occurrenceId
      return {
        captureItemId: occurrenceId,
        captureId,
        sourceEntityId: null,
        revision: {
          id: revisionId,
          captureId,
          revision: acceptedRevision.revision,
          contentHash: acceptedRevision.contentHash,
          reused: acceptedRevision.reused,
          createdAt: acceptedRevision.createdAt,
        },
        occurrence: {
          id: occurrenceId,
          captureId,
          captureRevisionId: revisionId,
          capture: { connectorInstanceId, connectorRunId, executionScopeId },
          observedAt: input.observedAt,
          receivedAt: acceptedRevision.occurrenceReceivedAt,
        },
      }
    },
  }
}
