import { createHash, randomUUID } from 'node:crypto'
import type { ConnectorRawSourceCaptureInput } from '@sparxie/valedictorian-connectors-core'
import type { CaptureService, JsonValue } from '../capture/capture.service'

export interface ConnectorCaptureReceipt {
  readonly intakeItemId: string
  readonly rawRecordId: string
  readonly sourceEntityId: null
  readonly revision: {
    readonly id: string
    readonly rawRecordId: string
    readonly revision: number
    readonly contentHash: string
    readonly reused: boolean
    readonly createdAt: string
  }
  readonly occurrence: {
    readonly id: string
    readonly rawRecordId: string
    readonly rawRevisionId: string
    readonly capture: {
      readonly connectorInstanceId: string
      readonly connectorRunId: string
      readonly executionScopeId: string
    }
    readonly observedAt: string
    readonly receivedAt: string
  }
}

export interface ConnectorCaptureHostInput {
  readonly adapter: { readonly id: string; readonly version: string }
  readonly connectorInstanceId: string
  readonly connectorRunId: string
  readonly executionScopeId: string
  readonly input: ConnectorRawSourceCaptureInput
}

export interface AppConnectorCaptureHost {
  capture(input: ConnectorCaptureHostInput): Promise<ConnectorCaptureReceipt>
}

export function createConnectorCaptureHost({
  captureService,
  now = () => new Date(),
  workspaceId,
}: {
  captureService: CaptureService
  now?: () => Date
  workspaceId: string
}): AppConnectorCaptureHost {
  return {
    async capture({ adapter, connectorInstanceId, connectorRunId, executionScopeId, input }) {
      const accepted = await captureService.accept({
        workspaceId,
        provenance: {
          adapterId: adapter.id,
          adapterKind: 'connector',
          adapterVersion: adapter.version,
          providerRecordId: input.providerRecordId ?? null,
          providerSchema: input.providerSchema ?? null,
          observedAt: input.observedAt,
        },
        evidenceMode: 'reported',
        evidence: (input.evidence ?? []).map((item) => ({
          kind: item.kind,
          label: item.label,
          value: item.value as JsonValue,
        })),
        payload: (input.payload ?? null) as JsonValue,
        actor: { type: 'system', id: connectorInstanceId },
      })
      if (!accepted.ok) {
        throw new Error(`connector_capture_${accepted.code}`)
      }

      const receivedAt = accepted.capture.updatedAt || now().toISOString()
      const rawRecordId = accepted.capture.id
      const revisionId = `${rawRecordId}:${accepted.capture.revision}`
      const occurrenceId = randomUUID()
      return {
        intakeItemId: occurrenceId,
        rawRecordId,
        sourceEntityId: null,
        revision: {
          id: revisionId,
          rawRecordId,
          revision: accepted.capture.revision,
          contentHash: contentHash(input),
          reused: !accepted.created,
          createdAt: receivedAt,
        },
        occurrence: {
          id: occurrenceId,
          rawRecordId,
          rawRevisionId: revisionId,
          capture: { connectorInstanceId, connectorRunId, executionScopeId },
          observedAt: input.observedAt,
          receivedAt,
        },
      }
    },
  }
}

function contentHash(input: ConnectorRawSourceCaptureInput): string {
  return createHash('sha256').update(stableJson(input)).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
