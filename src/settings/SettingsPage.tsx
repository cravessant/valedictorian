import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { AlertCircle, ArrowLeft, Bot, Brush, CircleUserRound, Cog, Database, FolderOpen, Globe2, KeyRound, Monitor, Search, Server, ShieldCheck, SlidersHorizontal, Terminal } from 'lucide-react'
import {
  defaultPolicyConfig,
  isPolicyEvidenceTag,
  type PolicyConfig,
  type PolicyConfigPatch,
  type PolicyEvidenceTag,
} from 'sparxie'
import type { PolicyPreloadApi } from '../ipc/policy.preload'
import type { ProfilePreloadApi } from '../ipc/profile.preload'
import {
  JOBRIGHT_CONNECTOR_ID,
  JOBRIGHT_CONNECTOR_VERSION,
} from '../modules/connectors/jobright.constants'
import type { ConnectorsPreloadApi } from '../ipc/connectors.preload'
import type { WorkspacePreloadApi } from '../ipc/workspace.preload'
import type { AppSettings, AppSettingsPatch } from './app-settings'
import { SETTINGS_PANELS, type SettingsPanelId } from '../app/types'
import { SettingsToggleRow } from '../app/AppChrome'
import { ProfileSettingsPanel } from '../modules/profile/ProfileSettingsPanel'
import { SettingsTextInput } from './SettingsTextInput'
import type { WorkspaceSummary } from '../workspace/workspace.initializer'
import type { ConnectorRunLifecycleCounts } from '../modules/connectors/connector.lifecycle-counts'
import { connectorRunTerminalCopy } from '../modules/connectors/connector.run-presentation'

interface SettingsPageProps {
  connectorsApi: ConnectorsPreloadApi
  contentColumnClass: string
  policyApi: PolicyPreloadApi
  profileApi: ProfilePreloadApi
  restartRequired: boolean
  selectedPanel: SettingsPanelId
  settings: AppSettings
  workspace: WorkspaceSummary | null
  workspaceApi: WorkspacePreloadApi
  onConnectorRunSettled: () => void
  onOpenSourcingRuns: (runId?: string) => void
  onSettingsPatch: (patch: AppSettingsPatch) => void
}

interface SettingsSidebarProps {
  selectedPanel: SettingsPanelId
  temporary: boolean
  onBack: () => void
  onMouseLeave: () => void
  onPanelChange: (panel: SettingsPanelId) => void
}

interface SettingsNavItem {
  icon: ReactNode
  id: SettingsPanelId
  label: string
}

interface SettingsNavGroup {
  group: string
  items: SettingsNavItem[]
}

const settingsNavGroups: SettingsNavGroup[] = [
  {
    group: 'Personal',
    items: [
      {
        icon: <CircleUserRound className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.PROFILE,
        label: 'Profile',
      },
      {
        icon: <Cog className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.GENERAL,
        label: 'General',
      },
      {
        icon: <Brush className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.APPEARANCE,
        label: 'Appearance',
      },
    ],
  },
  {
    group: 'Integrations',
    items: [
      {
        icon: <Database className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.CONFIGURATION,
        label: 'Configuration',
      },
      {
        icon: <Globe2 className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.CONNECTORS,
        label: 'Connectors',
      },
      {
        icon: <Terminal className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.AGENT_ACCESS,
        label: 'Agent access',
      },
    ],
  },
  {
    group: 'Automation',
    items: [
      {
        icon: <Bot className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.AGENT_WORKFLOWS,
        label: 'Agent workflows',
      },
      {
        icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.POLICY,
        label: 'Policy',
      },
    ],
  },
  {
    group: 'Advanced',
    items: [
      {
        icon: <KeyRound className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.ADVANCED,
        label: 'Developer settings',
      },
      {
        icon: <Database className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.DATA,
        label: 'Data',
      },
    ],
  },
]

