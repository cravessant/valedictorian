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
import { typography, typographyClass } from '@/components/ui/typography'
import type { InstalledConnectorDescriptor } from 'sparxie'
import { LoadFailureView } from '@/components/ui/load-failure-view'
import { useToast } from '@/components/ui/use-toast'
import {
  ownedLoadFailure,
  presentLoadFailure,
  type ErrorPresentation,
} from '../app/error-presentation'
import type { ProfilePreloadApi } from '../ipc/profile.preload'
import {
  JOBRIGHT_CONNECTOR_ID,
  JOBRIGHT_CONNECTOR_VERSION,
} from '../modules/connectors/jobright.constants'
import {
  defaultConnectorSettingsDraft,
  jobrightSecretKeyForInstance,
  sanitizedConnectorAuthErrorMessage,
  sanitizedConnectorCreateErrorMessage,
  sanitizedJobrightCredentialActionErrorMessage,
  shouldAutoValidateJobrightAuth,
  type JobrightCredentialActionStage,
} from './connector-settings.helpers'
import {
  omitRecordKey,
  selectInstalledConnectorDescriptor,
} from './connector-instance-settings-mutations'
import {
  removeConnectorInstance,
  runConnectorInstanceNow,
  saveConnectorInstanceSettings,
} from './connector-instance-owned-mutations'
import {
  describeConnectorCredentialBlockReason,
  isConnectorCredentialDraftReady,
} from './connector-action-state'
import type {
  ConnectorAuthCredentialDraft,
  ConnectorAuthUiState,
  ConnectorSettingsDraft,
  ConnectorSettingsInstance,
  ConnectorSettingsRun,
  ConnectorSettingsUiApi,
} from './connector-settings.types'
import { ConnectorSettingsInstanceCard } from './ConnectorSettingsInstanceCard'
import type { ConnectorScheduleUiApi } from './connector-schedule.types'
import {
  createInitialInstanceScheduleState,
  useConnectorInstanceSchedules,
} from './useConnectorInstanceSchedules'

