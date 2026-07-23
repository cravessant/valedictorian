import type { InstalledConnectorDescriptor } from '@sparxie/sdk'
import {
  maximumSelectableEarliestBackfillDate,
  validateSelectableEarliestBackfillDate,
} from '../modules/connectors/connector.earliest-backfill'
import { JOBRIGHT_CONNECTOR_ID } from '../modules/connectors/jobright.constants'
import {
  defaultConnectorSettingsDraft,
  isUnchangedConnectorDisable,
} from './connector-settings.helpers'
import type {
  ConnectorSettingsDraft,
  ConnectorSettingsInstance,
  ConnectorSettingsUiApi,
} from './connector-settings.types'

function selectInstalledConnectorDescriptor(
  descriptors: InstalledConnectorDescriptor[],
  connectorId: string,
  connectorVersion: string,
) {
  const sameConnector = descriptors.filter((descriptor) => descriptor.connectorId === connectorId)
  return sameConnector.find((descriptor) => descriptor.connectorVersion === connectorVersion)
    ?? (sameConnector.length === 1 ? sameConnector[0] : undefined)
}

export { selectInstalledConnectorDescriptor }

export function omitRecordKey<T extends Record<string, string>>(
  record: T,
  key: string,
): T {
  if (!(key in record)) {
    return record
  }
  const next = { ...record }
  delete next[key]
  return next
}

export function buildConnectorSettingsUpdate({
  descriptor,
  draft,
  instance,
}: {
  descriptor: InstalledConnectorDescriptor | undefined
  draft: ConnectorSettingsDraft
  instance: ConnectorSettingsInstance
}) {
  const savedDraft = defaultConnectorSettingsDraft(instance)
  const isJobrightInstance = instance.connectorId === JOBRIGHT_CONNECTOR_ID
  const earliestValidation = isJobrightInstance
    ? validateSelectableEarliestBackfillDate({
        candidate: draft.earliestBackfillDate,
        createdAt: instance.createdAt,
        todayUtc: maximumSelectableEarliestBackfillDate(new Date().toISOString()),
      })
    : null

  if (earliestValidation && !earliestValidation.ok) {
    return { error: earliestValidation.message as string }
  }

  const update = isUnchangedConnectorDisable(instance, draft)
    ? { connectorInstanceId: instance.id, enabled: false as const }
    : {
        connectorInstanceId: instance.id,
        enabled: draft.enabled,
        ...(descriptor && descriptor.connectorVersion !== instance.connectorVersion
          ? { connectorVersion: descriptor.connectorVersion }
          : {}),
        ...(JSON.stringify(draft.config) !== JSON.stringify(savedDraft.config)
          ? { config: draft.config }
          : {}),
        ...(descriptor ? { filters: draft.filters } : {}),
        ...(earliestValidation?.ok
          && draft.earliestBackfillDate !== savedDraft.earliestBackfillDate
          ? { earliestBackfillDate: earliestValidation.value }
          : {}),
      }

  return { update }
}

export function beginTrackedMutation(
  generations: { current: Record<string, number> },
  instanceId: string,
): number {
  const generation = (generations.current[instanceId] ?? 0) + 1
  generations.current[instanceId] = generation
  return generation
}

export function isCurrentMutation(
  generations: { current: Record<string, number> },
  instanceId: string,
  generation: number,
): boolean {
  return generations.current[instanceId] === generation
}

export async function triggerManualConnectorRun({
  connectorsApi,
  instanceId,
}: {
  connectorsApi: ConnectorSettingsUiApi
  instanceId: string
}) {
  return connectorsApi.runs.trigger({
    connectorInstanceId: instanceId,
    mode: 'manual',
  })
}
