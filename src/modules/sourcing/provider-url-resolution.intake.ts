import type {
  RawSourceIntakeReceipt,
  RawSourceRecordInput,
} from 'sparxie'
import type { LocalConnectorRegistry } from '../connectors/connector.registry'
import type { RawSourceTransaction } from './raw-source.repository'
import { hashJson } from './normalization.registry'
import {
  jobrightIntermediaryUrl,
  providerUrlNormalizationDeclaration,
  providerUrlResolverFor,
} from './provider-url-resolution.connector'
import type { createProviderUrlResolutionRepository } from './provider-url-resolution.repository'

export function createProviderUrlResolutionIntake(options: {
  connectorRegistry: LocalConnectorRegistry
  onScheduledWorkChanged?: () => void
  repository: ReturnType<typeof createProviderUrlResolutionRepository>
}) {
  return {
    enqueue(
      record: RawSourceRecordInput,
      receipt: RawSourceIntakeReceipt,
      transaction?: RawSourceTransaction,
    ): boolean {
      if (!record.capture || !record.providerRecordId) return false
      const connector = typeof options.connectorRegistry.getVersion === 'function'
        ? options.connectorRegistry.getVersion(record.adapter.id, record.adapter.version)
        : (() => {
            const candidate = options.connectorRegistry.get(record.adapter.id)
            return candidate?.definition.version === record.adapter.version ? candidate : null
          })()
      const resolver = providerUrlResolverFor(connector)
      const intermediaryUrl = jobrightIntermediaryUrl(
        record.adapter.id,
        record.providerRecordId,
      )
      if (!resolver || !intermediaryUrl) return false
      const declaration = providerUrlNormalizationDeclaration(resolver)
      const inserted = options.repository.enqueue({
        captureEvidenceVersionId: receipt.revision.id,
        connectorInstanceId: record.capture.connectorInstanceId,
        executionScopeId: record.capture.executionScopeId,
        inputHash: hashJson({
          raw: receipt.revision.contentHash,
          resolver: declaration,
        }),
        intermediaryUrl,
        providerRecordId: record.providerRecordId,
        resolverId: resolver.id,
        resolverVersion: resolver.version,
      }, transaction)
      if (inserted && !transaction) options.onScheduledWorkChanged?.()
      return inserted
    },
  }
}
