import { useEffect, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { AlertCircle, Cable } from 'lucide-react'
import type { ConnectorsPreloadApi } from '../ipc/connectors.preload'
import type { ProfilePreloadApi } from '../ipc/profile.preload'
import {
  JOBRIGHT_CONNECTOR_ID,
  JOBRIGHT_CONNECTOR_VERSION,
  JOBRIGHT_MAX_DISCOVERY_COUNT,
  JOBRIGHT_MIN_DISCOVERY_COUNT,
} from '../modules/connectors/jobright.constants'
import {
  maximumSelectableEarliestBackfillDate,
  validateSelectableEarliestBackfillDate,
} from '../modules/connectors/connector.earliest-backfill'
import {
  defaultConnectorSettingsDraft,
  jobrightSecretKeyForInstance,
  parseBoundedInteger,
  recordFromUnknown,
  sanitizedConnectorAuthErrorMessage,
  shouldAutoValidateJobrightAuth,
} from './connector-settings.helpers'
import type {
  ConnectorAuthCredentialDraft,
  ConnectorAuthUiState,
  ConnectorSettingsDraft,
  ConnectorSettingsInstance,
  ConnectorSettingsRun,
} from './connector-settings.types'
import { ConnectorSettingsInstanceCard } from './ConnectorSettingsInstanceCard'
import type { ConnectorScheduleUiApi } from './connector-schedule.types'
import {
  createInitialInstanceScheduleState,
  useConnectorInstanceSchedules,
} from './useConnectorInstanceSchedules'

export function ConnectorSettingsPanel({
  connectorsApi,
  connectorScheduleApi,
  displayMode = 'settings',
  onConnectorChanged = () => undefined,
  onOpenSourcingRuns,
  onRunSettled,
  profileApi,
  workspaceId,
}: {
  connectorsApi: ConnectorsPreloadApi
  connectorScheduleApi: ConnectorScheduleUiApi
  displayMode?: 'main' | 'settings'
  onConnectorChanged?: () => void
  onOpenSourcingRuns?: (runId?: string) => void
  onRunSettled: () => void
  profileApi: ProfilePreloadApi
  workspaceId: string | null
}) {
  const [instances, setInstances] = useState<ConnectorSettingsInstance[]>([])
  const [drafts, setDrafts] = useState<Record<string, ConnectorSettingsDraft>>({})
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, ConnectorAuthCredentialDraft>>({})
  const [editingAuthInstanceId, setEditingAuthInstanceId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [authenticatingInstanceId, setAuthenticatingInstanceId] = useState<string | null>(null)
  const [authStates, setAuthStates] = useState<Record<string, ConnectorAuthUiState>>({})
  const [savingInstanceIds, setSavingInstanceIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [runningInstanceId, setRunningInstanceId] = useState<string | null>(null)
  const [latestRunStatuses, setLatestRunStatuses] = useState<Record<string, string>>({})
  const [latestRuns, setLatestRuns] = useState<Record<string, ConnectorSettingsRun>>({})
  const [connectorActionError, setConnectorActionError] = useState<string | null>(null)
  const authValidationGenerations = useRef<Record<string, number>>({})
  const {
    capabilityLoadError,
    discardConnectorSchedule,
    isScheduleDraftDirty,
    pauseConnectorSchedule,
    resumeConnectorSchedule,
    saveConnectorSchedule,
    scheduleStates,
    schedulingCapability,
    updateScheduleDraft,
  } = useConnectorInstanceSchedules({
    connectorScheduleApi,
    instances,
    workspaceId,
  })


  useEffect(() => {
    if (!runningInstanceId) {
      return
    }

    let cancelled = false
    let pollTimer: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      try {
        const result = await connectorsApi.runs.list({
          connectorInstanceId: runningInstanceId,
          limit: 1,
          offset: 0,
        })
        const run = result.items[0]

        if (cancelled) {
          return
        }

        if (run) {
          setLatestRuns((currentRuns) => ({ ...currentRuns, [runningInstanceId]: run }))
          setLatestRunStatuses((currentStatuses) => ({
            ...currentStatuses,
            [runningInstanceId]: run.status,
          }))
        }

        if (!run || run.status === 'queued' || run.status === 'running') {
          pollTimer = setTimeout(poll, 500)
        }
      } catch {
        if (!cancelled) {
          pollTimer = setTimeout(poll, 1_000)
        }
      }
    }

    void poll()

    return () => {
      cancelled = true
      if (pollTimer) {
        clearTimeout(pollTimer)
      }
    }
  }, [connectorsApi, runningInstanceId])

  function nextAuthValidationGeneration(instanceId: string): number {
    const nextGeneration = (authValidationGenerations.current[instanceId] ?? 0) + 1
    authValidationGenerations.current[instanceId] = nextGeneration
    return nextGeneration
  }

  function isCurrentAuthValidationGeneration(instanceId: string, generation: number): boolean {
    return authValidationGenerations.current[instanceId] === generation
  }

  function invalidateAuthValidation(instanceId: string): number {
    return nextAuthValidationGeneration(instanceId)
  }

  useEffect(() => {
    let cancelled = false
    const validationGenerations = authValidationGenerations.current

    connectorsApi.list()
      .then(async (result) => {
        if (cancelled) {
          return
        }

        setInstances(result.items)

        const autoValidateInstances = result.items.filter(shouldAutoValidateJobrightAuth)

        if (autoValidateInstances.length === 0) {
          return
        }

        const generations = Object.fromEntries(
          autoValidateInstances.map((instance) => [
            instance.id,
            nextAuthValidationGeneration(instance.id),
          ]),
        )

        setAuthStates((currentStates) => {
          const nextStates = { ...currentStates }

          for (const instance of autoValidateInstances) {
            nextStates[instance.id] = {
              kind: 'checking',
              message: 'Checking Jobright credentials...',
            }
          }

          return nextStates
        })

        await Promise.all(autoValidateInstances.map(async (instance) => {
          const generation = generations[instance.id]

          try {
            const validation = await connectorsApi.status.reconnect({
              connectorInstanceId: instance.id,
            })

            if (
              cancelled
              || generation === undefined
              || !isCurrentAuthValidationGeneration(instance.id, generation)
            ) {
              return
            }

            setAuthStates((currentStates) => ({
              ...currentStates,
              [instance.id]: {
                kind: 'result',
                result: validation,
              },
            }))
          } catch (error) {
            if (
              cancelled
              || generation === undefined
              || !isCurrentAuthValidationGeneration(instance.id, generation)
            ) {
              return
            }

            setAuthStates((currentStates) => ({
              ...currentStates,
              [instance.id]: {
                kind: 'local',
                message: sanitizedConnectorAuthErrorMessage(error),
                status: 'failed',
              },
            }))
          }
        }))
      })
      .catch(() => {
        if (!cancelled) {
          setInstances([])
        }
      })

    return () => {
      cancelled = true
      for (const instanceId of Object.keys(validationGenerations)) {
        validationGenerations[instanceId] = (validationGenerations[instanceId] ?? 0) + 1
      }
    }
  }, [connectorsApi])

  function addJobrightConnector() {
    setConnectorActionError(null)
    setIsAdding(true)
    void connectorsApi.create({
      id: 'jobright-default',
      connectorId: JOBRIGHT_CONNECTOR_ID,
      connectorVersion: JOBRIGHT_CONNECTOR_VERSION,
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [
        {
          id: 'jobright',
          label: 'Jobright username and password',
          mode: 'username_password',
        },
      ],
      config: {},
      filters: {},
    })
      .then((created) => {
        invalidateAuthValidation(created.id)
        setInstances((currentInstances) => [
          ...currentInstances.filter((instance) => instance.id !== created.id),
          created,
        ])
        setAuthStates((currentStates) => ({
          ...currentStates,
          [created.id]: { kind: 'idle' },
        }))
        onConnectorChanged()
      })
      .catch(() => {
        setConnectorActionError('Jobright connector could not be added.')
      })
      .finally(() => setIsAdding(false))
  }

  function beginCredentialEdit(instance: ConnectorSettingsInstance) {
    invalidateAuthValidation(instance.id)
    setEditingAuthInstanceId(instance.id)
    setCredentialDrafts((currentDrafts) => ({
      ...currentDrafts,
      [instance.id]: {
        email: '',
        password: '',
      },
    }))
    setAuthStates((currentStates) => {
      const nextStates = { ...currentStates }
      delete nextStates[instance.id]
      return nextStates
    })
    setConnectorActionError(null)
  }

  function cancelCredentialEdit(instanceId: string) {
    invalidateAuthValidation(instanceId)
    setEditingAuthInstanceId((current) => (current === instanceId ? null : current))
    setCredentialDrafts((currentDrafts) => ({
      ...currentDrafts,
      [instanceId]: {
        email: '',
        password: '',
      },
    }))
    setAuthStates((currentStates) => ({
      ...currentStates,
      [instanceId]: {
        kind: 'cancelled',
        message: 'Credential update cancelled.',
      },
    }))
  }

  function updateCredentialDraft(
    instanceId: string,
    patch: Partial<ConnectorAuthCredentialDraft>,
  ) {
    setCredentialDrafts((currentDrafts) => ({
      ...currentDrafts,
      [instanceId]: {
        email: currentDrafts[instanceId]?.email ?? '',
        password: currentDrafts[instanceId]?.password ?? '',
        ...patch,
      },
    }))
  }

  function saveAndValidateJobrightCredentials(instance: ConnectorSettingsInstance) {
    const credentials = credentialDrafts[instance.id] ?? { email: '', password: '' }
    const email = credentials.email.trim()
    const password = credentials.password
    const secretKey = jobrightSecretKeyForInstance(instance.id)

    if (email.length === 0 || password.length === 0) {
      setAuthStates((currentStates) => ({
        ...currentStates,
        [instance.id]: {
          kind: 'local',
          message: 'Enter a Jobright email and password before validating.',
          status: 'action_required',
        },
      }))
      return
    }

    const generation = nextAuthValidationGeneration(instance.id)
    setAuthenticatingInstanceId(instance.id)
    setConnectorActionError(null)
    setAuthStates((currentStates) => ({
      ...currentStates,
      [instance.id]: {
        kind: 'checking',
        message: 'Saving and validating Jobright credentials...',
      },
    }))

    void profileApi.secrets.upsert({
      key: secretKey,
      kind: 'password',
      label: 'Jobright username and password',
      value: JSON.stringify({ username: email, password }),
    })
      .then(() => connectorsApi.update({
        connectorInstanceId: instance.id,
        auth: [
          {
            id: 'jobright',
            label: 'Jobright username and password',
            mode: 'username_password',
            secretKey,
          },
        ],
      }))
      .then(async (updated) => ({
        result: await connectorsApi.status.reconnect({ connectorInstanceId: updated.id }),
        updated,
      }))
      .then(async ({ result, updated }) => {
        if (!isCurrentAuthValidationGeneration(instance.id, generation)) {
          return
        }

        const refreshed = await connectorsApi.list().catch(() => ({
          items: instances.map((currentInstance) =>
            currentInstance.id === updated.id ? updated : currentInstance),
        }))

        if (!isCurrentAuthValidationGeneration(instance.id, generation)) {
          return
        }

        setInstances(refreshed.items)
        setAuthStates((currentStates) => ({
          ...currentStates,
          [instance.id]: {
            kind: 'result',
            result,
          },
        }))
        onConnectorChanged()
      })
      .catch((error) => {
        if (!isCurrentAuthValidationGeneration(instance.id, generation)) {
          return
        }

        setAuthStates((currentStates) => ({
          ...currentStates,
          [instance.id]: {
            kind: 'local',
            message: sanitizedConnectorAuthErrorMessage(error),
            status: 'failed',
          },
        }))
        setConnectorActionError('Jobright credentials could not be saved or validated.')
      })
      .finally(() => {
        if (!isCurrentAuthValidationGeneration(instance.id, generation)) {
          return
        }

        setCredentialDrafts((currentDrafts) => ({
          ...currentDrafts,
          [instance.id]: {
            email: '',
            password: '',
          },
        }))
        setEditingAuthInstanceId((current) => (current === instance.id ? null : current))
        setAuthenticatingInstanceId(null)
      })
  }

  function revalidateJobrightCredentials(instance: ConnectorSettingsInstance) {
    const generation = nextAuthValidationGeneration(instance.id)
    setAuthenticatingInstanceId(instance.id)
    setConnectorActionError(null)
    setAuthStates((currentStates) => ({
      ...currentStates,
      [instance.id]: {
        kind: 'checking',
        message: 'Checking Jobright credentials...',
      },
    }))

    void connectorsApi.status.reconnect({ connectorInstanceId: instance.id })
      .then((result) => {
        if (!isCurrentAuthValidationGeneration(instance.id, generation)) {
          return
        }

        setAuthStates((currentStates) => ({
          ...currentStates,
          [instance.id]: {
            kind: 'result',
            result,
          },
        }))
        onConnectorChanged()
      })
      .catch((error) => {
        if (!isCurrentAuthValidationGeneration(instance.id, generation)) {
          return
        }

        setAuthStates((currentStates) => ({
          ...currentStates,
          [instance.id]: {
            kind: 'local',
            message: sanitizedConnectorAuthErrorMessage(error),
            status: 'failed',
          },
        }))
      })
      .finally(() => {
        if (isCurrentAuthValidationGeneration(instance.id, generation)) {
          setAuthenticatingInstanceId(null)
        }
      })
  }

  function updateDraft(instanceId: string, patch: Partial<ConnectorSettingsDraft>) {
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [instanceId]: {
        ...defaultConnectorSettingsDraft(instances.find((instance) => instance.id === instanceId)),
        ...currentDrafts[instanceId],
        ...patch,
      },
    }))
  }

  function saveConnectorSettings(instance: ConnectorSettingsInstance) {
    if (instance.connectorId !== JOBRIGHT_CONNECTOR_ID) {
      return
    }

    if (savingInstanceIds.has(instance.id)) {
      return
    }

    const draft = drafts[instance.id] ?? defaultConnectorSettingsDraft(instance)
    const savedDraft = defaultConnectorSettingsDraft(instance)
    const earliestValidation = validateSelectableEarliestBackfillDate({
      candidate: draft.earliestBackfillDate,
      createdAt: instance.createdAt,
      todayUtc: maximumSelectableEarliestBackfillDate(new Date().toISOString()),
    })
    if (!earliestValidation.ok) {
      setConnectorActionError(earliestValidation.message)
      return
    }
    const discoveryCount = parseBoundedInteger(
      draft.discoveryCount,
      JOBRIGHT_MIN_DISCOVERY_COUNT,
      JOBRIGHT_MAX_DISCOVERY_COUNT,
    )
    if (discoveryCount === null) {
      setConnectorActionError(
        `Discovery page size must be an integer from ${JOBRIGHT_MIN_DISCOVERY_COUNT} to ${JOBRIGHT_MAX_DISCOVERY_COUNT}.`,
      )
      return
    }

    const existingConfig = recordFromUnknown(instance.config)
    const nextConfig: Record<string, unknown> = {}
    for (const key of ['maxRetryAttemptsPerSource', 'maxRunElapsedMs'] as const) {
      if (typeof existingConfig[key] === 'number') nextConfig[key] = existingConfig[key]
    }
    if (
      draft.discoveryCount !== savedDraft.discoveryCount
      || Object.prototype.hasOwnProperty.call(existingConfig, 'discoveryCount')
    ) {
      nextConfig.discoveryCount = discoveryCount
    }

    setConnectorActionError(null)
    setSavingInstanceIds((currentIds) => {
      const nextIds = new Set(currentIds)
      nextIds.add(instance.id)
      return nextIds
    })
    void connectorsApi.update({
      connectorInstanceId: instance.id,
      config: nextConfig,
      ...(draft.earliestBackfillDate !== savedDraft.earliestBackfillDate
        ? { earliestBackfillDate: earliestValidation.value }
        : {}),
      filters: {},
    })
      .then((updated) => {
        setInstances((currentInstances) => currentInstances.map((currentInstance) =>
          currentInstance.id === updated.id ? updated : currentInstance,
        ))
        setDrafts((currentDrafts) => ({
          ...currentDrafts,
          [updated.id]: defaultConnectorSettingsDraft(updated),
        }))
        onConnectorChanged()
      })
      .catch(() => {
        setConnectorActionError('Jobright settings could not be saved.')
      })
      .finally(() => {
        setSavingInstanceIds((currentIds) => {
          const nextIds = new Set(currentIds)
          nextIds.delete(instance.id)
          return nextIds
        })
      })
  }

  function discardConnectorSettings(instance: ConnectorSettingsInstance) {
    setConnectorActionError(null)
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [instance.id]: defaultConnectorSettingsDraft(instance),
    }))
  }

  function isConnectorSettingsDraftDirty(instance: ConnectorSettingsInstance): boolean {
    const draft = drafts[instance.id] ?? defaultConnectorSettingsDraft(instance)
    const saved = defaultConnectorSettingsDraft(instance)
    return draft.discoveryCount !== saved.discoveryCount
      || draft.earliestBackfillDate !== saved.earliestBackfillDate
  }

  function hasInvalidEarliestBackfillDraft(instance: ConnectorSettingsInstance): boolean {
    const draft = drafts[instance.id] ?? defaultConnectorSettingsDraft(instance)
    return !validateSelectableEarliestBackfillDate({
      candidate: draft.earliestBackfillDate,
      createdAt: instance.createdAt,
      todayUtc: maximumSelectableEarliestBackfillDate(new Date().toISOString()),
    }).ok
  }

  function runConnectorNow(instance: ConnectorSettingsInstance) {
    if (instance.connectorId !== JOBRIGHT_CONNECTOR_ID) {
      return
    }

    if (savingInstanceIds.has(instance.id)) {
      setConnectorActionError(
        'Wait for connector settings to finish saving before running.',
      )
      return
    }

    if (isConnectorSettingsDraftDirty(instance)) {
      setConnectorActionError(
        'Save or discard your unsaved connector settings before running.',
      )
      return
    }

    if (hasInvalidEarliestBackfillDraft(instance)) {
      setConnectorActionError(
        'Choose a valid earliest backfill date before running.',
      )
      return
    }

    setConnectorActionError(null)
    setRunningInstanceId(instance.id)
    setLatestRunStatuses((currentStatuses) => ({
      ...currentStatuses,
      [instance.id]: 'running',
    }))
    void connectorsApi.runs.trigger({
      connectorInstanceId: instance.id,
      mode: 'manual',
      coverageEndedAt: new Date().toISOString(),
    })
      .then((run) => {
        setLatestRuns((currentRuns) => ({
          ...currentRuns,
          [instance.id]: run,
        }))
        setLatestRunStatuses((currentStatuses) => ({
          ...currentStatuses,
          [instance.id]: run.status,
        }))
      })
      .catch(() => {
        setConnectorActionError('Jobright run could not be completed.')
        setLatestRunStatuses((currentStatuses) => ({
          ...currentStatuses,
          [instance.id]: 'failed',
        }))
      })
      .finally(() => {
        setRunningInstanceId(null)
        onRunSettled()
      })
  }

  return (
    <section aria-labelledby="connector-settings-title" className="space-y-7">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          {displayMode === 'main' ? (
            <p className="text-xs font-medium uppercase text-muted-foreground">Run desk</p>
          ) : null}
          <h2 id="connector-settings-title" className="text-xl font-semibold text-foreground">
            {displayMode === 'main' ? 'Operate connectors' : 'Connectors'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {displayMode === 'main'
              ? 'Authenticate, tune, and start API-only sourcing from one place.'
              : 'Add sources and manage connector auth for this workspace.'}
          </p>
        </div>
        {onOpenSourcingRuns ? (
          <Button type="button" variant="outline" onClick={() => onOpenSourcingRuns()}>
            View connector runs
          </Button>
        ) : null}
      </div>

      {connectorActionError ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Connector action failed</AlertTitle>
          <AlertDescription>{connectorActionError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Jobright internslist</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Authenticate with Jobright API credentials and run connector refresh.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={isAdding}
            onClick={addJobrightConnector}
          >
            {isAdding ? 'Adding...' : 'Add Jobright connector'}
          </Button>
        </div>
      </div>

      {instances.length === 0 ? (
        <Empty
          aria-label="Empty connector instances"
          className="flex-none gap-3 rounded-md border border-solid border-border bg-card p-6"
        >
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Cable aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h3>No connector instances</h3>
            </EmptyTitle>
            <EmptyDescription>
              Add the Jobright connector above to configure authentication and schedules.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="min-w-0 space-y-3 overflow-hidden rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          <p>{instances.length} connector instance{instances.length === 1 ? '' : 's'} configured.</p>
          <div className="divide-y divide-border rounded-md border border-border">
            {instances.map((instance) => {
              const scheduleState = scheduleStates[instance.id] ?? createInitialInstanceScheduleState()
              return (
              <ConnectorSettingsInstanceCard
                key={instance.id}
                instance={instance}
                authState={authStates[instance.id] ?? { kind: 'idle' as const }}
                draft={drafts[instance.id] ?? defaultConnectorSettingsDraft(instance)}
                credentialDraft={credentialDrafts[instance.id] ?? { email: '', password: '' }}
                isEditingAuth={editingAuthInstanceId === instance.id}
                latestRun={latestRuns[instance.id]}
                latestRunStatus={latestRunStatuses[instance.id]}
                isSavingSettings={savingInstanceIds.has(instance.id)}
                authenticatingInstanceId={authenticatingInstanceId}
                runningInstanceId={runningInstanceId}
                schedulingCapability={schedulingCapability}
                capabilityLoadError={capabilityLoadError}
                scheduleCanonical={scheduleState.canonical}
                scheduleDraft={scheduleState.draft}
                scheduleIsDirty={isScheduleDraftDirty(
                  scheduleState.draft,
                  scheduleState.canonical,
                )}
                scheduleIsLoading={scheduleState.isLoading && Boolean(schedulingCapability?.available)}
                scheduleIsSaving={scheduleState.isSaving}
                scheduleStatusMessage={scheduleState.statusMessage}
                scheduleStatusTone={scheduleState.statusTone}
                onBeginCredentialEdit={beginCredentialEdit}
                onCancelCredentialEdit={cancelCredentialEdit}
                onUpdateCredentialDraft={updateCredentialDraft}
                onSaveAndValidateCredentials={saveAndValidateJobrightCredentials}
                onRevalidateCredentials={revalidateJobrightCredentials}
                onUpdateDraft={updateDraft}
                onSaveSettings={saveConnectorSettings}
                onDiscardSettings={discardConnectorSettings}
                onRunNow={runConnectorNow}
                isDraftDirty={isConnectorSettingsDraftDirty}
                onOpenSourcingRuns={onOpenSourcingRuns}
                onScheduleDraftChange={updateScheduleDraft}
                onSaveSchedule={saveConnectorSchedule}
                onDiscardSchedule={discardConnectorSchedule}
                onPauseSchedule={pauseConnectorSchedule}
                onResumeSchedule={resumeConnectorSchedule}
              />
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
