import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { ToastInput } from '@/components/ui/use-toast'
import { actionFailureToastInput } from '../app/error-presentation'
import {
  maximumSelectableEarliestBackfillDate,
  validateSelectableEarliestBackfillDate,
} from '../modules/connectors/connector.earliest-backfill'
import { JOBRIGHT_CONNECTOR_ID } from '../modules/connectors/jobright.constants'
import {
  beginTrackedMutation,
  buildConnectorSettingsUpdate,
  isCurrentMutation,
  omitRecordKey,
  selectInstalledConnectorDescriptor,
  triggerManualConnectorRun,
} from './connector-instance-settings-mutations'
import { defaultConnectorSettingsDraft } from './connector-settings.helpers'
import { sanitizedConnectorSettingsSaveErrorMessage } from './connector-settings.helpers'
import type {
  ConnectorAuthUiState,
  ConnectorSettingsDraft,
  ConnectorSettingsInstance,
  ConnectorSettingsRun,
  ConnectorSettingsUiApi,
} from './connector-settings.types'
import type { InstalledConnectorDescriptor } from '@sparxie/sdk'

export function isCurrentConnectorMutationTarget(
  isMountedRef: MutableRefObject<boolean>,
  createTargetEpochRef: MutableRefObject<number>,
  epochAtStart: number,
): boolean {
  return isMountedRef.current && createTargetEpochRef.current === epochAtStart
}

export function isCurrentConnectorTargetEpoch(
  createTargetEpochRef: MutableRefObject<number>,
  epochAtStart: number,
): boolean {
  return createTargetEpochRef.current === epochAtStart
}

export async function saveConnectorInstanceSettings({
  connectorsApi,
  createTargetEpochRef,
  descriptors,
  drafts,
  instance,
  isMountedRef,
  onConnectorChanged,
  savingInstanceIds,
  setConnectorActionError,
  setDrafts,
  setInstances,
  setSavingInstanceIds,
  setSettingsSaveErrors,
  settingsSaveGenerations,
}: {
  connectorsApi: ConnectorSettingsUiApi
  createTargetEpochRef: MutableRefObject<number>
  descriptors: Record<string, InstalledConnectorDescriptor>
  drafts: Record<string, ConnectorSettingsDraft>
  instance: ConnectorSettingsInstance
  isMountedRef: MutableRefObject<boolean>
  onConnectorChanged: () => void
  savingInstanceIds: ReadonlySet<string>
  setConnectorActionError: Dispatch<SetStateAction<string | null>>
  setDrafts: Dispatch<SetStateAction<Record<string, ConnectorSettingsDraft>>>
  setInstances: Dispatch<SetStateAction<ConnectorSettingsInstance[]>>
  setSavingInstanceIds: Dispatch<SetStateAction<ReadonlySet<string>>>
  setSettingsSaveErrors: Dispatch<SetStateAction<Record<string, string>>>
  settingsSaveGenerations: MutableRefObject<Record<string, number>>
}) {
  if (savingInstanceIds.has(instance.id)) {
    return false
  }

  const draft = drafts[instance.id] ?? defaultConnectorSettingsDraft(instance)
  const descriptor = selectInstalledConnectorDescriptor(
    Object.values(descriptors),
    instance.connectorId,
    instance.connectorVersion,
  )
  const built = buildConnectorSettingsUpdate({ descriptor, draft, instance })
  if ('error' in built && built.error) {
    setConnectorActionError(built.error)
    return false
  }
  if (!('update' in built) || !built.update) {
    return false
  }
  setConnectorActionError(null)
  setSettingsSaveErrors((currentErrors) => omitRecordKey(currentErrors, instance.id))
  const epochAtStart = createTargetEpochRef.current
  const saveGeneration = beginTrackedMutation(settingsSaveGenerations, instance.id)
  setSavingInstanceIds((currentIds) => new Set(currentIds).add(instance.id))
  try {
    const updated = await connectorsApi.update(built.update)
    if (
      !isCurrentConnectorMutationTarget(isMountedRef, createTargetEpochRef, epochAtStart)
      || !isCurrentMutation(settingsSaveGenerations, instance.id, saveGeneration)
    ) {
      return false
    }
    setInstances((currentInstances) => currentInstances.map((currentInstance) =>
      currentInstance.id === updated.id ? updated : currentInstance,
    ))
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [updated.id]: defaultConnectorSettingsDraft(updated),
    }))
    setSettingsSaveErrors((currentErrors) => omitRecordKey(currentErrors, updated.id))
    onConnectorChanged()
    return true
  } catch (error) {
    if (
      !isCurrentConnectorMutationTarget(isMountedRef, createTargetEpochRef, epochAtStart)
      || !isCurrentMutation(settingsSaveGenerations, instance.id, saveGeneration)
    ) {
      return false
    }
    setSettingsSaveErrors((currentErrors) => ({
      ...currentErrors,
      [instance.id]: sanitizedConnectorSettingsSaveErrorMessage(error),
    }))
    return false
  } finally {
    if (
      isCurrentConnectorMutationTarget(isMountedRef, createTargetEpochRef, epochAtStart)
      && isCurrentMutation(settingsSaveGenerations, instance.id, saveGeneration)
    ) {
      setSavingInstanceIds((currentIds) => {
        const nextIds = new Set(currentIds)
        nextIds.delete(instance.id)
        return nextIds
      })
    }
  }
}

