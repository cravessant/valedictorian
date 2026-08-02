import { createCaptureInputSchema } from '@sparxie/sdk'
import type { CaptureService, JsonValue } from '../../../capture/capture.service.js'
import type {
  AppConnectorCaptureHost,
  DestinationWorkEnqueueInput,
  ProviderFieldWorkEnqueueInput,
} from '../../ports/connector.capture-host.port.js'

export function createConnectorCaptureHost({
  captureService,
  enqueueDestinationWork,
  enqueueProviderFieldWork,
  workspaceId,
}: {
  captureService: CaptureService
  now?: () => Date
  workspaceId: string
  enqueueDestinationWork?: (input: DestinationWorkEnqueueInput) => Promise<void>
  enqueueProviderFieldWork?: (input: ProviderFieldWorkEnqueueInput) => Promise<void>
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
      if (enqueueProviderFieldWork && acceptedRevision.contentHash) {
        try {
          await enqueueProviderFieldWork({
            captureId,
            captureRevision: acceptedRevision.revision,
            contentHash: acceptedRevision.contentHash,
            adapterId: adapter.id,
            providerSchema: captureInput.providerSchema,
          })
        } catch {
          // Enqueue failure must not undo acknowledgement or block the connector frontier.
        }
      }
      if (enqueueDestinationWork) {
        try {
          await enqueueDestinationWork({ captureId })
        } catch {
          // Scheduling happens after acknowledgement; recovery closes an enqueue gap.
        }
      }
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
