import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { useAppBootstrapLoads } from './app/use-app-bootstrap-loads'
import { LifecycleWorkbench } from './modules/lifecycle-table/lifecycle-workbench'
import type { SettingsPreloadApi } from './ipc/settings.preload'
import type { WorkspacePreloadApi } from './ipc/workspace.preload'
import type { ConnectorsPreloadApi } from './ipc/connectors.preload'
import { defaultAppSettings } from './settings/app-settings'
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

export default function App({
  settingsApi = rendererSettingsApi(),
  workspaceApi = rendererWorkspaceApi(),
  connectorsApi = rendererConnectorsApi(),
}: AppProps) {
  const { settings, settingsLoadFailure, workspace, workspaceLoadFailure } = useAppBootstrapLoads({
    settingsApi,
    workspaceApi,
  })
  const [surface, setSurface] = useState<'lifecycle' | 'connector-runs'>('lifecycle')
  const [captureRunFilter, setCaptureRunFilter] = useState<CaptureRunFilter | null>(null)
  const [focusedConnectorProvenance, setFocusedConnectorProvenance] = useState<ConnectorProvenanceTarget | null>(null)

  useEffect(() => {
    applyResolvedTheme(resolveTheme(settings.theme))
  }, [settings.theme])

  return (
    <TooltipProvider>
      <main className="min-h-screen bg-background px-6 py-10 text-foreground" data-testid="app-shell">
        <section className="mx-auto max-w-6xl rounded-lg border border-border bg-card p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Valedictorian
          </p>
          <h1 className="mt-2 text-2xl font-semibold">
            {workspace?.name ?? 'Workspace'}
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Canonical Captures, Jobs, Opportunities, and Applications are available through the
            local HTTP API and typed workspace client. Desktop lifecycle views use this same
            contract.
          </p>
          {settingsLoadFailure || workspaceLoadFailure ? (
            <p className="mt-4 text-sm text-destructive" role="alert">
              Some workspace settings could not be loaded.
            </p>
          ) : null}
        </section>
        <nav aria-label="Workspace surfaces" className="mx-auto mt-6 flex max-w-6xl gap-2">
          <Button
            type="button"
            variant={surface === 'lifecycle' ? 'default' : 'outline'}
            aria-current={surface === 'lifecycle' ? 'page' : undefined}
            onClick={() => setSurface('lifecycle')}
          >
            Job lifecycle
          </Button>
          <Button
            type="button"
            variant={surface === 'connector-runs' ? 'default' : 'outline'}
            aria-current={surface === 'connector-runs' ? 'page' : undefined}
            onClick={() => setSurface('connector-runs')}
          >
            Connector runs
          </Button>
        </nav>
        <section className="mx-auto mt-6 max-w-6xl">
          {surface === 'lifecycle' ? (
            <LifecycleWorkbench
              key={captureRunFilter?.connectorRunId ?? 'all-captures'}
              initialConnectorRunId={captureRunFilter?.connectorRunId ?? null}
              onConnectorRunFilterChange={setCaptureRunFilter}
              onOpenConnectorProvenance={(target) => {
                setFocusedConnectorProvenance(target)
                setSurface('connector-runs')
              }}
            />
          ) : (
            <ConnectorRunsPanel
              connectorsApi={connectorsApi}
              focusedRunId={focusedConnectorProvenance?.connectorRunId ?? null}
              focusedProvenanceTarget={focusedConnectorProvenance}
              onViewCaptures={(filter) => {
                setCaptureRunFilter(filter)
                setSurface('lifecycle')
              }}
            />
          )}
        </section>
      </main>
      <Toaster />
    </TooltipProvider>
  )
}