function SettingsSidebar({
  selectedPanel,
  temporary,
  onBack,
  onMouseLeave,
  onPanelChange,
}: SettingsSidebarProps) {
  const [settingsSearch, setSettingsSearch] = useState('')
  const visibleGroups = settingsNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        settingsSearch
          ? `${group.group} ${item.label}`.toLowerCase().includes(settingsSearch.toLowerCase())
          : true,
      ),
    }))
    .filter((group) => group.items.length > 0)

  return (
    <aside
      aria-label="Settings navigation"
      className={`absolute left-0 top-0 z-40 h-full w-[280px] max-w-[85vw] overflow-auto border-r border-border bg-card/80 p-4 shadow-2xl md:h-[calc(100vh-3rem)] md:max-w-none ${
        temporary ? 'md:absolute md:left-0 md:top-0 md:z-40 md:shadow-2xl' : 'md:static md:z-auto md:shadow-none'
      }`}
      role="complementary"
      onMouseLeave={onMouseLeave}
    >
      <Button type="button" variant="ghost" className="mb-4 gap-2 px-2" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to app
      </Button>

      <label className="relative block text-xs font-medium text-muted-foreground">
        <Search className="pointer-events-none absolute left-3 top-8 h-4 w-4 text-muted-foreground" />
        Search settings
        <input
          aria-label="Search settings"
          className="mt-1 h-9 w-full rounded-md border border-border bg-background px-9 text-sm text-foreground"
          placeholder="Search settings..."
          value={settingsSearch}
          onChange={(event) => setSettingsSearch(event.target.value)}
        />
      </label>

      <nav className="mt-5 space-y-5" aria-label="Settings sections">
        {visibleGroups.map((group) => (
          <div key={group.group}>
            <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">{group.group}</p>
            <div className="space-y-1">
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm ${
                    item.id === selectedPanel
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'
                  }`}
                  onClick={() => onPanelChange(item.id)}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )
}

function SettingsPage({
  connectorsApi,
  contentColumnClass,
  policyApi,
  profileApi,
  restartRequired,
  selectedPanel,
  settings,
  workspace,
  workspaceApi,
  onConnectorRunSettled,
  onOpenSourcingRuns,
  onSettingsPatch,
}: SettingsPageProps) {
  const selectedItem = settingsNavGroups
    .flatMap((group) => group.items)
    .find((item) => item.id === selectedPanel)
  const selectedLabel = selectedItem?.label ?? 'General'
  const apiBaseUrl = `http://${settings.localApiHost}:${settings.localApiPort}`

  return (
    <main className={`h-full min-w-0 overflow-auto px-5 py-6 text-foreground md:h-[calc(100vh-3rem)] sm:px-8 lg:px-12 ${contentColumnClass}`}>
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-semibold tracking-normal text-foreground">Settings</h1>
        {restartRequired ? (
          <Alert className="mt-4 bg-card">
            <AlertCircle className="absolute left-4 top-4 h-4 w-4" aria-hidden="true" />
            <div className="pl-7">
              <AlertTitle>Restart required</AlertTitle>
              <AlertDescription>
                Backend mode, API host, port, token, and remote URL changes apply next launch.
              </AlertDescription>
            </div>
          </Alert>
        ) : null}

        <div className="mt-8">
          {selectedPanel === SETTINGS_PANELS.GENERAL ? (
            <GeneralSettingsPanel settings={settings} onSettingsPatch={onSettingsPatch} />
          ) : null}
          {selectedPanel === SETTINGS_PANELS.CONFIGURATION ? (
            <ConfigurationSettingsPanel settings={settings} onSettingsPatch={onSettingsPatch} />
          ) : null}
          {selectedPanel === SETTINGS_PANELS.CONNECTORS ? (
            <ConnectorSettingsPanel
              connectorsApi={connectorsApi}
              onOpenSourcingRuns={onOpenSourcingRuns}
              onRunSettled={onConnectorRunSettled}
              profileApi={profileApi}
            />
          ) : null}
          {selectedPanel === SETTINGS_PANELS.AGENT_ACCESS ? (
            <AgentAccessSettingsPanel
              apiBaseUrl={apiBaseUrl}
              settings={settings}
              workspace={workspace}
            />
          ) : null}
          {selectedPanel === SETTINGS_PANELS.APPEARANCE ? (
            <AppearanceSettingsPanel settings={settings} onSettingsPatch={onSettingsPatch} />
          ) : null}
          {selectedPanel === SETTINGS_PANELS.DATA ? (
            <DataSettingsPanel workspace={workspace} workspaceApi={workspaceApi} />
          ) : null}
          {selectedPanel === SETTINGS_PANELS.PROFILE ? (
            <ProfileSettingsPanel profileApi={profileApi} />
          ) : null}
          {selectedPanel === SETTINGS_PANELS.POLICY ? (
            <PolicySettingsPanel policyApi={policyApi} />
          ) : null}
          {!isFunctionalSettingsPanel(selectedPanel) ? (
            <ComingLaterSettingsPanel label={selectedLabel} />
          ) : null}
        </div>
      </div>
    </main>
  )
}

type ConnectorSettingsInstance = Awaited<ReturnType<ConnectorsPreloadApi['list']>>['items'][number]
type ConnectorReconnectResult = Awaited<ReturnType<ConnectorsPreloadApi['status']['reconnect']>>
type ConnectorSettingsRun = Awaited<ReturnType<ConnectorsPreloadApi['runs']['trigger']>>

interface ConnectorSettingsDraft {
  maxResolutionCount: string
  roleTerms: string
}

interface ConnectorAuthCredentialDraft {
  email: string
  password: string
}

type ConnectorAuthUiState =
  | { kind: 'idle' }
  | { kind: 'checking'; message: string }
  | { kind: 'result'; result: ConnectorReconnectResult }
  | { kind: 'cancelled'; message: string }
  | { kind: 'local'; message: string; status: 'action_required' | 'failed' }

const secureStorageUnavailableMessage =
  'Secure storage is unavailable. Enable platform encryption, then try again.'

function ConnectorSettingsPanel({
  connectorsApi,
  displayMode = 'settings',
  onConnectorChanged = () => undefined,
  onOpenSourcingRuns,
  onRunSettled,
  profileApi,
}: {
  connectorsApi: ConnectorsPreloadApi
  displayMode?: 'main' | 'settings'
  onConnectorChanged?: () => void
  onOpenSourcingRuns?: (runId?: string) => void
  onRunSettled: () => void
  profileApi: ProfilePreloadApi
}) {
  const [instances, setInstances] = useState<ConnectorSettingsInstance[]>([])
  const [drafts, setDrafts] = useState<Record<string, ConnectorSettingsDraft>>({})
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, ConnectorAuthCredentialDraft>>({})
  const [editingAuthInstanceId, setEditingAuthInstanceId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [authenticatingInstanceId, setAuthenticatingInstanceId] = useState<string | null>(null)
  const [authStates, setAuthStates] = useState<Record<string, ConnectorAuthUiState>>({})
  const [savingInstanceId, setSavingInstanceId] = useState<string | null>(null)
  const [runningInstanceId, setRunningInstanceId] = useState<string | null>(null)
  const [latestRunStatuses, setLatestRunStatuses] = useState<Record<string, string>>({})
  const [latestRuns, setLatestRuns] = useState<Record<string, ConnectorSettingsRun>>({})
  const [connectorActionError, setConnectorActionError] = useState<string | null>(null)
  const authValidationGenerations = useRef<Record<string, number>>({})

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
      filters: {
        maxResolutionCount: 10,
        roleTerms: ['intern'],
      },
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
    const draft = drafts[instance.id] ?? defaultConnectorSettingsDraft(instance)
    setConnectorActionError(null)
    setSavingInstanceId(instance.id)
    void connectorsApi.update({
      connectorInstanceId: instance.id,
      config: {},
      filters: {
        maxResolutionCount: normalizePositiveInteger(draft.maxResolutionCount, 10),
        roleTerms: parseCommaSeparatedList(draft.roleTerms),
      },
    })
      .then((updated) => {
        setInstances((currentInstances) => currentInstances.map((currentInstance) =>
          currentInstance.id === updated.id ? updated : currentInstance,
        ))
        onConnectorChanged()
      })
      .catch(() => {
        setConnectorActionError('Jobright settings could not be saved.')
      })
      .finally(() => setSavingInstanceId(null))
  }

  function runConnectorNow(instance: ConnectorSettingsInstance) {
    const coverageEndedAt = new Date().toISOString()
    const coverageStartedAt = new Date(Date.parse(coverageEndedAt) - 60 * 60 * 1000).toISOString()

    setConnectorActionError(null)
    setRunningInstanceId(instance.id)
    setLatestRunStatuses((currentStatuses) => ({
      ...currentStatuses,
      [instance.id]: 'running',
    }))
    void connectorsApi.runs.trigger({
      connectorInstanceId: instance.id,
      coverageEndedAt,
      coverageStartedAt,
      mode: 'manual',
      reason: 'settings_manual_refresh',
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
        <Alert variant="destructive" className="bg-card" role="alert">
          <AlertCircle className="absolute left-4 top-4 h-4 w-4" aria-hidden="true" />
          <div className="pl-7">
            <AlertTitle>Connector action failed</AlertTitle>
            <AlertDescription>{connectorActionError}</AlertDescription>
          </div>
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

      <div className="min-w-0 space-y-3 overflow-hidden rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        {instances.length === 0 ? (
          'No connector instances configured.'
        ) : (
          <>
            <p>{instances.length} connector instance{instances.length === 1 ? '' : 's'} configured.</p>
            <div className="divide-y divide-border rounded-md border border-border">
              {instances.map((instance) => {
                const authConfigured = isJobrightCredentialsConfigured(instance)
                const authState = authStates[instance.id] ?? { kind: 'idle' as const }
                const authReady = isConnectorAuthReady(authState)
                const authLabel = connectorAuthStatusLabel(authState, authConfigured)
                const authMessage = connectorAuthStatusMessage(authState)
                const draft = drafts[instance.id] ?? defaultConnectorSettingsDraft(instance)
                const credentialDraft = credentialDrafts[instance.id] ?? { email: '', password: '' }
                const isEditingAuth = editingAuthInstanceId === instance.id
                const latestRun = latestRuns[instance.id]
                const runMetrics = latestRun ? connectorRunMetrics(latestRun) : []

                return (
                  <div key={instance.id} className="grid gap-4 p-3 text-sm">
                    <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{instance.displayName}</p>
                        <p className="text-xs text-muted-foreground">{instance.connectorId}</p>
                      </div>
                      <div
                        className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end"
                        data-testid={`connector-auth-actions-${instance.id}`}
                      >
                        <p className="text-xs font-medium text-muted-foreground">
                          {authLabel}
                        </p>
                        {!isEditingAuth ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={authenticatingInstanceId === instance.id}
                            onClick={() => beginCredentialEdit(instance)}
                          >
                            {authConfigured ? 'Update credentials' : 'Add credentials'}
                          </Button>
                        ) : null}
                        {authConfigured && !isEditingAuth ? (
                          <Button
                            type="button"
                            size="sm"
                            disabled={authenticatingInstanceId === instance.id}
                            onClick={() => revalidateJobrightCredentials(instance)}
                          >
                            {authenticatingInstanceId === instance.id ? 'Validating...' : 'Validate'}
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {isEditingAuth ? (
                      <div
                        className="grid min-w-0 gap-3 rounded-md border border-border p-3 lg:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto_auto] xl:items-end"
                        data-testid={`connector-credential-form-${instance.id}`}
                      >
                        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                          Jobright email
                          <input
                            aria-label="Jobright email"
                            autoComplete="off"
                            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                            type="email"
                            value={credentialDraft.email}
                            onChange={(event) =>
                              updateCredentialDraft(instance.id, { email: event.target.value })}
                          />
                        </label>
                        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                          Jobright password
                          <input
                            aria-label="Jobright password"
                            autoComplete="new-password"
                            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                            type="password"
                            value={credentialDraft.password}
                            onChange={(event) =>
                              updateCredentialDraft(instance.id, { password: event.target.value })}
                          />
                        </label>
                        <Button
                          type="button"
                          disabled={authenticatingInstanceId === instance.id}
                          onClick={() => saveAndValidateJobrightCredentials(instance)}
                        >
                          {authenticatingInstanceId === instance.id ? 'Validating...' : 'Save and validate'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={authenticatingInstanceId === instance.id}
                          onClick={() => cancelCredentialEdit(instance.id)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Credentials are write-only. Saved values are never shown again.
                      </p>
                    )}

                    {authMessage ? (
                      <p
                        className={authReady
                          ? 'text-xs text-success'
                          : 'text-xs text-warning'}
                        role="status"
                      >
                        {authMessage}
                      </p>
                    ) : null}

                    <div
                      className="grid min-w-0 gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(16rem,1fr)_12rem_auto_auto] xl:items-end"
                      data-testid={`connector-run-actions-${instance.id}`}
                    >
                      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                        Role terms
                        <input
                          aria-label="Role terms"
                          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                          value={draft.roleTerms}
                          onChange={(event) =>
                            updateDraft(instance.id, { roleTerms: event.target.value })}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                        Max links per refresh
                        <input
                          aria-label="Max links per refresh"
                          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                          type="number"
                          value={draft.maxResolutionCount}
                          onChange={(event) =>
                            updateDraft(instance.id, { maxResolutionCount: event.target.value })}
                        />
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={savingInstanceId === instance.id}
                        onClick={() => saveConnectorSettings(instance)}
                      >
                        {savingInstanceId === instance.id ? 'Saving...' : 'Save Jobright settings'}
                      </Button>
                      <Button
                        type="button"
                        disabled={!authReady || runningInstanceId === instance.id}
                        onClick={() => runConnectorNow(instance)}
                      >
                        {runningInstanceId === instance.id ? 'Running...' : 'Run Jobright now'}
                      </Button>
                    </div>
                    {latestRunStatuses[instance.id] ? (
                      <div
                        aria-atomic="true"
                        aria-label={`${instance.displayName} run progress`}
                        aria-live="polite"
                        className="grid gap-2"
                        role="status"
                      >
                        <p className="text-xs font-medium text-muted-foreground">
                          Latest run: {latestRunStatuses[instance.id]}
                        </p>
                        {latestRun ? <ConnectorRunProgressDetails run={latestRun} /> : null}
                        {latestRun ? <ConnectorRunLifecycleDetails run={latestRun} /> : null}
                        {runMetrics.length > 0 ? (
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            {runMetrics.map((metric) => (
                              <span key={metric.label}>{metric.label}: {metric.value}</span>
                            ))}
                          </div>
                        ) : null}
                        {latestRun ? (
                          <Button
                            aria-label={`View ${latestRun.id} in Connector Runs`}
                            className="w-fit"
                            size="sm"
                            type="button"
                            variant="outline"
                            onClick={() => onOpenSourcingRuns?.(latestRun.id)}
                          >
                            View in Connector Runs
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function jobrightSecretKeyForInstance(instanceId: string): string {
  const normalizedInstanceId = instanceId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return `connector_jobright_credentials_${normalizedInstanceId || 'default'}`
}

function isJobrightCredentialsConfigured(instance: ConnectorSettingsInstance): boolean {
  if (instance.connectorId === JOBRIGHT_CONNECTOR_ID) {
    return instance.auth.some((auth) =>
      auth.mode === 'username_password' && auth.configured)
  }

  return instance.auth.some((auth) => auth.configured)
}

function shouldAutoValidateJobrightAuth(instance: ConnectorSettingsInstance): boolean {
  return instance.connectorId === JOBRIGHT_CONNECTOR_ID
    && isJobrightCredentialsConfigured(instance)
}

function isConnectorAuthReady(state: ConnectorAuthUiState): boolean {
  return state.kind === 'result' && state.result.status === 'ready'
}

function connectorAuthStatusLabel(
  state: ConnectorAuthUiState,
  authConfigured: boolean,
): string {
  if (state.kind === 'checking') {
    return 'Checking auth...'
  }

  if (state.kind === 'cancelled') {
    return 'Auth cancelled'
  }

  if (state.kind === 'result') {
    if (state.result.status === 'ready') {
      return 'Auth verified'
    }

    if (state.result.status === 'missing') {
      return 'Auth missing'
    }

    if (state.result.status === 'expired') {
      return 'Auth expired'
    }

    if (state.result.reason === 'secure_storage_unavailable') {
      return 'Auth failed'
    }

    return 'Auth required'
  }

  if (state.kind === 'local') {
    return state.status === 'failed' ? 'Auth failed' : 'Auth required'
  }

  return authConfigured ? 'Credentials stored' : 'Auth required'
}

function connectorAuthStatusMessage(state: ConnectorAuthUiState): string | null {
  if (state.kind === 'checking' || state.kind === 'cancelled' || state.kind === 'local') {
    return state.message
  }

  if (state.kind === 'result') {
    return state.result.message
  }

  return null
}

function sanitizedConnectorAuthErrorMessage(error: unknown): string {
  if (
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'secure_storage_unavailable'
  ) {
    return secureStorageUnavailableMessage
  }

  if (error instanceof Error && error.message.includes('secure_storage_unavailable')) {
    return secureStorageUnavailableMessage
  }

  return 'Jobright credentials could not be validated.'
}

function connectorRunMetrics(run: ConnectorSettingsRun): Array<{ label: string; value: number }> {
  const stats = recordFromUnknown(run.stats)
  const failureMetric = numericRunMetric(stats, 'failures', 'Failures')
    ?? numericRunMetric(stats, 'failed', 'Failures')
    ?? (run.status === 'failed' ? { label: 'Failures', value: 1 } : null)
  const metrics = [
    { label: 'Warnings', value: run.warningCount },
    failureMetric,
  ]

  return metrics.filter((metric): metric is { label: string; value: number } => metric !== null)
}

function ConnectorRunLifecycleDetails({ run }: { run: ConnectorSettingsRun }) {
  const [showExplanation, setShowExplanation] = useState(false)
  const stats = recordFromUnknown(run.stats)
  const lifecycle = connectorRunLifecycleCounts(stats.lifecycleCounts, run.id)
  const terminal = connectorRunTerminalCopy(run)
  const providerGaps = lifecycle && Array.isArray(lifecycle.provider.gaps)
    ? lifecycle.provider.gaps
    : []
  const carried = [
    numericRunMetric(stats, 'discovered', 'Discovered jobs'),
    numericRunMetric(stats, 'discoveryPages', 'Discovery page requests'),
    numericRunMetric(stats, 'attempted', 'Detail attempts'),
    numericRunMetric(stats, 'authRequired', 'Auth-required requests'),
    numericRunMetric(stats, 'retryableFailures', 'Retryable request failures'),
    numericRunMetric(stats, 'resolvedEmployerOrAts', 'Resolved employer / ATS'),
    numericRunMetric(stats, 'resolvedThirdParty', 'Resolved third-party'),
    numericRunMetric(stats, 'remainingTarget', 'Remaining target'),
  ].filter((metric): metric is { label: string; value: number } => metric !== null)

  return (
    <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3 text-xs">
      <div>
        <p className="font-semibold text-foreground">{terminal.summary}</p>
        {terminal.detail ? <p className="mt-1 text-muted-foreground">{terminal.detail}</p> : null}
        {terminal.technical ? <p className="mt-1 text-muted-foreground">{terminal.technical}</p> : null}
      </div>
      {lifecycle ? (
        <>
          <div>
            <p className="font-semibold text-foreground">Unique jobs in this connector run</p>
            <p className="mt-1 text-muted-foreground">
              {lifecycle.source === 'frozen_terminal'
                ? 'Frozen at terminal completion.'
                : lifecycle.source === 'live_current'
                  ? 'Live counts derived from current persisted lineage.'
                  : 'Derived from current persisted lineage for a pre-feature terminal run.'}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3" aria-label="Run lifecycle counts">
            <RunCountStage title="Provider intake" values={[
              ['Provider returned rows', lifecycle.provider.returnedRows],
              ['Valid unique records', lifecycle.provider.validRecords],
              ['Invalid records', lifecycle.provider.invalidRecords],
              ['Source duplicates', lifecycle.provider.sourceDuplicates],
              ['Captured records', lifecycle.provider.capturedRecords],
              ['Capture occurrences', lifecycle.provider.occurrenceCount],
            ]} />
            <RunCountStage title="Destination and normalization" values={[
              ['Normalized', lifecycle.destination.normalized],
              ['Resolved employer / ATS', lifecycle.destination.resolvedEmployerOrAts],
              ['Resolved third-party', lifecycle.destination.resolvedThirdParty],
              ['Pending', lifecycle.destination.pending],
              ['Unresolved', lifecycle.destination.unresolved],
              ['Gate rejected', lifecycle.destination.gateRejected],
            ]} />
            <RunCountStage title="Sourcing" values={[
              ['Added / new', lifecycle.sourcing.added],
              ['Queue duplicate', lifecycle.sourcing.queueDuplicate],
              ['Not fit', lifecycle.sourcing.notFit],
              ['Cutoff / rejected', lifecycle.sourcing.rejected],
              ['Actionable review', lifecycle.sourcing.actionableReview],
            ]} />
          </div>
          {lifecycle.provider.invariant !== 'reconciled'
            || lifecycle.destination.invariant !== 'reconciled'
            || lifecycle.sourcing.invariant !== 'reconciled'
            || lifecycle.provider.captureShortfall > 0
            || lifecycle.provider.unclassifiedRows > 0
            || lifecycle.destination.unclassified > 0
            || lifecycle.sourcing.unclassified > 0 ? (
              <p className="font-medium text-warning">
                Some persisted rows do not reconcile; shortfalls and unclassified records remain visible in the count explanation.
              </p>
            ) : null}
          {providerGaps.length > 0 ? (
            <p className="font-medium text-warning">
              Provider stats gaps: {providerGaps.map(formatProviderStatsGap).join(', ')}.
            </p>
          ) : null}
        </>
      ) : null}
      {carried.length > 0 ? (
        <div>
          <p className="font-semibold text-foreground">Carried connector cycle</p>
          <p className="mt-1 text-muted-foreground">
            Cumulative checkpoint and request details; these are not jobs returned by this run.
          </p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            {carried.map((metric) => (
              <span key={metric.label}>{metric.label}: {metric.value}</span>
            ))}
          </div>
        </div>
      ) : null}
      <Button
        aria-expanded={showExplanation}
        className="w-fit"
        size="sm"
        type="button"
        variant="outline"
        onClick={() => setShowExplanation((shown) => !shown)}
      >
        How these counts work
      </Button>
      {showExplanation ? (
        <div className="grid gap-1 text-muted-foreground">
          <p>Every primary count is scoped to unique jobs captured by this connector run id.</p>
          <p>Returned rows equal valid unique records plus invalid rows plus source duplicates when provider totals reconcile.</p>
          <p>Captured records equal normalized plus pending, unresolved, gate-rejected, and explicitly unclassified records.</p>
          <p>Normalized equals resolved employer / ATS plus resolved third-party jobs.</p>
          <p>Sourcing outcomes partition normalized jobs; only a persisted concrete question counts as actionable review.</p>
          {lifecycle ? (
            <p>
              Visible exceptions: capture shortfall {lifecycle.provider.captureShortfall}; provider unclassified {lifecycle.provider.unclassifiedRows}; destination unclassified {lifecycle.destination.unclassified}; sourcing unclassified {lifecycle.sourcing.unclassified}.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function formatProviderStatsGap(value: string): string {
  return value.replace(/_/g, ' ')
}

function RunCountStage({
  title,
  values,
}: {
  title: string
  values: Array<readonly [string, number]>
}) {
  return (
    <section>
      <h4 className="font-medium text-foreground">{title}</h4>
      <div className="mt-1 grid gap-1 text-muted-foreground">
        {values.map(([label, value]) => <span key={label}>{label}: {value}</span>)}
      </div>
    </section>
  )
}

function connectorRunLifecycleCounts(
  value: unknown,
  connectorRunId: string,
): ConnectorRunLifecycleCounts | null {
  const lifecycle = recordFromUnknown(value)
  const scope = recordFromUnknown(lifecycle.scope)
  if (
    lifecycle.version !== 'connector-run-lifecycle-counts/v1'
    || !['frozen_terminal', 'live_current', 'derived_pre_feature'].includes(
      String(lifecycle.source),
    )
    || scope.kind !== 'connector_run'
    || scope.connectorRunId !== connectorRunId
  ) {
    return null
  }
  return lifecycle as unknown as ConnectorRunLifecycleCounts
}

function ConnectorRunProgressDetails({ run }: { run: ConnectorSettingsRun }) {
  const stats = recordFromUnknown(run.stats)
  const stage = stringFromUnknown(stats.stage)
  const lastProgressAt = stringFromUnknown(stats.lastProgressAt)
  const wait = recordFromUnknown(stats.wait)
  const startedAtMs = Date.parse(run.startedAt)
  const endAtMs = run.completedAt ? Date.parse(run.completedAt) : Date.now()
  const elapsedSeconds = Number.isFinite(startedAtMs) && Number.isFinite(endAtMs)
    ? Math.max(0, Math.floor((endAtMs - startedAtMs) / 1_000))
    : null

  return (
    <div className="grid gap-1 text-xs text-muted-foreground">
      {stage ? <span>Stage: {formatConnectorStage(stage)}</span> : null}
      <span>Started: {run.startedAt}</span>
      {elapsedSeconds !== null ? <span>Elapsed: {elapsedSeconds}s</span> : null}
      {lastProgressAt ? <span>Last progress: {lastProgressAt}</span> : null}
      {Object.keys(wait).length > 0 ? (
        <span>Waiting between bounded Jobright API requests.</span>
      ) : null}
    </div>
  )
}

function formatConnectorStage(stage: string): string {
  return stage
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function numericRunMetric(
  stats: Record<string, unknown>,
  key: string,
  label: string,
): { label: string; value: number } | null {
  const value = stats[key]

  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? { label, value }
    : null
}

interface ConnectorRunHistoryItem {
  connectorId: string
  connectorName: string
  run: ConnectorSettingsRun
}

const CONNECTOR_RUNS_PAGE_SIZE = 20
const CONNECTOR_RUNS_MAX_FOCUS_PAGES = 25

async function loadConnectorRunHistoryPage(
  connectorsApi: ConnectorsPreloadApi,
  offset: number,
): Promise<{
  items: ConnectorRunHistoryItem[]
  hasMore: boolean
}> {
  const { items: instances } = await connectorsApi.list()
  const runLists = await Promise.all(instances.map(async (instance) => {
    const page = await connectorsApi.runs.list({
      connectorInstanceId: instance.id,
      limit: CONNECTOR_RUNS_PAGE_SIZE,
      offset,
    })
    return {
      connectorId: instance.connectorId,
      connectorName: instance.displayName,
      hasMore: page.hasMore,
      runs: page.items,
    }
  }))

  return {
    hasMore: runLists.some((entry) => entry.hasMore),
    items: runLists
      .flatMap(({ connectorId, connectorName, runs }) =>
        runs.map((run) => ({ connectorId, connectorName, run })))
      .sort((left, right) => right.run.startedAt.localeCompare(left.run.startedAt)),
  }
}

async function resolveFocusedConnectorRun(
  connectorsApi: ConnectorsPreloadApi,
  focusedRunId: string,
  initialItems: ConnectorRunHistoryItem[],
  initialHasMore: boolean,
): Promise<{
  focusedItem: ConnectorRunHistoryItem | null
  outcome: 'found' | 'not_found' | 'search_limit_reached'
}> {
  const existing = initialItems.find((item) => item.run.id === focusedRunId)
  if (existing) {
    return { focusedItem: existing, outcome: 'found' }
  }

  let offset = CONNECTOR_RUNS_PAGE_SIZE
  let hasMore = initialHasMore
  let pagesFetched = 1

  while (hasMore && pagesFetched < CONNECTOR_RUNS_MAX_FOCUS_PAGES) {
    const page = await loadConnectorRunHistoryPage(connectorsApi, offset)
    pagesFetched += 1
    const match = page.items.find((item) => item.run.id === focusedRunId)
    if (match) {
      return { focusedItem: match, outcome: 'found' }
    }
    hasMore = page.hasMore
    offset += CONNECTOR_RUNS_PAGE_SIZE
  }

  if (hasMore) {
    return { focusedItem: null, outcome: 'search_limit_reached' }
  }

  return { focusedItem: null, outcome: 'not_found' }
}

type FocusedConnectorRunLookup =
  | 'idle'
  | 'found'
  | 'not_found'
  | 'search_limit_reached'

function ConnectorRunsPanel({
  connectorsApi,
  focusedRunId = null,
}: {
  connectorsApi: ConnectorsPreloadApi
  focusedRunId?: string | null
}) {
  const [items, setItems] = useState<ConnectorRunHistoryItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [focusedRunLookup, setFocusedRunLookup] = useState<FocusedConnectorRunLookup>('idle')
  const [isLoading, setIsLoading] = useState(true)
  const focusedRunRef = useRef<HTMLElement | null>(null)
  const focusedRunAppliedIdRef = useRef<string | null>(null)

  useEffect(() => {
    focusedRunAppliedIdRef.current = null
    setFocusedRunLookup('idle')
  }, [focusedRunId])

  useEffect(() => {
    let cancelled = false
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    let resolvedFocusedItem: ConnectorRunHistoryItem | null = null
    let focusedLookupComplete = !focusedRunId
    let lookupOutcome: FocusedConnectorRunLookup = 'idle'

    const loadRuns = () => loadConnectorRunHistoryPage(connectorsApi, 0)
      .then(async (page) => {
        let nextItems = page.items

        if (focusedRunId && !focusedLookupComplete) {
          const focused = await resolveFocusedConnectorRun(
            connectorsApi,
            focusedRunId,
            page.items,
            page.hasMore,
          )
          focusedLookupComplete = true
          lookupOutcome = focused.outcome
          resolvedFocusedItem = focused.outcome === 'found' ? focused.focusedItem : null
        }

        if (
          focusedRunId
          && resolvedFocusedItem
          && !nextItems.some((item) => item.run.id === focusedRunId)
        ) {
          nextItems = [resolvedFocusedItem, ...nextItems]
        }

        if (!cancelled) {
          setItems(nextItems)
          setFocusedRunLookup(focusedRunId && focusedLookupComplete ? lookupOutcome : 'idle')
          setError(null)
          if (nextItems.some(({ run }) => run.status === 'queued' || run.status === 'running')) {
            pollTimer = setTimeout(loadRuns, 1_000)
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setItems([])
          setFocusedRunLookup('idle')
          setError('Connector run history could not be loaded.')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    void loadRuns()

    return () => {
      cancelled = true
      if (pollTimer) {
        clearTimeout(pollTimer)
      }
    }
  }, [connectorsApi, focusedRunId])

  useEffect(() => {
    if (!focusedRunId || isLoading || focusedRunLookup !== 'found') {
      return
    }

    if (focusedRunAppliedIdRef.current === focusedRunId) {
      return
    }

    const node = focusedRunRef.current
    if (!node) {
      return
    }

    focusedRunAppliedIdRef.current = focusedRunId
    node.scrollIntoView({ block: 'nearest' })
    node.focus()
  }, [focusedRunId, focusedRunLookup, isLoading, items])

  return (
    <section aria-labelledby="connector-runs-title" className="space-y-7">
      <div>
        <h2 id="connector-runs-title" className="text-xl font-semibold text-foreground">
          Connector Runs
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Inspect connector progress, results, warnings, and safe retry guidance.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">Loading connector runs...</p>
      ) : null}
      {error ? (
        <Alert variant="destructive" className="bg-card" role="alert">
          <AlertCircle className="absolute left-4 top-4 h-4 w-4" aria-hidden="true" />
          <div className="pl-7">
            <AlertTitle>Run history unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </div>
        </Alert>
      ) : null}
      {focusedRunLookup === 'not_found' && focusedRunId ? (
        <Alert variant="destructive" className="bg-card" role="alert">
          <AlertCircle className="absolute left-4 top-4 h-4 w-4" aria-hidden="true" />
          <div className="pl-7">
            <AlertTitle>Connector run not found</AlertTitle>
            <AlertDescription>
              The requested connector run could not be found in available history.
            </AlertDescription>
          </div>
        </Alert>
      ) : null}
      {focusedRunLookup === 'search_limit_reached' && focusedRunId ? (
        <p
          aria-label="Requested connector run was not located within the searched recent-history window"
          className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground"
          role="status"
        >
          The requested connector run was not located within the searched recent-history window.
          More history is available beyond this search limit.
        </p>
      ) : null}
      {!isLoading && !error && items.length === 0 ? (
        <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          No connector runs recorded yet.
        </p>
      ) : null}
      {items.length > 0 ? (
        <div className="space-y-3" aria-label="Connector run history">
          {items.map(({ connectorId, connectorName, run }) => {
            const warningLabels = [...new Set(run.warnings.map((warning) =>
              safeRunWarningLabel(warning.code)))]
            const retryGuidance = safeRunRetryGuidance(run, connectorId)
            const isFocused = focusedRunId === run.id && focusedRunLookup === 'found'

            return (
              <article
                key={run.id}
                ref={isFocused ? focusedRunRef : undefined}
                aria-current={isFocused ? 'true' : undefined}
                aria-live={run.status === 'queued' || run.status === 'running' ? 'polite' : undefined}
                className={`space-y-3 rounded-md border border-border bg-card p-4 ${
                  isFocused ? 'ring-2 ring-primary' : ''
                }`}
                data-connector-run-id={run.id}
                id={`connector-run-${run.id}`}
                tabIndex={isFocused ? -1 : undefined}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{connectorName}</h3>
                    <p className="text-xs text-muted-foreground">
                      {run.mode} · {run.startedAt}
                    </p>
                  </div>
                  <span className="rounded-full border border-border px-2 py-1 text-xs font-medium text-foreground">
                    {run.status}
                  </span>
                </div>
                <ConnectorRunProgressDetails run={run} />
                <ConnectorRunLifecycleDetails run={run} />
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {connectorRunMetrics(run).map((metric) => (
                    <span key={metric.label}>{metric.label}: {metric.value}</span>
                  ))}
                </div>
                {warningLabels.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {warningLabels.map((label) => (
                      <span key={label} className="rounded-full bg-muted px-2 py-1 text-xs text-foreground">
                        {label}
                      </span>
                    ))}
                  </div>
                ) : null}
                {retryGuidance ? (
                  <p className="text-xs font-medium text-muted-foreground">{retryGuidance}</p>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

function safeRunWarningLabel(code: string): string {
  const labels: Record<string, string> = {
    'auth.required': 'Authentication required',
    'connector.execution_failed': 'Connector execution failed',
    'connector.interrupted': 'Run interrupted',
    'connector.projection_failed': 'Projection failed',
    jobright_auth_failed: 'Jobright authentication failed',
    jobright_auth_required: 'Jobright authentication required',
    jobright_auth_retryable: 'Jobright authentication unavailable',
    jobright_challenge_blocked: 'Jobright API challenge',
    jobright_discovery_failed: 'Jobright discovery failed',
    jobright_discovery_rate_limited: 'Jobright discovery rate limited',
    jobright_discovery_retryable: 'Jobright discovery unavailable',
    jobright_parser_changed: 'Jobright API changed',
    jobright_rate_limited: 'Jobright rate limited',
    jobright_retryable_failure: 'Jobright temporarily unavailable',
    jobright_zero_useful_results: 'No usable Jobright URLs',
    'source.captcha': 'Captcha required',
    'source.rate_limited': 'Rate limited',
  }

  return labels[code] ?? 'Connector warning'
}

function safeRunRetryGuidance(run: ConnectorSettingsRun, connectorId: string): string | null {
  const retryHints = recordFromUnknown(run.retryHints)
  const reason = stringFromUnknown(retryHints.reason)
  const retryActions = Array.isArray(retryHints.actions)
    ? retryHints.actions.filter((action): action is string => typeof action === 'string')
    : []
  const stats = recordFromUnknown(run.stats)
  const warningCodes = new Set(run.warnings.map((warning) => warning.code))

  if (warningCodes.has('jobright_auth_failed')) {
    return 'Jobright authentication failed. Validate credentials and retry the run.'
  }

  if (warningCodes.has('jobright_discovery_failed')) {
    return 'Jobright discovery failed. Review API availability and connector configuration, then run again.'
  }

  if (
    retryActions.includes('refresh_jobright_auth')
    || reason.includes('auth')
    || numberFromUnknown(stats.authRequired, 0) > 0
  ) {
    return connectorId === JOBRIGHT_CONNECTOR_ID || retryHints.source === 'jobright'
      ? 'Update and validate Jobright credentials, then run again.'
      : 'Reconnect the connector and run again.'
  }

  if (
    retryActions.includes('retry_jobright_after_challenge')
    || numberFromUnknown(retryHints.captcha, 0) > 0
  ) {
    return 'Jobright returned an API challenge. Refresh credentials or retry later.'
  }

  if (
    retryActions.includes('update_jobright_parser')
    || numberFromUnknown(retryHints.parserChanged, 0) > 0
  ) {
    return 'Update the Jobright API parser, then run again.'
  }

  if (
    retryActions.includes('retry_jobright_with_backoff')
    || numberFromUnknown(retryHints.rateLimited, 0) > 0
    || numberFromUnknown(retryHints.retryableFailures, 0) > 0
  ) {
    return 'Retry the Jobright run later with backoff.'
  }

  if (retryActions.includes('review_jobright_results')) {
    return 'Review unresolved Jobright results and URL normalization, then run again.'
  }

  if (reason === 'projection_failed') {
    return 'Review the projection failure, then run the connector again.'
  }

  if (reason === 'connector_run_interrupted') {
    return 'The app interrupted this run. Start a new connector run.'
  }

  return run.status === 'failed' ? 'Review the connector configuration and run again.' : null
}

function defaultConnectorSettingsDraft(
  instance: ConnectorSettingsInstance | undefined,
): ConnectorSettingsDraft {
  const filters = recordFromUnknown(instance?.filters)

  return {
    maxResolutionCount: String(numberFromUnknown(filters.maxResolutionCount, 10)),
    roleTerms: arrayTextFromUnknown(filters.roleTerms, 'intern'),
  }
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringFromUnknown(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberFromUnknown(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function arrayTextFromUnknown(value: unknown, fallback: string): string {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').join(', ')
    : fallback
}

function parseCommaSeparatedList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function normalizePositiveInteger(value: string, fallback: number): number {
  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback
  }

  return Math.round(parsed)
}

function GeneralSettingsPanel({
  settings,
  onSettingsPatch,
}: {
  settings: AppSettings
  onSettingsPatch: (patch: AppSettingsPatch) => void
}) {
  return (
    <section aria-labelledby="general-settings-title" className="space-y-7">
      <div>
        <h2 id="general-settings-title" className="text-xl font-semibold text-foreground">
          General
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how this app talks to job data and which controls stay visible.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-foreground">Backend mode</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <RuntimeModeOption
            checked={settings.runtimeMode === 'local-desktop'}
            description="SQLite through Electron IPC, no local HTTP server."
            icon={<Monitor className="h-4 w-4" aria-hidden="true" />}
            label="Local desktop"
            onChange={() => onSettingsPatch({ runtimeMode: 'local-desktop' })}
          />
          <RuntimeModeOption
            checked={settings.runtimeMode === 'local-shared'}
            description="SQLite plus the embedded HTTP API for Tailscale or CLI access."
            icon={<Server className="h-4 w-4" aria-hidden="true" />}
            label="Local shared"
            onChange={() => onSettingsPatch({ runtimeMode: 'local-shared' })}
          />
          <RuntimeModeOption
            checked={settings.runtimeMode === 'remote'}
            description="Use a hosted or remote HTTP API instead of local SQLite."
            icon={<Globe2 className="h-4 w-4" aria-hidden="true" />}
            label="Remote"
            onChange={() => onSettingsPatch({ runtimeMode: 'remote' })}
          />
        </div>
      </div>

      <SettingsToggleRow
        checked={settings.showAdvancedFilters}
        description="Show the full application filter toolbar without opening it each session."
        icon={<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}
        label="Show advanced filters"
        onChange={(checked) => onSettingsPatch({ showAdvancedFilters: checked })}
      />
    </section>
  )
}


function ConfigurationSettingsPanel({
  settings,
  onSettingsPatch,
}: {
  settings: AppSettings
  onSettingsPatch: (patch: AppSettingsPatch) => void
}) {
  return (
    <section aria-labelledby="configuration-settings-title" className="space-y-7">
      <div>
        <h2 id="configuration-settings-title" className="text-xl font-semibold text-foreground">
          Configuration
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure remote and local API settings. These backend values apply after restart.
        </p>
      </div>

      <div className="divide-y divide-border rounded-md border border-border bg-card">
        <SettingsTextInput
          label="Remote API URL"
          value={settings.remoteApiUrl}
          onChange={(value) => onSettingsPatch({ remoteApiUrl: value })}
        />
        <SettingsTextInput
          label="Local API host"
          value={settings.localApiHost}
          onChange={(value) => onSettingsPatch({ localApiHost: value })}
        />
        <SettingsTextInput
          label="Local API port"
          type="number"
          value={String(settings.localApiPort)}
          onChange={(value) => onSettingsPatch({ localApiPort: Number(value) })}
        />
        <SettingsTextInput
          label="API token"
          type="password"
          value={settings.apiToken}
          onChange={(value) => onSettingsPatch({ apiToken: value })}
        />
        <SettingsTextInput label="SQLite path" readOnly value="Managed by Electron userData" />
      </div>
    </section>
  )
}

function AgentAccessSettingsPanel({
  apiBaseUrl,
  settings,
  workspace,
}: {
  apiBaseUrl: string
  settings: AppSettings
  workspace: WorkspaceSummary | null
}) {
  const workspaceSelector = workspace?.id ?? '<workspace-id-or-name>'

  return (
    <section aria-labelledby="agent-access-settings-title" className="space-y-7">
      <div>
        <h2 id="agent-access-settings-title" className="text-xl font-semibold text-foreground">
          Agent access
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Local CLI and future MCP access go through the same HTTP surface.
        </p>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <p className="text-sm font-medium text-foreground">
          Local API is available in local-shared mode.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Current selection: <code>{settings.runtimeMode}</code>
        </p>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">CLI examples</h3>
        <pre className="mt-3 whitespace-pre-wrap break-all rounded-md bg-background p-3 text-xs text-foreground">
          <code>{`VALEDICTORIAN_API_URL=${apiBaseUrl} valedictorian-cli --json workspaces list`}</code>
        </pre>
        <pre className="mt-2 whitespace-pre-wrap break-all rounded-md bg-background p-3 text-xs text-foreground">
          <code>{`VALEDICTORIAN_API_URL=${apiBaseUrl} valedictorian-cli --json applications list --workspace ${workspaceSelector}`}</code>
        </pre>
        <pre className="mt-2 whitespace-pre-wrap break-all rounded-md bg-background p-3 text-xs text-foreground">
          <code>{`VALEDICTORIAN_API_TOKEN=<token> valedictorian-cli --json applications get <id> --workspace ${workspaceSelector}`}</code>
        </pre>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">Tailscale</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Use local shared mode, bind to the reachable host when needed, and keep the API token
          private.
        </p>
      </div>
    </section>
  )
}

function DataSettingsPanel({
  workspace,
  workspaceApi,
}: {
  workspace: WorkspaceSummary | null
  workspaceApi: WorkspacePreloadApi
}) {
  return (
    <section aria-labelledby="data-settings-title" className="space-y-7">
      <div>
        <h2 id="data-settings-title" className="text-xl font-semibold text-foreground">
          Data
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Workspace files and local database paths.
        </p>
      </div>

      <div className="divide-y divide-border rounded-md border border-border bg-card">
        <SettingsTextInput
          label="Workspace path"
          readOnly
          value={workspace?.rootPath ?? 'No workspace selected'}
        />
        <SettingsTextInput
          label="Workspace data path"
          readOnly
          value={workspace?.dataPath ?? 'No workspace selected'}
        />
        <SettingsTextInput
          label="SQLite path"
          readOnly
          value={workspace?.sqlitePath ?? 'No workspace selected'}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" className="gap-2" onClick={() => void workspaceApi.chooseFolder()}>
          <FolderOpen className="h-4 w-4" aria-hidden="true" />
          Choose workspace
        </Button>
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          disabled={!workspace}
          onClick={() => void workspaceApi.revealCurrent()}
        >
          <FolderOpen className="h-4 w-4" aria-hidden="true" />
          Reveal workspace
        </Button>
      </div>
    </section>
  )
}

function AppearanceSettingsPanel({
  settings,
  onSettingsPatch,
}: {
  settings: AppSettings
  onSettingsPatch: (patch: AppSettingsPatch) => void
}) {
  return (
    <section aria-labelledby="appearance-settings-title" className="space-y-7">
      <div>
        <h2 id="appearance-settings-title" className="text-xl font-semibold text-foreground">
          Appearance
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Visual theming stays minimal for now; this section holds UI preferences.
        </p>
      </div>

      <SettingsToggleRow
        checked={settings.showAdvancedFilters}
        description="Show the full application filter toolbar on the home view."
        icon={<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}
        label="Show advanced filters"
        onChange={(checked) => onSettingsPatch({ showAdvancedFilters: checked })}
      />
    </section>
  )
}

function PolicySettingsPanel({ policyApi }: { policyApi: PolicyPreloadApi }) {
  const [draftConfig, setDraftConfig] = useState<PolicyConfig>(defaultPolicyConfig)
  const [savedConfig, setSavedConfig] = useState<PolicyConfig>(defaultPolicyConfig)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [savingSection, setSavingSection] = useState<PolicySaveScope>(null)
  const { toast } = useToast()

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)

    policyApi.config
      .get()
      .then((nextConfig) => {
        if (!cancelled) {
          setDraftConfig(nextConfig)
          setSavedConfig(nextConfig)
          setError(null)
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Policy settings failed to load.')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [policyApi])

  function updateDraft(updater: (currentConfig: PolicyConfig) => PolicyConfig) {
    setDraftConfig((currentConfig) => updater(currentConfig))
  }

  function updatePolicyNumber(
    value: string,
    fallback: number,
    onValue: (value: number) => void,
    options: { integer?: boolean; max?: number; min?: number } = {},
  ) {
    const nextValue = Number(value)

    if (!Number.isFinite(nextValue)) {
      onValue(fallback)
      return
    }

    const min = options.min ?? 1
    const max = options.max ?? Number.POSITIVE_INFINITY
    const boundedValue = Math.min(Math.max(nextValue, min), max)
    onValue(options.integer ? Math.round(boundedValue) : boundedValue)
  }

  function savePolicySection(section: PolicySectionKey) {
    const sectionTitle = policySectionTitles[section]
    setSavingSection(section)
    void policyApi.config
      .update(buildPolicySectionPatch(section, draftConfig))
      .then((nextConfig) => {
        setSavedConfig(nextConfig)
        setDraftConfig((currentDraft) => mergeSavedPolicySection(currentDraft, nextConfig, section))
        setError(null)
        toast({
          title: `${sectionTitle} saved.`,
          variant: 'success',
        })
      })
      .catch((saveError: unknown) => {
        const message =
          saveError instanceof Error ? saveError.message : 'Policy settings failed to save.'
        setError(message)
        toast({
          description: message,
          title: 'Policy update failed',
          variant: 'destructive',
        })
      })
      .finally(() => setSavingSection(null))
  }

  function resetPolicyConfig() {
    setSavingSection('reset')
    void policyApi.config
      .reset()
      .then((nextConfig) => {
        setDraftConfig(nextConfig)
        setSavedConfig(nextConfig)
        setError(null)
        toast({
          title: 'Policy reset.',
          variant: 'success',
        })
      })
      .catch((resetError: unknown) => {
        const message = resetError instanceof Error ? resetError.message : 'Policy reset failed.'
        setError(message)
        toast({
          description: message,
          title: 'Policy update failed',
          variant: 'destructive',
        })
      })
      .finally(() => setSavingSection(null))
  }

  return (
    <section aria-labelledby="policy-settings-title" className="space-y-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="policy-settings-title" className="text-xl font-semibold text-foreground">
            Policy
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Action buckets, evidence gates, submit checks, retry thresholds, and sourcing windows.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={isLoading || savingSection !== null}
          onClick={resetPolicyConfig}
        >
          {savingSection === 'reset' ? 'Resetting...' : 'Reset policy'}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive" className="bg-card">
          <AlertCircle className="absolute left-4 top-4 h-4 w-4" aria-hidden="true" />
          <div className="pl-7">
            <AlertTitle>Policy failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </div>
        </Alert>
      ) : null}

      <PolicySection
        isSaving={savingSection === 'action-queue-decisions'}
        saveDisabled={
          isLoading ||
          savingSection !== null ||
          !hasPolicySectionChanges(draftConfig, savedConfig, 'action-queue-decisions')
        }
        saveLabel="Save Action Queue decisions"
        title="Action Queue decisions"
        onSave={() => savePolicySection('action-queue-decisions')}
      >
        <SettingsTextInput
          label="Apply cutoff"
          type="number"
          value={String(draftConfig.scoring.applyCutoff)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.scoring.applyCutoff, (applyCutoff) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                scoring: { ...currentConfig.scoring, applyCutoff },
              })),
            )
          }
        />
        <SettingsTextInput
          label="Stale lock hours"
          type="number"
          value={String(draftConfig.actionQueue.staleLockHours)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.actionQueue.staleLockHours, (staleLockHours) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                actionQueue: { ...currentConfig.actionQueue, staleLockHours },
              })),
            )
          }
        />
      </PolicySection>

      <PolicySection
        isSaving={savingSection === 'manual-review'}
        saveDisabled={
          isLoading ||
          savingSection !== null ||
          !hasPolicySectionChanges(draftConfig, savedConfig, 'manual-review')
        }
        saveLabel="Save manual review"
        title="Manual review"
        onSave={() => savePolicySection('manual-review')}
      >
        <SettingsTextInput
          label="Manual pickup delay"
          type="number"
          value={String(draftConfig.manualReview.pickupDelayHours)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.manualReview.pickupDelayHours, (pickupDelayHours) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                manualReview: { ...currentConfig.manualReview, pickupDelayHours },
              })),
            )
          }
        />
        <SettingsTextInput
          label="Pickup window start"
          type="time"
          value={draftConfig.manualReview.daytimeWindow.start}
          onChange={(start) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              manualReview: {
                ...currentConfig.manualReview,
                daytimeWindow: { ...currentConfig.manualReview.daytimeWindow, start },
              },
            }))
          }
        />
        <SettingsTextInput
          label="Pickup window end"
          type="time"
          value={draftConfig.manualReview.daytimeWindow.end}
          onChange={(end) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              manualReview: {
                ...currentConfig.manualReview,
                daytimeWindow: { ...currentConfig.manualReview.daytimeWindow, end },
              },
            }))
          }
        />
        <SettingsTextInput
          label="Pickup window timezone"
          value={draftConfig.manualReview.daytimeWindow.timezone}
          onChange={(timezone) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              manualReview: {
                ...currentConfig.manualReview,
                daytimeWindow: { ...currentConfig.manualReview.daytimeWindow, timezone },
              },
            }))
          }
        />
        <PolicyTextArea
          label="Non-overridable evidence tags"
          value={formatStringList(draftConfig.manualReview.nonOverridableTags)}
          onChange={(value) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              manualReview: {
                ...currentConfig.manualReview,
                nonOverridableTags: parsePolicyEvidenceTagList(value),
              },
            }))
          }
        />
        <PolicyTextArea
          label="Manual review companies"
          value={formatStringList(draftConfig.manualReview.manualReviewCompanyPatterns)}
          onChange={(value) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              manualReview: {
                ...currentConfig.manualReview,
                manualReviewCompanyPatterns: parseStringList(value),
              },
            }))
          }
        />
        <PolicyTextArea
          label="Explicit approval companies"
          value={formatStringList(draftConfig.manualReview.explicitApprovalCompanyPatterns)}
          onChange={(value) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              manualReview: {
                ...currentConfig.manualReview,
                explicitApprovalCompanyPatterns: parseStringList(value),
              },
            }))
          }
        />
      </PolicySection>

      <PolicySection
        isSaving={savingSection === 'evidence-requirements'}
        saveDisabled={
          isLoading ||
          savingSection !== null ||
          !hasPolicySectionChanges(draftConfig, savedConfig, 'evidence-requirements')
        }
        saveLabel="Save evidence requirements"
        title="Evidence requirements"
        onSave={() => savePolicySection('evidence-requirements')}
      >
        <PolicyTextArea
          label="Allowed native platforms"
          value={formatStringList(draftConfig.officialPath.allowedNativePlatforms)}
          onChange={(value) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              officialPath: {
                ...currentConfig.officialPath,
                allowedNativePlatforms: parseStringList(value),
              },
            }))
          }
        />
        <PolicyTextArea
          label="High-risk form builders"
          value={formatStringList(draftConfig.officialPath.highRiskFormBuilders)}
          onChange={(value) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              officialPath: {
                ...currentConfig.officialPath,
                highRiskFormBuilders: parseStringList(value),
              },
            }))
          }
        />
        <SettingsToggleRow
          checked={draftConfig.officialPath.requireEmployerDomainVerificationForHighRiskForms}
          description="High-risk forms need employer-domain proof before promotion."
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          label="Require employer-domain verification"
          onChange={(requireEmployerDomainVerificationForHighRiskForms) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              officialPath: {
                ...currentConfig.officialPath,
                requireEmployerDomainVerificationForHighRiskForms,
              },
            }))
          }
        />
      </PolicySection>

      <PolicySection
        isSaving={savingSection === 'application-gates'}
        saveDisabled={
          isLoading ||
          savingSection !== null ||
          !hasPolicySectionChanges(draftConfig, savedConfig, 'application-gates')
        }
        saveLabel="Save application gates"
        title="Application gates"
        onSave={() => savePolicySection('application-gates')}
      >
        <SettingsToggleRow
          checked={draftConfig.verification.requireFinalReviewReceiptForSubmit}
          description="Submit outcomes need a final review receipt."
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          label="Require final review receipt"
          onChange={(requireFinalReviewReceiptForSubmit) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              verification: {
                ...currentConfig.verification,
                requireFinalReviewReceiptForSubmit,
              },
            }))
          }
        />
        <SettingsToggleRow
          checked={draftConfig.verification.requireSecondPassForSubmit}
          description="Submit outcomes need second-pass verification."
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          label="Require second pass verification"
          onChange={(requireSecondPassForSubmit) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              verification: {
                ...currentConfig.verification,
                requireSecondPassForSubmit,
              },
            }))
          }
        />
      </PolicySection>

      <PolicySection
        isSaving={savingSection === 'retry-recovery'}
        saveDisabled={
          isLoading ||
          savingSection !== null ||
          !hasPolicySectionChanges(draftConfig, savedConfig, 'retry-recovery')
        }
        saveLabel="Save retry recovery"
        title="Retry recovery"
        onSave={() => savePolicySection('retry-recovery')}
      >
        <SettingsTextInput
          label="Captcha/security retries"
          type="number"
          value={String(draftConfig.retries.captchaSecurityMinProfileAttempts)}
          onChange={(value) =>
            updatePolicyNumber(
              value,
              draftConfig.retries.captchaSecurityMinProfileAttempts,
              (captchaSecurityMinProfileAttempts) =>
                updateDraft((currentConfig) => ({
                  ...currentConfig,
                  retries: {
                    ...currentConfig.retries,
                    captchaSecurityMinProfileAttempts,
                  },
                })),
              { integer: true },
            )
          }
        />
        <SettingsTextInput
          label="Platform error retries"
          type="number"
          value={String(draftConfig.retries.platformErrorMinProfileAttempts)}
          onChange={(value) =>
            updatePolicyNumber(
              value,
              draftConfig.retries.platformErrorMinProfileAttempts,
              (platformErrorMinProfileAttempts) =>
                updateDraft((currentConfig) => ({
                  ...currentConfig,
                  retries: {
                    ...currentConfig.retries,
                    platformErrorMinProfileAttempts,
                  },
                })),
              { integer: true },
            )
          }
        />
        <SettingsToggleRow
          checked={draftConfig.retries.loginNeededRequiresRecoveryAttempt}
          description="Login-needed outcomes require recovery evidence."
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          label="Login recovery required"
          onChange={(loginNeededRequiresRecoveryAttempt) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              retries: {
                ...currentConfig.retries,
                loginNeededRequiresRecoveryAttempt,
              },
            }))
          }
        />
      </PolicySection>

      <PolicySection
        isSaving={savingSection === 'sourcing-windows'}
        saveDisabled={
          isLoading ||
          savingSection !== null ||
          !hasPolicySectionChanges(draftConfig, savedConfig, 'sourcing-windows')
        }
        saveLabel="Save sourcing windows"
        title="Sourcing windows"
        onSave={() => savePolicySection('sourcing-windows')}
      >
        <SettingsTextInput
          label="Sourcing timezone"
          value={draftConfig.sourcing.timezone}
          onChange={(timezone) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              sourcing: { ...currentConfig.sourcing, timezone },
            }))
          }
        />
        <SettingsTextInput
          label="Overlap minutes"
          type="number"
          value={String(draftConfig.sourcing.overlapMinutes)}
          onChange={(value) =>
            updatePolicyNumber(
              value,
              draftConfig.sourcing.overlapMinutes,
              (overlapMinutes) =>
                updateDraft((currentConfig) => ({
                  ...currentConfig,
                  sourcing: { ...currentConfig.sourcing, overlapMinutes },
                })),
              { integer: true },
            )
          }
        />
        <SettingsTextInput
          label="Weekday cadence"
          type="number"
          value={String(draftConfig.sourcing.weekdayNormalCadenceHours)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.sourcing.weekdayNormalCadenceHours, (weekdayNormalCadenceHours) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                sourcing: { ...currentConfig.sourcing, weekdayNormalCadenceHours },
              })),
            )
          }
        />
        <SettingsTextInput
          label="Overnight cadence"
          type="number"
          value={String(draftConfig.sourcing.weekdayOvernightCadenceHours)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.sourcing.weekdayOvernightCadenceHours, (weekdayOvernightCadenceHours) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                sourcing: { ...currentConfig.sourcing, weekdayOvernightCadenceHours },
              })),
            )
          }
        />
        <SettingsTextInput
          label="Weekend cadence"
          type="number"
          value={String(draftConfig.sourcing.weekendCadenceHours)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.sourcing.weekendCadenceHours, (weekendCadenceHours) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                sourcing: { ...currentConfig.sourcing, weekendCadenceHours },
              })),
            )
          }
        />
        <SettingsTextInput
          label="Minimum lookback"
          type="number"
          value={String(draftConfig.sourcing.minimumNormalLookbackHours)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.sourcing.minimumNormalLookbackHours, (minimumNormalLookbackHours) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                sourcing: { ...currentConfig.sourcing, minimumNormalLookbackHours },
              })),
            )
          }
        />
        <SettingsTextInput
          label="Overnight start hour"
          type="number"
          value={String(draftConfig.sourcing.overnightStartHour)}
          onChange={(value) =>
            updatePolicyNumber(
              value,
              draftConfig.sourcing.overnightStartHour,
              (overnightStartHour) =>
                updateDraft((currentConfig) => ({
                  ...currentConfig,
                  sourcing: { ...currentConfig.sourcing, overnightStartHour },
                })),
              { integer: true, max: 23, min: 0 },
            )
          }
        />
        <SettingsTextInput
          label="Overnight end hour"
          type="number"
          value={String(draftConfig.sourcing.overnightEndHour)}
          onChange={(value) =>
            updatePolicyNumber(
              value,
              draftConfig.sourcing.overnightEndHour,
              (overnightEndHour) =>
                updateDraft((currentConfig) => ({
                  ...currentConfig,
                  sourcing: { ...currentConfig.sourcing, overnightEndHour },
                })),
              { integer: true, max: 23, min: 0 },
            )
          }
        />
      </PolicySection>
    </section>
  )
}

