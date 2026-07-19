import { useEffect, useRef, useState } from 'react'
import {
  ownedLoadFailure,
  presentLoadFailure,
  type ErrorPresentation,
} from './error-presentation'
import {
  defaultAppSettings,
  type AppSettings,
} from '../settings/app-settings'
import type { SettingsPreloadApi } from '../ipc/settings.preload'
import type { WorkspacePreloadApi } from '../ipc/workspace.preload'
import type { WorkspaceSummary } from '../workspace/workspace.initializer'

function presentSettingsLoadFailure(
  error: unknown,
  hasStaleData: boolean,
): ErrorPresentation | null {
  return ownedLoadFailure(presentLoadFailure(error, {
    fallbackMessage: 'Settings could not be loaded.',
    hasStaleData,
    trigger: hasStaleData ? 'refresh' : 'load',
  }))
}

function presentWorkspaceLoadFailure(
  error: unknown,
  hasStaleData: boolean,
): ErrorPresentation | null {
  return ownedLoadFailure(presentLoadFailure(error, {
    fallbackMessage: 'Workspace could not be loaded.',
    hasStaleData,
    trigger: hasStaleData ? 'refresh' : 'load',
  }))
}

export function useAppBootstrapLoads({
  settingsApi,
  workspaceApi,
}: {
  settingsApi: SettingsPreloadApi
  workspaceApi: WorkspacePreloadApi
}) {
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings)
  const [filtersExpanded, setFiltersExpanded] = useState(defaultAppSettings.showAdvancedFilters)
  const [settingsLoadFailure, setSettingsLoadFailure] = useState<ErrorPresentation | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null)
  const [workspaceLoadFailure, setWorkspaceLoadFailure] = useState<ErrorPresentation | null>(null)
  const [settingsRetryKey, setSettingsRetryKey] = useState(0)
  const [workspaceRetryKey, setWorkspaceRetryKey] = useState(0)
  const hasLoadedSettingsRef = useRef(false)
  const hasLoadedWorkspaceRef = useRef(false)

  useEffect(() => {
    let isMounted = true
    void settingsApi.get()
      .then((savedSettings) => {
        if (isMounted) {
          setSettings(savedSettings)
          setFiltersExpanded(savedSettings.showAdvancedFilters)
          hasLoadedSettingsRef.current = true
          setSettingsLoadFailure(null)
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setSettingsLoadFailure(presentSettingsLoadFailure(error, hasLoadedSettingsRef.current))
        }
      })
    return () => {
      isMounted = false
    }
  }, [settingsApi, settingsRetryKey])

  useEffect(() => {
    let isMounted = true
    void workspaceApi.getCurrent()
      .then((currentWorkspace) => {
        if (isMounted) {
          setWorkspace(currentWorkspace)
          hasLoadedWorkspaceRef.current = true
          setWorkspaceLoadFailure(null)
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setWorkspaceLoadFailure(presentWorkspaceLoadFailure(error, hasLoadedWorkspaceRef.current))
          if (!hasLoadedWorkspaceRef.current) {
            setWorkspace(null)
          }
        }
      })
    return () => {
      isMounted = false
    }
  }, [workspaceApi, workspaceRetryKey])

  return {
    filtersExpanded,
    reloadSettings: () => setSettingsRetryKey((key) => key + 1),
    reloadWorkspace: () => setWorkspaceRetryKey((key) => key + 1),
    setFiltersExpanded,
    setSettings,
    settings,
    settingsLoadFailure,
    workspace,
    workspaceLoadFailure,
  }
}