type RendererBackendBinding = {
  onBackendStateChanged?(listener: (state: { status: string }) => void): () => void
  retryBackend?(): Promise<void>
}

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
  connectorsApi: ConnectorSettingsUiApi
  connectorScheduleApi: ConnectorScheduleUiApi
  displayMode?: 'main' | 'settings'
  onConnectorChanged?: () => void
  onOpenSourcingRuns?: (runId?: string) => void
  onRunSettled: () => void
  profileApi: ProfilePreloadApi
  workspaceId: string | null
}) {
  const [instances, setInstances] = useState<ConnectorSettingsInstance[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'unavailable'>('loading')
  const [listLoadFailure, setListLoadFailure] = useState<ErrorPresentation | null>(null)
  const hasLoadedInstancesRef = useRef(false)
  const workspaceIdentityRef = useRef(workspaceId)
  const [loadGeneration, setLoadGeneration] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, ConnectorSettingsDraft>>({})
  const [descriptors, setDescriptors] = useState<Record<string, InstalledConnectorDescriptor>>({})
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, ConnectorAuthCredentialDraft>>({})
  const [editingAuthInstanceId, setEditingAuthInstanceId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [authenticatingInstanceId, setAuthenticatingInstanceId] = useState<string | null>(null)
  const [authStates, setAuthStates] = useState<Record<string, ConnectorAuthUiState>>({})
  const [credentialEditFeedback, setCredentialEditFeedback] = useState<Record<string, string>>({})
  const [savingInstanceIds, setSavingInstanceIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [removingInstanceIds, setRemovingInstanceIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [runningInstanceIds, setRunningInstanceIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [latestRunStatuses, setLatestRunStatuses] = useState<Record<string, string>>({})
  const [latestRuns, setLatestRuns] = useState<Record<string, ConnectorSettingsRun>>({})
  const [connectorActionError, setConnectorActionError] = useState<string | null>(null)
  const [settingsSaveErrors, setSettingsSaveErrors] = useState<Record<string, string>>({})
  const authValidationGenerations = useRef<Record<string, number>>({})
  const settingsSaveGenerations = useRef<Record<string, number>>({})
  const runGenerations = useRef<Record<string, number>>({})
  const createTargetEpochRef = useRef(0)
  const isMountedRef = useRef(true)
  const backendGeneration = useRef(0)
  const runningInstanceIdsRef = useRef(runningInstanceIds)
  runningInstanceIdsRef.current = runningInstanceIds
  const { toast } = useToast()
  const {
    capabilityLoadError,
    discardConnectorSchedule,
    isScheduleDraftDirty,
    pauseConnectorSchedule,
    reloadSchedules,
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
    const rendererBinding = (window as Window & {
      valedictorianHttp?: RendererBackendBinding
    }).valedictorianHttp

    return rendererBinding?.onBackendStateChanged?.((state) => {
      backendGeneration.current += 1
      if (state.status === 'available') {
        setLoadGeneration((generation) => generation + 1)
      } else {
        setInstances([])
        hasLoadedInstancesRef.current = false
        setListLoadFailure({
          message: 'Connector state could not be loaded.',
          retryable: true,
          surface: 'scoped_load',
          title: 'Load failed',
        })
        setLoadState('unavailable')
      }
    })
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    createTargetEpochRef.current += 1
    setIsAdding(false)
    setSavingInstanceIds(new Set())
    setRemovingInstanceIds(new Set())
    setRunningInstanceIds(new Set())
    return () => {
      isMountedRef.current = false
    }
  }, [connectorsApi, workspaceId])


  useEffect(() => {
    if (runningInstanceIds.size === 0) {
      return
    }

    let cancelled = false
    const pollTimers = new Map<string, ReturnType<typeof setTimeout>>()

    const pollInstance = async (instanceId: string) => {
      try {
        const result = await connectorsApi.runs.list({
          connectorInstanceId: instanceId,
          limit: 1,
          offset: 0,
        })
        const run = result.items[0]

        if (cancelled || !runningInstanceIdsRef.current.has(instanceId)) {
          return
        }

        if (run) {
          setLatestRuns((currentRuns) => ({ ...currentRuns, [instanceId]: run }))
          setLatestRunStatuses((currentStatuses) => ({
            ...currentStatuses,
            [instanceId]: run.status,
          }))
        }

        if (!run || run.status === 'queued' || run.status === 'running') {
          pollTimers.set(instanceId, setTimeout(() => {
            void pollInstance(instanceId)
          }, 500))
        }
      } catch {
        if (!cancelled && runningInstanceIdsRef.current.has(instanceId)) {
          pollTimers.set(instanceId, setTimeout(() => {
            void pollInstance(instanceId)
          }, 1_000))
        }
      }
    }

    for (const instanceId of runningInstanceIds) {
      void pollInstance(instanceId)
    }

    return () => {
      cancelled = true
      for (const timer of pollTimers.values()) {
        clearTimeout(timer)
      }
    }
  }, [connectorsApi, runningInstanceIds])

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
    const requestGeneration = backendGeneration.current
    const validationGenerations = authValidationGenerations.current
    const workspaceChanged = workspaceIdentityRef.current !== workspaceId
    workspaceIdentityRef.current = workspaceId

    if (workspaceChanged) {
      setInstances([])
      setDescriptors({})
      hasLoadedInstancesRef.current = false
      setListLoadFailure(null)
    }

    setLoadState('loading')

    Promise.all([
      connectorsApi.list(),
      connectorsApi.descriptors?.list() ?? Promise.resolve({ items: [] }),
    ])
      .then(async ([result, descriptorResult]) => {
        if (cancelled || requestGeneration !== backendGeneration.current) {
          return
        }

        setInstances(result.items)
        setDescriptors(Object.fromEntries(descriptorResult.items.map((descriptor) => [
          `${descriptor.connectorId}\u0000${descriptor.connectorVersion}`,
          descriptor,
        ])))
        hasLoadedInstancesRef.current = true
        setListLoadFailure(null)
        setLoadState('loaded')

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
      .catch((error: unknown) => {
        if (!cancelled && requestGeneration === backendGeneration.current) {
          const failure = ownedLoadFailure(presentLoadFailure(error, {
            fallbackMessage: 'Connector state could not be loaded.',
            hasStaleData: hasLoadedInstancesRef.current,
            trigger: hasLoadedInstancesRef.current ? 'refresh' : 'load',
          }))
          setListLoadFailure(failure)
          if (!failure && !hasLoadedInstancesRef.current) {
            hasLoadedInstancesRef.current = true
          }
          setLoadState(hasLoadedInstancesRef.current || !failure ? 'loaded' : 'unavailable')
        }
      })

    return () => {
      cancelled = true
      for (const instanceId of Object.keys(validationGenerations)) {
        validationGenerations[instanceId] = (validationGenerations[instanceId] ?? 0) + 1
      }
    }
  }, [connectorsApi, loadGeneration, workspaceId])

  function addJobrightConnector() {
    const epochAtStart = createTargetEpochRef.current
    setConnectorActionError(null)
    setIsAdding(true)
    void connectorsApi.create({
      id: crypto.randomUUID(),
      connectorId: JOBRIGHT_CONNECTOR_ID,
      connectorVersion: JOBRIGHT_CONNECTOR_VERSION,
      displayName: 'Jobright internslist',
      enabled: false,
      auth: [
        {
          id: 'jobright',
          label: 'Jobright username and password',
          mode: 'username_password',
        },
      ],
      config: {},
      filters: { country: 'US' },
    })
      .then((created) => {
        if (!isMountedRef.current || createTargetEpochRef.current !== epochAtStart) {
          return
        }
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
      .catch((error) => {
        if (!isMountedRef.current || createTargetEpochRef.current !== epochAtStart) {
          return
        }
        setConnectorActionError(sanitizedConnectorCreateErrorMessage(error))
      })
      .finally(() => {
        if (!isMountedRef.current || createTargetEpochRef.current !== epochAtStart) {
          return
        }
        setIsAdding(false)
      })
  }

  const hasJobrightInstance = instances.some(
    (instance) => instance.connectorId === JOBRIGHT_CONNECTOR_ID,
  )

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
      const existing = currentStates[instance.id]
      // Drop only in-flight checks so settled verified/expired/failed status stays visible.
      if (existing?.kind !== 'checking') {
        return currentStates
      }
      const nextStates = { ...currentStates }
      delete nextStates[instance.id]
      return nextStates
    })
    setCredentialEditFeedback((current) => {
      if (!(instance.id in current)) {
        return current
      }
      const next = { ...current }
      delete next[instance.id]
      return next
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
    setCredentialEditFeedback((current) => ({
      ...current,
      [instanceId]: 'Credential update cancelled.',
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
    const credentialBlockReason = describeConnectorCredentialBlockReason(credentials)
    let actionStage: JobrightCredentialActionStage = 'saving'

    if (!isConnectorCredentialDraftReady(credentials) || credentialBlockReason) {
      setAuthStates((currentStates) => ({
        ...currentStates,
        [instance.id]: {
          kind: 'local',
          message: credentialBlockReason
            ?? 'Enter a Jobright email and password before validating.',
          status: 'action_required',
        },
      }))
      return
    }

    const generation = nextAuthValidationGeneration(instance.id)
    setAuthenticatingInstanceId(instance.id)
    setConnectorActionError(null)
    setCredentialEditFeedback((current) => {
      if (!(instance.id in current)) {
        return current
      }
      const next = { ...current }
      delete next[instance.id]
      return next
    })
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
      .then(() => {
        actionStage = 'attaching'
        return connectorsApi.update({
          connectorInstanceId: instance.id,
          auth: [
            {
              id: 'jobright',
              label: 'Jobright username and password',
              mode: 'username_password',
              secretKey,
            },
          ],
        })
      })
      .then(async (updated) => {
        actionStage = 'validating'
        return {
          result: await connectorsApi.status.reconnect({ connectorInstanceId: updated.id }),
          updated,
        }
      })
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

        setConnectorActionError(null)
        setAuthStates((currentStates) => ({
          ...currentStates,
          [instance.id]: {
            kind: 'local',
            message: sanitizedJobrightCredentialActionErrorMessage(actionStage, error),
            status: 'failed',
          },
        }))
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
    setCredentialEditFeedback((current) => {
      if (!(instance.id in current)) {
        return current
      }
      const next = { ...current }
      delete next[instance.id]
      return next
    })
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
    setSettingsSaveErrors((currentErrors) => omitRecordKey(currentErrors, instanceId))
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
    saveConnectorInstanceSettings({
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
    })
  }

  function discardConnectorSettings(instance: ConnectorSettingsInstance) {
    setConnectorActionError(null)
    setSettingsSaveErrors((currentErrors) => omitRecordKey(currentErrors, instance.id))
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [instance.id]: defaultConnectorSettingsDraft(instance),
    }))
  }

  function removeConnector(instance: ConnectorSettingsInstance) {
    removeConnectorInstance({
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
    })
  }

  function isConnectorSettingsDraftDirty(instance: ConnectorSettingsInstance): boolean {
    const draft = drafts[instance.id] ?? defaultConnectorSettingsDraft(instance)
    const saved = defaultConnectorSettingsDraft(instance)
    return draft.enabled !== saved.enabled
      || JSON.stringify(draft.config) !== JSON.stringify(saved.config)
      || JSON.stringify(draft.filters) !== JSON.stringify(saved.filters)
      || (instance.connectorId === JOBRIGHT_CONNECTOR_ID
        && draft.earliestBackfillDate !== saved.earliestBackfillDate)
  }

  function runConnectorNow(instance: ConnectorSettingsInstance) {
    runConnectorInstanceNow({
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
    })
  }

  return (
    <section aria-labelledby="connector-settings-title" className="space-y-7">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          {displayMode === 'main' ? (
            <p className={typography.pageEyebrow}>Run desk</p>
          ) : null}
          <h2 id="connector-settings-title" className={typography.sectionTitle}>
            {displayMode === 'main' ? 'Operate connectors' : 'Connectors'}
          </h2>
          <p className={typography.sectionDescription}>
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
          <AlertTitle>
            {connectorActionError.startsWith('Credentials ')
              ? 'Jobright credential setup incomplete'
              : 'Connector action failed'}
          </AlertTitle>
          <AlertDescription>{connectorActionError}</AlertDescription>
        </Alert>
      ) : null}

      {listLoadFailure ? (
        <LoadFailureView
          failure={listLoadFailure}
          onRetry={() => {
            void (window as Window & { valedictorianHttp?: RendererBackendBinding })
              .valedictorianHttp?.retryBackend?.()
            setLoadGeneration((generation) => generation + 1)
          }}
        />
      ) : null}

      {loadState === 'loaded' && !hasJobrightInstance ? (
      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h3 className={typography.panelTitle}>Jobright internslist</h3>
            <p className={typography.sectionDescription}>
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
      ) : null}

      {loadState === 'loading' && instances.length === 0 ? (
        <div className="min-w-0 space-y-3 overflow-hidden rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          Loading connector instances...
        </div>
      ) : instances.length === 0 && !listLoadFailure ? (
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
      ) : instances.length > 0 ? (
        <div className={typographyClass('muted', 'min-w-0 space-y-3')}>
          <p>{instances.length} connector instance{instances.length === 1 ? '' : 's'} configured.</p>
          <div className="grid gap-3">
            {instances.map((instance) => {
              const scheduleState = scheduleStates[instance.id] ?? createInitialInstanceScheduleState()
              const descriptor = selectInstalledConnectorDescriptor(
                Object.values(descriptors),
                instance.connectorId,
                instance.connectorVersion,
              )
              return (
              <ConnectorSettingsInstanceCard
                key={instance.id}
                instance={instance}
                authState={authStates[instance.id] ?? { kind: 'idle' as const }}
                credentialEditFeedback={credentialEditFeedback[instance.id] ?? null}
                draft={drafts[instance.id] ?? defaultConnectorSettingsDraft(instance)}
                descriptor={descriptor}
                connectorsApi={connectorsApi}
                credentialDraft={credentialDrafts[instance.id] ?? { email: '', password: '' }}
                isEditingAuth={editingAuthInstanceId === instance.id}
                latestRun={latestRuns[instance.id]}
                latestRunStatus={latestRunStatuses[instance.id]}
                isSavingSettings={savingInstanceIds.has(instance.id)}
                settingsSaveError={settingsSaveErrors[instance.id] ?? null}
                isRemoving={removingInstanceIds.has(instance.id)}
                authenticatingInstanceId={authenticatingInstanceId}
                runningInstanceIds={runningInstanceIds}
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
                scheduleLoadFailure={scheduleState.loadFailure}
                scheduleStatusMessage={scheduleState.statusMessage}
                scheduleStatusTone={scheduleState.statusTone}
                scheduleValidationField={scheduleState.validationField}
                onBeginCredentialEdit={beginCredentialEdit}
                onCancelCredentialEdit={cancelCredentialEdit}
                onUpdateCredentialDraft={updateCredentialDraft}
                onSaveAndValidateCredentials={saveAndValidateJobrightCredentials}
                onRevalidateCredentials={revalidateJobrightCredentials}
                onUpdateDraft={updateDraft}
                onSaveSettings={saveConnectorSettings}
                onDiscardSettings={discardConnectorSettings}
                onRunNow={runConnectorNow}
                onRemove={removeConnector}
                isDraftDirty={isConnectorSettingsDraftDirty}
                onOpenSourcingRuns={onOpenSourcingRuns}
                onScheduleDraftChange={updateScheduleDraft}
                onSaveSchedule={saveConnectorSchedule}
                onDiscardSchedule={discardConnectorSchedule}
                onPauseSchedule={pauseConnectorSchedule}
                onResumeSchedule={resumeConnectorSchedule}
                onRetryScheduleLoad={reloadSchedules}
              />
              )
            })}
          </div>
        </div>
      ) : null}
    </section>
  )
}
