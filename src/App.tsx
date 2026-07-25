import { useEffect, useState } from 'react'
import type { ValedictorianWorkspaceClientV2 } from '@sparxie/sdk'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { useAppBootstrapLoads } from './app/use-app-bootstrap-loads'
import { AppNavigationShell } from './app/AppNavigationShell'
import { APP_VIEWS, type MainAppView } from './app/types'
import {
  SETTINGS_PANELS,
  type SettingsPanelId,
} from './app/types'
import {
  LifecycleWorkbench,
  type LifecyclePhase,
} from './modules/lifecycle-table/lifecycle-workbench'
import type { SettingsPreloadApi } from './ipc/settings.preload'
import type { PolicyPreloadApi } from './ipc/policy.preload'
import type { ProfilePreloadApi } from './ipc/profile.preload'
import type { UpdatesPreloadApi } from './ipc/updates.preload'
import type { WorkspacePreloadApi } from './ipc/workspace.preload'
import {
  defaultAppSettings,
  normalizeAppSettings,
  type AppSettingsPatch,
} from './settings/app-settings'
import { applyResolvedTheme } from './theme/theme-applier'
import { resolveTheme } from './theme/theme-registry'
import { ConnectorRunsPanel } from './settings/ConnectorRunsPanel'
import { SettingsPage } from './settings/SettingsPage'
import type { ConnectorScheduleUiApi } from './settings/connector-schedule.types'
import type { ConnectorSettingsUiApi } from './settings/connector-settings.types'
import { requiresRestart } from './settings/requiresRestart'
import { useAppUpdates } from './updates/use-app-updates'
import {
  rendererConnectorsApi,
  rendererPolicyApi,
  rendererProfileApi,
  rendererScheduleApi,
  rendererUpdatesApi,
} from './app/renderer-settings-apis'
import type { ConnectorProvenanceTarget } from './app/capture-navigation'
import { useWorkspaceLocation } from './app/use-workspace-location'
import {
  workspaceViews,
  type WorkspaceLocation,
} from './app/workspace-location'
import {
  getRendererHttpWorkspaceClient,
  onRendererBackendStateChanged,
} from './app/renderer-http-client'
import { CompaniesWorkspace } from './modules/workspace-resources/CompaniesWorkspace'

interface AppProps {
  settingsApi?: SettingsPreloadApi
  workspaceApi?: WorkspacePreloadApi
  connectorsApi?: ConnectorSettingsUiApi
  connectorScheduleApi?: ConnectorScheduleUiApi
  policyApi?: PolicyPreloadApi
  profileApi?: ProfilePreloadApi
  updatesApi?: UpdatesPreloadApi
  workspaceClient?: ValedictorianWorkspaceClientV2 | null
  [key: string]: unknown
}

function unavailableSettingsApi(): SettingsPreloadApi {
  return {
    get: async () => defaultAppSettings,
    reset: async () => defaultAppSettings,
    update: async () => defaultAppSettings,
  }
}

function unavailableWorkspaceApi(): WorkspacePreloadApi {
  const unavailable = async () => {
    throw new Error('Workspace controls are unavailable in this renderer')
  }
  return {
    chooseCreateParentFolder: async () => null,
    chooseFolder: async () => null,
    createWorkspace: unavailable,
    getCurrent: async () => null,
    getLaunchState: unavailable,
    listRecent: async () => [],
    openFolder: unavailable,
    openRecent: unavailable,
    removeRecent: unavailable,
    reveal: async () => undefined,
    revealCurrent: async () => undefined,
  }
}

export function rendererSettingsApi(): SettingsPreloadApi {
  return (window as Window & { settings?: SettingsPreloadApi }).settings ?? unavailableSettingsApi()
}

export function rendererWorkspaceApi(): WorkspacePreloadApi {
  return (window as Window & { workspace?: WorkspacePreloadApi }).workspace ?? unavailableWorkspaceApi()
}

const lifecycleViews: readonly LifecyclePhase[] = [
  APP_VIEWS.CAPTURES,
  APP_VIEWS.JOBS,
  APP_VIEWS.OPPORTUNITIES,
  APP_VIEWS.APPLICATIONS,
]

function isLifecycleView(view: MainAppView): view is LifecyclePhase {
  return lifecycleViews.includes(view as LifecyclePhase)
}