export function removeConnectorInstance({
  connectorsApi,
  createTargetEpochRef,
  instance,
  invalidateAuthValidation,
  isMountedRef,
  onConnectorChanged,
  removingInstanceIds,
  setAuthStates,
  setConnectorActionError,
  setCredentialEditFeedback,
  setDrafts,
  setInstances,
  setRemovingInstanceIds,
  settingsSaveGenerations,
}: {
  connectorsApi: ConnectorSettingsUiApi
  createTargetEpochRef: MutableRefObject<number>
  instance: ConnectorSettingsInstance
  invalidateAuthValidation: (instanceId: string) => void
  isMountedRef: MutableRefObject<boolean>
  onConnectorChanged: () => void
  removingInstanceIds: ReadonlySet<string>
  setAuthStates: Dispatch<SetStateAction<Record<string, ConnectorAuthUiState>>>
  setConnectorActionError: Dispatch<SetStateAction<string | null>>
  setCredentialEditFeedback: Dispatch<SetStateAction<Record<string, string>>>
  setDrafts: Dispatch<SetStateAction<Record<string, ConnectorSettingsDraft>>>
  setInstances: Dispatch<SetStateAction<ConnectorSettingsInstance[]>>
  setRemovingInstanceIds: Dispatch<SetStateAction<ReadonlySet<string>>>
  settingsSaveGenerations: MutableRefObject<Record<string, number>>
}) {
  if (removingInstanceIds.has(instance.id)) {
    return
  }

  setConnectorActionError(null)
  const epochAtStart = createTargetEpochRef.current
  const removeGeneration = beginTrackedMutation(settingsSaveGenerations, `remove:${instance.id}`)
  setRemovingInstanceIds((currentIds) => new Set(currentIds).add(instance.id))
  void connectorsApi.remove({ connectorInstanceId: instance.id })
    .then(() => {
      if (
        !isCurrentConnectorMutationTarget(isMountedRef, createTargetEpochRef, epochAtStart)
        || !isCurrentMutation(settingsSaveGenerations, `remove:${instance.id}`, removeGeneration)
      ) {
        return
      }
      invalidateAuthValidation(instance.id)
      setInstances((currentInstances) => currentInstances.filter(
        (currentInstance) => currentInstance.id !== instance.id,
      ))
      setDrafts((currentDrafts) => {
        const nextDrafts = { ...currentDrafts }
        delete nextDrafts[instance.id]
        return nextDrafts
      })
      setAuthStates((currentStates) => {
        const nextStates = { ...currentStates }
        delete nextStates[instance.id]
        return nextStates
      })
      setCredentialEditFeedback((currentFeedback) => {
        const nextFeedback = { ...currentFeedback }
        delete nextFeedback[instance.id]
        return nextFeedback
      })
      onConnectorChanged()
    })
    .catch((error: unknown) => {
      if (
        !isCurrentConnectorMutationTarget(isMountedRef, createTargetEpochRef, epochAtStart)
        || !isCurrentMutation(settingsSaveGenerations, `remove:${instance.id}`, removeGeneration)
      ) {
        return
      }
      const conflictCode = error && typeof error === 'object'
        ? ('code' in error
            ? error.code
            : 'conflict' in error && error.conflict && typeof error.conflict === 'object'
              && 'code' in error.conflict
              ? error.conflict.code
              : undefined)
        : undefined
      setConnectorActionError(conflictCode === 'connector_retirement_active_work_conflict'
        ? 'Cancel queued or running connector work before removing this connector.'
        : 'Connector could not be removed.')
    })
    .finally(() => {
      if (
        !isCurrentConnectorMutationTarget(isMountedRef, createTargetEpochRef, epochAtStart)
        || !isCurrentMutation(settingsSaveGenerations, `remove:${instance.id}`, removeGeneration)
      ) {
        return
      }
      setRemovingInstanceIds((currentIds) => {
        const nextIds = new Set(currentIds)
        nextIds.delete(instance.id)
        return nextIds
      })
    })
}

