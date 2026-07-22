import { useEffect } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { useAppBootstrapLoads } from './app/use-app-bootstrap-loads'
import type { SettingsPreloadApi } from './ipc/settings.preload'
import type { WorkspacePreloadApi } from './ipc/workspace.preload'
import { defaultAppSettings } from './settings/app-settings'
import { applyResolvedTheme } from './theme/theme-applier'
import { resolveTheme } from './theme/theme-registry'

interface AppProps {
  settingsApi?: SettingsPreloadApi
  workspaceApi?: WorkspacePreloadApi
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

export default function App({
  settingsApi = rendererSettingsApi(),
  workspaceApi = rendererWorkspaceApi(),
}: AppProps) {
  const { settings, settingsLoadFailure, workspace, workspaceLoadFailure } = useAppBootstrapLoads({
    settingsApi,
    workspaceApi,
  })

  useEffect(() => {
    applyResolvedTheme(resolveTheme(settings.theme))
  }, [settings.theme])

  return (
    <TooltipProvider>
      <main className="min-h-screen bg-background px-6 py-10 text-foreground" data-testid="app-shell">
        <section className="mx-auto max-w-4xl rounded-lg border border-border bg-card p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Valedictorian
          </p>
          <h1 className="mt-2 text-2xl font-semibold">
            {workspace?.name ?? 'Workspace'}
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Canonical Captures, Jobs, Opportunities, and Applications are available through the
            local HTTP API and typed workspace client. Desktop lifecycle views will use this same
            contract.
          </p>
          {settingsLoadFailure || workspaceLoadFailure ? (
            <p className="mt-4 text-sm text-destructive" role="alert">
              Some workspace settings could not be loaded.
            </p>
          ) : null}
        </section>
      </main>
      <Toaster />
    </TooltipProvider>
  )
}
