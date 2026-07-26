import type { AppJobConnector } from '../modules/connectors/connector.runner'
import type { createPgliteConnectorRepository } from '../modules/connectors/connector.repository'
import type { RegisteredConnector } from '../modules/connectors/connector.registry'
import { connectorCheckpointSignature } from '../modules/connectors/connector.checkpoint-signature'
import { revalidatePersistedConnectorSettingsForVersionDrift } from '../modules/connectors/connector.settings-validation'
import type { ConnectorInstanceRecord } from '../modules/connectors/connector-instance.persistence-types'

export async function reconcileConnectorPackageUpgrade({
  registered,
  connectorRepository,
  instance,
}: {
  registered: RegisteredConnector
  connectorRepository: ReturnType<typeof createPgliteConnectorRepository>
  instance: ConnectorInstanceRecord
}): Promise<ConnectorInstanceRecord> {
  const { connector, descriptor } = registered
  if (instance.connectorVersion === descriptor.connectorVersion) {
    return instance
  }

  revalidatePersistedConnectorSettingsForVersionDrift(descriptor, instance)
  await preserveCompatibleProviderCheckpoint({ connector, connectorRepository, instance })
  return connectorRepository.upsertInstance({
    id: instance.id,
    connectorId: instance.connectorId,
    connectorVersion: connector.definition.version,
    displayName: instance.displayName,
    enabled: instance.enabled,
    auth: instance.auth,
    config: jsonRecord(instance.config),
    filters: jsonRecord(instance.filters),
    earliestBackfillDate: instance.earliestBackfillDate,
    createdAt: instance.createdAt,
  })
}

async function preserveCompatibleProviderCheckpoint({
  connector,
  connectorRepository,
  instance,
}: {
  connector: AppJobConnector
  connectorRepository: ReturnType<typeof createPgliteConnectorRepository>
  instance: ConnectorInstanceRecord
}) {
  const filters = jsonRecord(instance.filters)
  const targetSignature = connectorCheckpointSignature({
    connectorId: connector.definition.id,
    connectorVersion: connector.definition.version,
    supportsFiltering: connector.definition.capabilities?.supportsFiltering,
    filters,
  })
  if (!targetSignature.startsWith('provider-state:')) return

  const providerStatePrefix = targetSignature.slice(0, targetSignature.lastIndexOf('@') + 1)
  const expectedSchemaVersion = connector.definition.checkpoint?.schemaVersion
  if (!expectedSchemaVersion) return
  await connectorRepository.copyCheckpointIfAbsent({
    connectorInstanceId: instance.id,
    expectedSchemaVersion,
    sourceFilterSignature: `${providerStatePrefix}${instance.connectorVersion}`,
    targetFilterSignature: targetSignature,
  })
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
