import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ConnectorScheduleSummary, ConnectorSchedulingCapability } from 'sparxie'
import {
  cadenceFromDraft,
  CONNECTOR_SCHEDULE_LOAD_FAILURE_EXPLANATION,
  createEmptyConnectorScheduleDraft,
  draftFromCanonicalSchedule,
  isConnectorScheduleDraftDirty,
  sanitizeConnectorScheduleError,
  validateConnectorScheduleDraft,
  type ConnectorScheduleValidationField,
} from './connector-schedule.helpers'
import { presentLoadFailure, ownedLoadFailure, type ErrorPresentation } from '../app/error-presentation'
import type { ConnectorScheduleDraft, ConnectorScheduleUiApi } from './connector-schedule.types'
import type { ConnectorSettingsInstance } from './connector-settings.types'

export type { ConnectorScheduleValidationField }

export type InstanceScheduleUiState = {
  canonical: ConnectorScheduleSummary | null
  draft: ConnectorScheduleDraft
  isLoading: boolean
  isSaving: boolean
  loadFailure: ErrorPresentation | null
  statusMessage: string | null
  statusTone: 'idle' | 'success' | 'error'
  validationField: ConnectorScheduleValidationField | null
}

export function createInitialInstanceScheduleState(): InstanceScheduleUiState {
  return {
    canonical: null,
    draft: createEmptyConnectorScheduleDraft(),
    isLoading: true,
    isSaving: false,
    loadFailure: null,
    statusMessage: null,
    statusTone: 'idle',
    validationField: null,
  }
}