function viewTitle(view: MainAppView): string {
  if (view === APP_VIEWS.CAPTURES) return 'Captures'
  if (view === APP_VIEWS.JOBS) return 'Jobs'
  if (view === APP_VIEWS.OPPORTUNITIES) return 'Opportunities'
  if (view === APP_VIEWS.APPLICATIONS) return 'Applications'
  if (view === APP_VIEWS.COMPANIES) return 'Companies'
  return 'Connector Runs'
}

export default function App({
  settingsApi = rendererSettingsApi(),
  workspaceApi = rendererWorkspaceApi(),
  connectorsApi = rendererConnectorsApi(),
  connectorScheduleApi = rendererScheduleApi,
  policyApi = rendererPolicyApi(),
  profileApi = rendererProfileApi(),
  updatesApi = rendererUpdatesApi(),
  workspaceClient,
}: AppProps) {
  const {
    reloadSettings,
    reloadWorkspace,
    setSettings,
    settings,
    settingsLoadFailure,
    workspace,
    workspaceLoadFailure,
  } = useAppBootstrapLoads({ settingsApi, workspaceApi })
  const workspaceNavigation = useWorkspaceLocation()
  const [nonWorkspaceView, setNonWorkspaceView] = useState<MainAppView | null>(null)
  const currentView: MainAppView =
    nonWorkspaceView ?? workspaceNavigation.entry.location.view
  const [settingsPageOpen, setSettingsPageOpen] = useState(false)
  const [selectedSettingsPanel, setSelectedSettingsPanel] = useState<SettingsPanelId>(
    SETTINGS_PANELS.GENERAL,
  )
  const [settingsRestartRequired, setSettingsRestartRequired] = useState(false)
  const [focusedConnectorProvenance, setFocusedConnectorProvenance] = useState<ConnectorProvenanceTarget | null>(null)
  const [rendererWorkspaceClient, setRendererWorkspaceClient] = useState(
    getRendererHttpWorkspaceClient,
  )
  const { checkForUpdates, installUpdate, updateState } = useAppUpdates(updatesApi)

  useEffect(() => {
    applyResolvedTheme(resolveTheme(settings.theme))
  }, [settings.theme])

  useEffect(() => {
    if (workspaceClient !== undefined) return
    const resolveClient = () => setRendererWorkspaceClient(getRendererHttpWorkspaceClient())
    resolveClient()
    return onRendererBackendStateChanged(resolveClient)
  }, [workspaceClient])

  useEffect(() => {
    const returnToWorkspace = () => setNonWorkspaceView(null)
    window.addEventListener('popstate', returnToWorkspace)
    return () => window.removeEventListener('popstate', returnToWorkspace)
  }, [])

  useEffect(() => {
    const openSettings = () => setSettingsPageOpen(true)
    const unsubscribe = window.valedictorianNavigation?.onOpenSettings(openSettings)
    window.addEventListener('valedictorian:open-settings', openSettings)
    return () => {
      unsubscribe?.()
      window.removeEventListener('valedictorian:open-settings', openSettings)
    }
  }, [])

  async function updateSettings(patch: AppSettingsPatch) {
    const previousSettings = settings
    setSettings(normalizeAppSettings({ ...settings, ...patch }))
    try {
      setSettings(await settingsApi.update(patch))
      if (requiresRestart(patch)) setSettingsRestartRequired(true)
    } catch (error: unknown) {
      setSettings(previousSettings)
      throw error
    }
  }

  function changeView(view: MainAppView) {
    setSettingsPageOpen(false)
    setFocusedConnectorProvenance(null)
    if (workspaceViews.includes(view as WorkspaceLocation['view'])) {
      setNonWorkspaceView(null)
      workspaceNavigation.navigate({ view: view as WorkspaceLocation['view'] })
    } else {
      setNonWorkspaceView(view)
    }
  }

  const resolvedWorkspaceClient = workspaceClient === undefined
    ? rendererWorkspaceClient
    : workspaceClient

  return (
    <TooltipProvider>
      <AppNavigationShell
        currentView={currentView}
        settings={settings}
        settingsView={settingsPageOpen ? {
          content: (
            <SettingsPage
              connectorsApi={connectorsApi}
              connectorScheduleApi={connectorScheduleApi}
              contentColumnClass=""
              policyApi={policyApi}
              profileApi={profileApi}
              restartRequired={settingsRestartRequired}
              selectedPanel={selectedSettingsPanel}
              settings={settings}
              settingsLoadFailure={settingsLoadFailure}
              onRetrySettingsLoad={reloadSettings}
              workspace={workspace}
              workspaceApi={workspaceApi}
              workspaceLoadFailure={workspaceLoadFailure}
              onRetryWorkspaceLoad={reloadWorkspace}
              onConnectorRunSettled={() => undefined}
              onOpenConnectorRuns={(runId) => {
                setSettingsPageOpen(false)
                if (runId) {
                  setFocusedConnectorProvenance({
                    connectorRunId: runId,
                    id: runId,
                    kind: 'run',
                  })
                }
                setNonWorkspaceView(APP_VIEWS.CONNECTOR_RUNS)
              }}
              onSettingsPatch={updateSettings}
            />
          ),
          onBack: () => setSettingsPageOpen(false),
          onPanelChange: setSelectedSettingsPanel,
          selectedPanel: selectedSettingsPanel,
        } : undefined}
        title={`${workspace?.name ?? 'Workspace'} · ${viewTitle(currentView)}`}
        updateState={updateState}
        onCheckForUpdates={() => {
          void checkForUpdates()
        }}
        onInstallUpdate={() => {
          void installUpdate()
        }}
        onOpenSettingsPage={() => setSettingsPageOpen(true)}
        onSettingsPatch={updateSettings}
        onViewChange={changeView}
      >
        {settingsLoadFailure || workspaceLoadFailure ? (
          <div className="mb-5 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
            <p className="text-sm text-destructive" role="alert">
              Some workspace settings could not be loaded.
            </p>
          </div>
        ) : null}
        {isLifecycleView(currentView) ? (
          <LifecycleWorkbench
            client={resolvedWorkspaceClient}
            workspaceId={workspace?.id ?? null}
            selectedPhase={currentView}
            onSelectedPhaseChange={changeView}
            selectedResourceId={currentView === APP_VIEWS.JOBS
              ? workspaceNavigation.entry.location.resourceId
              : undefined}
            onOpenResource={(resourceId, focusAnchor) => workspaceNavigation.navigate({
              ...workspaceNavigation.entry.location,
              view: APP_VIEWS.JOBS,
              resourceId,
            }, {
              cursorChain: workspaceNavigation.entry.cursorChain,
              focusAnchor,
            })}
            onBackFromResource={() => backFromResource(
              workspaceNavigation.entry.location,
              workspaceNavigation.entry.focusAnchor,
              workspaceNavigation.back,
              workspaceNavigation.navigate,
            )}
            workspaceEntry={workspaceNavigation.entry}
            onWorkspaceNavigate={workspaceNavigation.navigate}
          />
        ) : currentView === APP_VIEWS.COMPANIES ? (
          <CompaniesWorkspace
            client={resolvedWorkspaceClient?.companies ?? null}
            workspaceId={workspace?.id ?? null}
            entry={workspaceNavigation.entry}
            onBack={() => backFromResource(
              workspaceNavigation.entry.location,
              workspaceNavigation.entry.focusAnchor,
              workspaceNavigation.back,
              workspaceNavigation.navigate,
            )}
            onNavigate={workspaceNavigation.navigate}
          />
        ) : (
          <ConnectorRunsPanel
            connectorsApi={connectorsApi}
            focusedRunId={focusedConnectorProvenance?.connectorRunId ?? null}
            focusedProvenanceTarget={focusedConnectorProvenance}
            onViewCaptures={() => {
              changeView(APP_VIEWS.CAPTURES)
            }}
          />
        )}
      </AppNavigationShell>
      <Toaster />
    </TooltipProvider>
  )
}

function backFromResource(
  location: WorkspaceLocation,
  focusAnchor: string | undefined,
  back: () => void,
  navigate: (location: WorkspaceLocation, options?: { replace?: boolean }) => void,
) {
  if (focusAnchor) {
    back()
    return
  }
  const {
    resourceId: _resourceId,
    ...listLocation
  } = location
  navigate(listLocation, { replace: true })
}
