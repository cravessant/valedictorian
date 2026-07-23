import { useEffect, useState } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { useAppBootstrapLoads } from './app/use-app-bootstrap-loads'
import { AppNavigationShell } from './app/AppNavigationShell'
import { APP_VIEWS, type MainAppView } from './app/types'
import {
  LifecycleWorkbench,
  type LifecyclePhase,
} from './modules/lifecycle-table/lifecycle-workbench'
import type { SettingsPreloadApi } from './ipc/settings.preload'
import type { WorkspacePreloadApi } from './ipc/workspace.preload'
import type { ConnectorsPreloadApi } from './ipc/connectors.preload'
import {
  defaultAppSettings,
  normalizeAppSettings,
  type AppSettingsPatch,
} from './settings/app-settings'
import { applyResolvedTheme } from './theme/theme-applier'
import { resolveTheme } from './theme/theme-registry'
import { ConnectorRunsPanel } from './settings/ConnectorRunsPanel'
import type { CaptureRunFilter, ConnectorProvenanceTarget } from './app/capture-navigation'

interface AppProps {
  settingsApi?: SettingsPreloadApi
  workspaceApi?: WorkspacePreloadApi
  connectorsApi?: ConnectorsPreloadApi
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

function unavailableConnectorsApi(): ConnectorsPreloadApi {
  const unavailable = async (): Promise<never> => {
    throw new Error('Connector controls are unavailable in this renderer')
  }
  return {
    list: async () => ({ items: [] }),
    create: unavailable,
    update: unavailable,
    remove: unavailable,
    inspect: unavailable,
    runs: {
      list: async (input) => ({
        items: [],
        total: 0,
        limit: input.limit ?? 50,
        offset: input.offset ?? 0,
        hasMore: false,
      }),
      trigger: unavailable,
    },
    status: { reconnect: unavailable, skip: unavailable },
  }
}

export function rendererConnectorsApi(): ConnectorsPreloadApi {
  return (window as Window & { connectors?: ConnectorsPreloadApi }).connectors
    ?? unavailableConnectorsApi()
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
  return 'Connector Runs'
}

export default function App({
  settingsApi = rendererSettingsApi(),
  workspaceApi = rendererWorkspaceApi(),
  connectorsApi = rendererConnectorsApi(),
}: AppProps) {
  const {
    setSettings,
    settings,
    settingsLoadFailure,
    workspace,
    workspaceLoadFailure,
  } = useAppBootstrapLoads({ settingsApi, workspaceApi })
  const [currentView, setCurrentView] = useState<MainAppView>(APP_VIEWS.CAPTURES)
  const [captureRunFilter, setCaptureRunFilter] = useState<CaptureRunFilter | null>(null)
  const [focusedConnectorProvenance, setFocusedConnectorProvenance] = useState<ConnectorProvenanceTarget | null>(null)

  useEffect(() => {
    applyResolvedTheme(resolveTheme(settings.theme))
  }, [settings.theme])

  async function updateSettings(patch: AppSettingsPatch) {
    const previousSettings = settings
    setSettings(normalizeAppSettings({ ...settings, ...patch }))
    try {
      setSettings(await settingsApi.update(patch))
    } catch (error: unknown) {
      setSettings(previousSettings)
      throw error
    }
  }

  function changeView(view: MainAppView) {
    setFocusedConnectorProvenance(null)
    setCurrentView(view)
  }

  return (
    <TooltipProvider>
      <AppNavigationShell
        currentView={currentView}
        settings={settings}
        title={`${workspace?.name ?? 'Workspace'} · ${viewTitle(currentView)}`}
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
            key={captureRunFilter?.connectorRunId ?? 'all-captures'}
            initialConnectorRunId={captureRunFilter?.connectorRunId ?? null}
            selectedPhase={currentView}
            onSelectedPhaseChange={setCurrentView}
            onConnectorRunFilterChange={setCaptureRunFilter}
            onOpenConnectorProvenance={(target) => {
              setFocusedConnectorProvenance(target)
              setCurrentView(APP_VIEWS.CONNECTOR_RUNS)
            }}
          />
        ) : (
          <ConnectorRunsPanel
            connectorsApi={connectorsApi}
            focusedRunId={focusedConnectorProvenance?.connectorRunId ?? null}
            focusedProvenanceTarget={focusedConnectorProvenance}
            onViewCaptures={(filter) => {
              setCaptureRunFilter(filter)
              setCurrentView(APP_VIEWS.CAPTURES)
            }}
          />
        )}
      </AppNavigationShell>
      <Toaster />
    </TooltipProvider>
  )
}