export function useConnectorInstanceSchedules({
  connectorScheduleApi,
  instances,
  workspaceId,
}: {
  connectorScheduleApi: ConnectorScheduleUiApi
  instances: ConnectorSettingsInstance[]
  workspaceId: string | null
}) {
  const [scheduleReloadKey, setScheduleReloadKey] = useState(0)
  const [loadedCapability, setLoadedCapability] = useState<{
    api: ConnectorScheduleUiApi
    capability: ConnectorSchedulingCapability | null
    error: ErrorPresentation | null
    workspaceId: string
  } | null>(null)
  const [scheduleStates, setScheduleStates] = useState<Record<string, InstanceScheduleUiState>>({})
  const scheduleRequestGeneration = useRef(0)
  const workspaceIdRef = useRef(workspaceId)
  const scheduleStatesRef = useRef(scheduleStates)
  const instanceTokensRef = useRef<Record<string, number>>({})
  const startedLoadsRef = useRef<Set<string>>(new Set())
  const activeInstanceIdsRef = useRef<Set<string>>(new Set())
  const previousInstanceIdsRef = useRef<string[]>([])
  workspaceIdRef.current = workspaceId
  scheduleStatesRef.current = scheduleStates
  const instanceIdsKey = instances.map((instance) => instance.id).join('\0')

  const capabilityMatchesCurrentPair = (
    loadedCapability?.workspaceId === workspaceId
    && loadedCapability?.api === connectorScheduleApi
  )
  const schedulingCapability = capabilityMatchesCurrentPair
    ? loadedCapability.capability
    : null
  const capabilityLoadError = capabilityMatchesCurrentPair
    ? loadedCapability.error
    : null

  useLayoutEffect(() => {
    const currentInstanceIds = instanceIdsKey.length === 0 ? [] : instanceIdsKey.split('\0')
    const currentActiveIds = new Set(currentInstanceIds)

    for (const previousId of previousInstanceIdsRef.current) {
      if (!currentActiveIds.has(previousId)) {
        startedLoadsRef.current.delete(previousId)
        instanceTokensRef.current[previousId] = (instanceTokensRef.current[previousId] ?? 0) + 1
      }
    }

    activeInstanceIdsRef.current = currentActiveIds
    previousInstanceIdsRef.current = currentInstanceIds
  }, [instanceIdsKey])

  useEffect(() => {
    scheduleRequestGeneration.current += 1
    const requestGeneration = scheduleRequestGeneration.current
    setLoadedCapability(null)
    setScheduleStates({})
    instanceTokensRef.current = {}
    startedLoadsRef.current = new Set()

    if (!workspaceId) {
      return
    }

    const requestWorkspaceId = workspaceId
    const requestApi = connectorScheduleApi
    let cancelled = false

    void connectorScheduleApi.getCapabilities()
      .then((capabilities) => {
        if (cancelled || requestGeneration !== scheduleRequestGeneration.current) {
          return
        }

        setLoadedCapability({
          api: requestApi,
          capability: capabilities.connectorScheduling,
          error: null,
          workspaceId: requestWorkspaceId,
        })
      })
      .catch((error: unknown) => {
        if (cancelled || requestGeneration !== scheduleRequestGeneration.current) {
          return
        }

        const failure = ownedLoadFailure(presentLoadFailure(error, {
          fallbackMessage: CONNECTOR_SCHEDULE_LOAD_FAILURE_EXPLANATION,
          hasStaleData: false,
          trigger: 'load',
        }))
        setLoadedCapability({
          api: requestApi,
          capability: failure ? null : { available: false },
          error: failure,
          workspaceId: requestWorkspaceId,
        })
      })

    return () => {
      cancelled = true
    }
  }, [connectorScheduleApi, scheduleReloadKey, workspaceId])

  useEffect(() => {
    if (
      !workspaceId
      || !capabilityMatchesCurrentPair
      || !schedulingCapability?.available
    ) {
      return
    }

    const instanceIds = instanceIdsKey.length === 0 ? [] : instanceIdsKey.split('\0')
    for (const startedId of startedLoadsRef.current) {
      if (!instanceIds.includes(startedId)) {
        startedLoadsRef.current.delete(startedId)
      }
    }

    const toLoad = instanceIds.filter((instanceId) => !startedLoadsRef.current.has(instanceId))
    if (toLoad.length === 0) {
      return
    }

    for (const instanceId of toLoad) {
      startedLoadsRef.current.add(instanceId)
      instanceTokensRef.current[instanceId] = (instanceTokensRef.current[instanceId] ?? 0) + 1
    }

    const requestGeneration = scheduleRequestGeneration.current
    const loadTokens = Object.fromEntries(
      toLoad.map((instanceId) => [instanceId, instanceTokensRef.current[instanceId]!]),
    )

    setScheduleStates((current) => {
      const next = { ...current }
      for (const instanceId of toLoad) {
        next[instanceId] = createInitialInstanceScheduleState()
      }
      return next
    })

    void Promise.all(toLoad.map(async (instanceId) => {
      const loadToken = loadTokens[instanceId]!
      try {
        const schedule = await connectorScheduleApi.getSchedule(instanceId)
        if (requestGeneration !== scheduleRequestGeneration.current) {
          return
        }

        setScheduleStates((current) => {
          if (loadToken !== (instanceTokensRef.current[instanceId] ?? 0)) {
            return current
          }

          return {
            ...current,
            [instanceId]: {
              canonical: schedule,
              draft: draftFromCanonicalSchedule(schedule),
              isLoading: false,
              isSaving: false,
              loadFailure: null,
              statusMessage: null,
              statusTone: 'idle',
              validationField: null,
            },
          }
        })
      } catch (error) {
        if (
          requestGeneration !== scheduleRequestGeneration.current
          || loadToken !== (instanceTokensRef.current[instanceId] ?? 0)
        ) {
          return
        }

        setScheduleStates((current) => ({
          ...current,
          [instanceId]: {
            ...createInitialInstanceScheduleState(),
            isLoading: false,
            loadFailure: ownedLoadFailure(presentLoadFailure(error, {
              fallbackMessage: CONNECTOR_SCHEDULE_LOAD_FAILURE_EXPLANATION,
              hasStaleData: false,
              trigger: 'load',
            })),
          },
        }))
      }
    }))
  }, [
    capabilityMatchesCurrentPair,
    connectorScheduleApi,
    instanceIdsKey,
    schedulingCapability,
    workspaceId,
  ])

  function bumpInstanceToken(instanceId: string) {
    const next = (instanceTokensRef.current[instanceId] ?? 0) + 1
    instanceTokensRef.current[instanceId] = next
    return next
  }

  function beginInstanceOperation(instanceId: string) {
    return {
      generation: scheduleRequestGeneration.current,
      token: instanceTokensRef.current[instanceId] ?? 0,
      workspaceId,
    }
  }

  function isCurrentInstanceOperation(
    instanceId: string,
    operation: { generation: number; token: number; workspaceId: string | null },
  ) {
    return (
      operation.generation === scheduleRequestGeneration.current
      && operation.workspaceId === workspaceIdRef.current
      && operation.token === (instanceTokensRef.current[instanceId] ?? 0)
      && activeInstanceIdsRef.current.has(instanceId)
    )
  }

  function applyOwnedCanonicalSchedule(
    instanceId: string,
    operation: { generation: number; token: number; workspaceId: string | null },
    schedule: ConnectorScheduleSummary | null,
    statusMessage: string | null,
    statusTone: 'idle' | 'success' | 'error',
  ) {
    if (!isCurrentInstanceOperation(instanceId, operation)) {
      return false
    }
    bumpInstanceToken(instanceId)
    applyCanonicalSchedule(instanceId, schedule, statusMessage, statusTone)
    return true
  }

  function applyOwnedScheduleError(
    instanceId: string,
    operation: { generation: number; token: number; workspaceId: string | null },
    baseline: InstanceScheduleUiState,
    error: unknown,
  ) {
    if (!isCurrentInstanceOperation(instanceId, operation)) {
      return false
    }
    setScheduleStates((states) => ({
      ...states,
      [instanceId]: {
        ...baseline,
        isSaving: false,
        statusMessage: sanitizeConnectorScheduleError(error),
        statusTone: 'error',
      },
    }))
    return true
  }

  function updateScheduleDraft(instanceId: string, patch: Partial<ConnectorScheduleDraft>) {
    setScheduleStates((current) => {
      const existing = current[instanceId] ?? createInitialInstanceScheduleState()
      if (existing.isLoading) {
        return current
      }
      return {
        ...current,
        [instanceId]: {
          ...existing,
          draft: {
            ...existing.draft,
            ...patch,
          },
          statusMessage: null,
          statusTone: 'idle',
          validationField: null,
        },
      }
    })
  }

  function applyCanonicalSchedule(
    instanceId: string,
    schedule: ConnectorScheduleSummary | null,
    statusMessage: string | null,
    statusTone: 'idle' | 'success' | 'error',
  ) {
    setScheduleStates((current) => ({
      ...current,
      [instanceId]: {
        canonical: schedule,
        draft: draftFromCanonicalSchedule(schedule),
        isLoading: false,
        isSaving: false,
        loadFailure: null,
        statusMessage,
        statusTone,
        validationField: null,
      },
    }))
  }

  async function saveConnectorSchedule(instance: ConnectorSettingsInstance) {
    if (!schedulingCapability?.available) {
      return
    }

    const current = scheduleStatesRef.current[instance.id] ?? createInitialInstanceScheduleState()
    if (current.isLoading || current.isSaving) {
      return
    }

    const operation = beginInstanceOperation(instance.id)
    const validationError = validateConnectorScheduleDraft(current.draft, schedulingCapability)
    if (validationError) {
      if (!isCurrentInstanceOperation(instance.id, operation)) {
        return
      }
      setScheduleStates((states) => ({
        ...states,
        [instance.id]: {
          ...current,
          statusMessage: validationError.message,
          statusTone: 'error',
          validationField: validationError.field,
        },
      }))
      return
    }

    setScheduleStates((states) => ({
      ...states,
      [instance.id]: {
        ...current,
        isSaving: true,
        statusMessage: null,
        statusTone: 'idle',
      },
    }))

    try {
      if (current.draft.mode === 'manual') {
        if (!current.canonical) {
          applyOwnedCanonicalSchedule(
            instance.id,
            operation,
            null,
            'Schedule already manual only.',
            'success',
          )
          return
        }

        await connectorScheduleApi.deleteSchedule({
          connectorInstanceId: instance.id,
          expectedRevision: current.canonical.revision,
        })
        applyOwnedCanonicalSchedule(
          instance.id,
          operation,
          null,
          'Automatic schedule removed.',
          'success',
        )
        return
      }

      const cadence = cadenceFromDraft(current.draft, schedulingCapability)
      if (!cadence) {
        if (!isCurrentInstanceOperation(instance.id, operation)) {
          return
        }
        setScheduleStates((states) => ({
          ...states,
          [instance.id]: {
            ...current,
            isSaving: false,
            statusMessage: 'Choose a supported schedule.',
            statusTone: 'error',
          },
        }))
        return
      }

      const saved = await connectorScheduleApi.upsertSchedule({
        connectorInstanceId: instance.id,
        expectedRevision: current.canonical?.revision ?? null,
        state: current.draft.state,
        cadence,
        timezone: current.draft.timezone,
      })
      applyOwnedCanonicalSchedule(instance.id, operation, saved, 'Schedule saved.', 'success')
    } catch (error) {
      applyOwnedScheduleError(instance.id, operation, current, error)
    }
  }

  function discardConnectorSchedule(instance: ConnectorSettingsInstance) {
    const current = scheduleStatesRef.current[instance.id]
    if (!current || current.isLoading) {
      return
    }

    applyCanonicalSchedule(instance.id, current.canonical, 'Draft discarded.', 'idle')
  }

  async function pauseConnectorSchedule(instance: ConnectorSettingsInstance) {
    const current = scheduleStatesRef.current[instance.id]
    if (!current?.canonical || current.isLoading || current.isSaving) {
      return
    }

    const operation = beginInstanceOperation(instance.id)

    setScheduleStates((states) => ({
      ...states,
      [instance.id]: {
        ...current,
        isSaving: true,
        statusMessage: null,
        statusTone: 'idle',
        validationField: null,
      },
    }))

    try {
      const paused = await connectorScheduleApi.pauseSchedule({
        connectorInstanceId: instance.id,
        expectedRevision: current.canonical.revision,
      })
      applyOwnedCanonicalSchedule(instance.id, operation, paused, 'Schedule paused.', 'success')
    } catch (error) {
      applyOwnedScheduleError(instance.id, operation, current, error)
    }
  }

  async function resumeConnectorSchedule(instance: ConnectorSettingsInstance) {
    const current = scheduleStatesRef.current[instance.id]
    if (!current?.canonical || current.isLoading || current.isSaving) {
      return
    }

    const operation = beginInstanceOperation(instance.id)

    setScheduleStates((states) => ({
      ...states,
      [instance.id]: {
        ...current,
        isSaving: true,
        statusMessage: null,
        statusTone: 'idle',
        validationField: null,
      },
    }))

    try {
      const resumed = await connectorScheduleApi.resumeSchedule({
        connectorInstanceId: instance.id,
        expectedRevision: current.canonical.revision,
      })
      applyOwnedCanonicalSchedule(instance.id, operation, resumed, 'Schedule resumed.', 'success')
    } catch (error) {
      applyOwnedScheduleError(instance.id, operation, current, error)
    }
  }

  return {
    capabilityLoadError,
    discardConnectorSchedule,
    isScheduleDraftDirty: isConnectorScheduleDraftDirty,
    pauseConnectorSchedule,
    reloadSchedules: () => setScheduleReloadKey((key) => key + 1),
    resumeConnectorSchedule,
    saveConnectorSchedule,
    scheduleStates,
    schedulingCapability,
    updateScheduleDraft,
  }
}
