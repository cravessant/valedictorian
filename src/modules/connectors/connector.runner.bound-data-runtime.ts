import type {
  ConnectorNormalizationInput,
  ConnectorRawSourceCaptureInput,
  ConnectorRuntime,
} from '@sparxie/valedictorian-connectors-core'
import {
  createBoundRawSourceRecordInputSchema,
  type RawSourceOccurrenceReceipt,
  type RawSourceRecordInput,
  type ResolverCapability,
} from 'sparxie'
import type {
  AppConnectorNormalizationHost,
  AppConnectorRawSourceHost,
  AppJobConnector,
} from './connector.runner'

export interface AcquiredNormalizationReplayIdentity {
  acquisitionRunId: string
  inputHash: string
  rawRevisionId: string
  resolverId: string
  resolverVersion: string
  retryWorkId: string
}

export function createBoundConnectorDataRuntime({
  acquiredNormalizationReplay,
  connector,
  connectorInstanceId,
  connectorRunId,
  normalization,
  rawSource,
  workspaceId,
}: {
  acquiredNormalizationReplay?: AcquiredNormalizationReplayIdentity
  connector: AppJobConnector
  connectorInstanceId: string
  connectorRunId: string
  normalization: AppConnectorNormalizationHost | undefined
  rawSource: AppConnectorRawSourceHost | undefined
  workspaceId: string
}): Pick<ConnectorRuntime, 'normalization' | 'rawSourceIntake'> {
  const adapter = {
    id: connector.definition.id,
    kind: 'connector' as const,
    version: connector.definition.version,
  }
  const enabledCapabilities: ResolverCapability[] = ['pure']
  const occurrencesByRevisionId = new Map<string, RawSourceOccurrenceReceipt>()

  if (connector.definition.capabilities?.resolvesIntermediaryLinks) {
    enabledCapabilities.push('network')
  }
  if (connector.definition.capabilities?.usesBrowserSession) {
    enabledCapabilities.push('browser')
  }

  return {
    ...(rawSource
      ? {
          rawSourceIntake: {
            async capture(input: ConnectorRawSourceCaptureInput) {
              const record = {
                ...input,
                adapter,
                capture: { connectorInstanceId, connectorRunId },
              }
              const validated = createBoundRawSourceRecordInputSchema({
                adapter,
                connectorInstanceId,
                connectorRunId,
                requestWorkspaceId: workspaceId,
                workspaceId,
              }).parse(record)

              const receipt = await rawSource.ingest(validated as RawSourceRecordInput)
              occurrencesByRevisionId.set(receipt.revision.id, receipt.occurrence)
              return receipt
            },
          },
        }
      : {}),
    ...(normalization
      ? {
          normalization: {
            run: (input: ConnectorNormalizationInput) => {
              const triggerOccurrence = occurrencesByRevisionId.get(input.rawRevision.id)
              const exactReplay = acquiredNormalizationReplay
                && acquiredNormalizationReplay.rawRevisionId === input.rawRevision.id
                ? acquiredNormalizationReplay
                : null
              if (!triggerOccurrence && !exactReplay) {
                throw new Error('Connector normalization requires a captured raw occurrence')
              }
              if (exactReplay
                && (input.resolver.id !== exactReplay.resolverId
                  || input.resolver.version !== exactReplay.resolverVersion)) {
                throw new Error(
                  `Acquired normalization retry resolver identity mismatch: expected ${exactReplay.resolverId}@${exactReplay.resolverVersion}`,
                )
              }
              return normalization.run(input, {
                ...(exactReplay
                  ? {
                      acquiredRetryWork: {
                        retryWorkId: exactReplay.retryWorkId,
                        acquisitionRunId: exactReplay.acquisitionRunId,
                      },
                      deferAcquiredRetryCompletion: true,
                    }
                  : {}),
                connectorRunId,
                enabledCapabilities,
                triggerOccurrence: triggerOccurrence ?? null,
              })
            },
          },
        }
      : {}),
  }
}