export function runConnectorInstanceNow({
  connectorsApi,
  createTargetEpochRef,
  drafts,
  instance,
  isMountedRef,
  onRunSettled,
  runGenerations,
  runningInstanceIds,
  savingInstanceIds,
  setConnectorActionError,
  setLatestRuns,
  setLatestRunStatuses,
  setRunningInstanceIds,
  toast,
}: {
  connectorsApi: ConnectorSettingsUiApi
  createTargetEpochRef: MutableRefObject<number>
  drafts: Record<string, ConnectorSettingsDraft>
  instance: ConnectorSettingsInstance
  isMountedRef: MutableRefObject<boolean>
  onRunSettled: () => void
  runGenerations: MutableRefObject<Record<string, number>>
  runningInstanceIds: ReadonlySet<string>
  savingInstanceIds: ReadonlySet<string>
  setConnectorActionError: Dispatch<SetStateAction<string | null>>
  setLatestRuns: Dispatch<SetStateAction<Record<string, ConnectorSettingsRun>>>
  setLatestRunStatuses: Dispatch<SetStateAction<Record<string, string>>>
  setRunningInstanceIds: Dispatch<SetStateAction<ReadonlySet<string>>>
  toast: (input: ToastInput) => void
}) {
  if (instance.connectorId !== JOBRIGHT_CONNECTOR_ID) {
    return
  }

  if (savingInstanceIds.has(instance.id)) {
    setConnectorActionError(
      'Wait for connector settings to finish saving before running.',
    )
    return
  }

  const draft = drafts[instance.id] ?? defaultConnectorSettingsDraft(instance)
  const saved = defaultConnectorSettingsDraft(instance)
  const isDirty = draft.enabled !== saved.enabled
    || JSON.stringify(draft.config) !== JSON.stringify(saved.config)
    || JSON.stringify(draft.filters) !== JSON.stringify(saved.filters)
    || (instance.connectorId === JOBRIGHT_CONNECTOR_ID
      && draft.earliestBackfillDate !== saved.earliestBackfillDate)
  if (isDirty) {
    setConnectorActionError(
      'Save or discard your unsaved connector settings before running.',
    )
    return
  }

  if (instance.connectorId === JOBRIGHT_CONNECTOR_ID) {
    const hasInvalidEarliest = !validateSelectableEarliestBackfillDate({
      candidate: draft.earliestBackfillDate,
      createdAt: instance.createdAt,
      todayUtc: maximumSelectableEarliestBackfillDate(new Date().toISOString()),
    }).ok
    if (hasInvalidEarliest) {
      setConnectorActionError(
        'Choose a valid earliest backfill date before running.',
      )
      return
    }
  }

  if (runningInstanceIds.has(instance.id)) {
    return
  }

  setConnectorActionError(null)
  const epochAtStart = createTargetEpochRef.current
  const runGeneration = beginTrackedMutation(runGenerations, instance.id)
  setRunningInstanceIds((currentIds) => new Set(currentIds).add(instance.id))
  setLatestRunStatuses((currentStatuses) => ({
    ...currentStatuses,
    [instance.id]: 'running',
  }))
  void triggerManualConnectorRun({
    connectorsApi,
    instanceId: instance.id,
  })
    .then((run) => {
      if (
        !isCurrentConnectorMutationTarget(isMountedRef, createTargetEpochRef, epochAtStart)
        || !isCurrentMutation(runGenerations, instance.id, runGeneration)
      ) {
        return
      }
      setLatestRuns((currentRuns) => ({
        ...currentRuns,
        [instance.id]: run,
      }))
      setLatestRunStatuses((currentStatuses) => ({
        ...currentStatuses,
        [instance.id]: run.status,
      }))
    })
    .catch((error: unknown) => {
      if (
        !isCurrentConnectorMutationTarget(isMountedRef, createTargetEpochRef, epochAtStart)
        || !isCurrentMutation(runGenerations, instance.id, runGeneration)
      ) {
        return
      }
      toast(actionFailureToastInput(error, {
        fallbackMessage: 'Jobright run could not be completed.',
        operationId: `connector-run:${instance.id}`,
      }))
      setLatestRunStatuses((currentStatuses) => {
        const nextStatuses = { ...currentStatuses }
        delete nextStatuses[instance.id]
        return nextStatuses
      })
    })
    .finally(() => {
      if (
        !isCurrentConnectorTargetEpoch(createTargetEpochRef, epochAtStart)
        || !isCurrentMutation(runGenerations, instance.id, runGeneration)
      ) {
        return
      }
      if (isMountedRef.current) {
        setRunningInstanceIds((currentIds) => {
          const nextIds = new Set(currentIds)
          nextIds.delete(instance.id)
          return nextIds
        })
      }
      onRunSettled()
    })
}