function PolicySection({
  children,
  isSaving,
  saveDisabled,
  saveLabel,
  title,
  onSave,
}: {
  children: ReactNode
  isSaving: boolean
  saveDisabled: boolean
  saveLabel: string
  title: string
  onSave: () => void
}) {
  return (
    <section aria-labelledby={`policy-section-${slugify(title)}`} className="space-y-3">
      <h3 id={`policy-section-${slugify(title)}`} className="text-sm font-semibold text-foreground">
        {title}
      </h3>
      <div className="divide-y divide-border rounded-md border border-border bg-card">
        {children}
        <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3">
          <Button type="button" disabled={saveDisabled} onClick={onSave}>
            {isSaving ? 'Saving...' : saveLabel}
          </Button>
        </div>
      </div>
    </section>
  )
}

function PolicyTextArea({
  label,
  onChange,
  value,
}: {
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <label className="grid gap-2 px-4 py-3 text-sm text-foreground md:grid-cols-[220px_1fr]">
      <span className="pt-2">
        <span className="block font-medium">{label}</span>
      </span>
      <textarea
        aria-label={label}
        className="min-h-24 w-full min-w-0 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function formatStringList(values: readonly string[]) {
  return values.join('\n')
}

function parseStringList(value: string) {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function parsePolicyEvidenceTagList(value: string): PolicyEvidenceTag[] {
  return parseStringList(value).filter(isPolicyEvidenceTag)
}

function slugify(value: string) {
  return value.toLowerCase().replace(/\s+/g, '-')
}

type PolicySectionKey =
  | 'application-gates'
  | 'action-queue-decisions'
  | 'evidence-requirements'
  | 'manual-review'
  | 'retry-recovery'
  | 'sourcing-windows'

type PolicySaveScope = PolicySectionKey | 'reset' | null

const policySectionTitles: Record<PolicySectionKey, string> = {
  'application-gates': 'Application gates',
  'action-queue-decisions': 'Action Queue decisions',
  'evidence-requirements': 'Evidence requirements',
  'manual-review': 'Manual review',
  'retry-recovery': 'Retry recovery',
  'sourcing-windows': 'Sourcing windows',
}

function hasPolicySectionChanges(
  draftConfig: PolicyConfig,
  savedConfig: PolicyConfig,
  section: PolicySectionKey,
) {
  return (
    JSON.stringify(readPolicySection(draftConfig, section)) !==
    JSON.stringify(readPolicySection(savedConfig, section))
  )
}

function buildPolicySectionPatch(
  section: PolicySectionKey,
  config: PolicyConfig,
): PolicyConfigPatch {
  switch (section) {
    case 'application-gates':
      return { verification: config.verification }
    case 'evidence-requirements':
      return { officialPath: config.officialPath }
    case 'manual-review':
      return { manualReview: config.manualReview }
    case 'action-queue-decisions':
      return {
        actionQueue: config.actionQueue,
        scoring: config.scoring,
      }
    case 'retry-recovery':
      return { retries: config.retries }
    case 'sourcing-windows':
      return { sourcing: config.sourcing }
  }
}

function mergeSavedPolicySection(
  draftConfig: PolicyConfig,
  savedConfig: PolicyConfig,
  section: PolicySectionKey,
): PolicyConfig {
  switch (section) {
    case 'application-gates':
      return { ...draftConfig, verification: savedConfig.verification }
    case 'evidence-requirements':
      return { ...draftConfig, officialPath: savedConfig.officialPath }
    case 'manual-review':
      return { ...draftConfig, manualReview: savedConfig.manualReview }
    case 'action-queue-decisions':
      return {
        ...draftConfig,
        actionQueue: savedConfig.actionQueue,
        scoring: savedConfig.scoring,
      }
    case 'retry-recovery':
      return { ...draftConfig, retries: savedConfig.retries }
    case 'sourcing-windows':
      return { ...draftConfig, sourcing: savedConfig.sourcing }
  }
}

function readPolicySection(config: PolicyConfig, section: PolicySectionKey) {
  switch (section) {
    case 'application-gates':
      return config.verification
    case 'evidence-requirements':
      return config.officialPath
    case 'manual-review':
      return config.manualReview
    case 'action-queue-decisions':
      return {
        actionQueue: config.actionQueue,
        scoring: config.scoring,
      }
    case 'retry-recovery':
      return config.retries
    case 'sourcing-windows':
      return config.sourcing
  }
}

function ComingLaterSettingsPanel({ label }: { label: string }) {
  return (
    <section className="rounded-md border border-border bg-card p-5">
      <h2 className="text-xl font-semibold text-foreground">{label}</h2>
      <p className="mt-3 text-sm font-medium text-foreground">Coming later</p>
      <p className="mt-1 text-sm text-muted-foreground">
        This page is wired into navigation now so the settings layout can grow without changing the
        shell.
      </p>
    </section>
  )
}

function RuntimeModeOption({
  checked,
  description,
  icon,
  label,
  onChange,
}: {
  checked: boolean
  description: string
  icon: ReactNode
  label: string
  onChange: () => void
}) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-md border border-border bg-card p-3 text-sm text-foreground">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
      </span>
      <input
        aria-label={label}
        checked={checked}
        className="mt-1 h-4 w-4 accent-primary"
        name="runtimeMode"
        type="radio"
        onChange={onChange}
      />
    </label>
  )
}

function isFunctionalSettingsPanel(panel: SettingsPanelId) {
  return (
    panel === SETTINGS_PANELS.GENERAL ||
    panel === SETTINGS_PANELS.PROFILE ||
    panel === SETTINGS_PANELS.CONFIGURATION ||
    panel === SETTINGS_PANELS.CONNECTORS ||
    panel === SETTINGS_PANELS.AGENT_ACCESS ||
    panel === SETTINGS_PANELS.APPEARANCE ||
    panel === SETTINGS_PANELS.POLICY ||
    panel === SETTINGS_PANELS.DATA
  )
}

export { ConnectorRunsPanel, ConnectorSettingsPanel, SettingsPage, SettingsSidebar }
