import { useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '@/components/ui/use-toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { PolicyPreloadApi } from './ipc/policy.preload'
import type { ProfilePreloadApi } from './ipc/profile.preload'
import type { ConnectorsPreloadApi } from './ipc/connectors.preload'
import type { SettingsPreloadApi } from './ipc/settings.preload'
import type { UpdatesPreloadApi } from './ipc/updates.preload'
import type { WorkspacePreloadApi } from './ipc/workspace.preload'
import type {
  ConnectorStatusAction,
  ConnectorStatusListResult,
  ConnectorStatusView
} from './modules/connectors/connector.status'
import type {
  LocalConnectorReconnectActionResult,
  LocalConnectorSkipActionInput,
  LocalConnectorSkipActionResult,
  LocalConnectorStatusActionInput
} from './runtime/local-valedictorian-client'
import { requiresRestart } from './settings/requiresRestart'
import {
  type ApplicationAttemptsListResult,
  type ApplicationDetail,
  type ApplicationEventsListInput,
  type ApplicationEventsListResult,
  type ApplicationLinkRecord,
  type ApplicationLinksListInput,
  type ApplicationLinksListResult,
  type ApplicationListQuery,
  type ApplicationListItem,
  type ApplicationListResult,
  type AppendApplicationNoteInput,
  type ArchiveApplicationInput,
  type CreateApplicationInput,
  type CreateApplicationLinkInput,
  type StatusUpdateInput,
  type UpdateApplicationInput,
  type UpdateApplicationLinkInput,
  type UpdateApplicationWorkflowInput
} from './modules/applications/application.types'
import {
  type CreateSourcingFindingInput,
  type ActionQueueBucket,
  type ActionQueueListQuery,
  type ActionQueueListResult,
  type PromoteSourcingFindingInput,
  type ScoreInput,
  type ScoreRecord,
  type SetSourcingFindingDecisionInput,
  type SourcingFinding,
  type SourcingFindingsListInput,
  type SourcingFindingsListResult,
  type SourcingMergeStatus,
  type SourcingDestinationClass,
  type SourcingUsability,
  type UpdateSourcingFindingInput
} from 'sparxie'
import {
  defaultAppSettings,
  normalizeAppSettings,
  type AppSettings,
  type AppSettingsPatch
} from './settings/app-settings'
import {
  defaultApplicationDetailLoader,
  defaultApplicationEventsLoader,
  defaultApplicationCreator,
  defaultApplicationLinkCreator,
  defaultApplicationLinkUpdater,
  defaultApplicationLinksLoader,
  defaultApplicationLoader,
  defaultApplicationNoteAppender,
  defaultApplicationStatusUpdater,
  defaultApplicationUpdater,
  defaultApplicationWorkflowUpdater,
  defaultCreateSourcingFinding,
  defaultDecideSourcingFinding,
  defaultAttemptLoader,
  defaultPolicyApi,
  defaultProfileApi,
  defaultPromoteSourcingFinding,
  defaultActionQueueLoader,
  defaultConnectorStatusLoader,
  defaultConnectorStatusReconnector,
  defaultConnectorStatusSkipper,
  defaultConnectorsApi,
  defaultConnectorScheduleApi,
  defaultScoreRecorder,
  defaultSettingsApi,
  defaultUpdatesApi,
  defaultWorkspaceApi,
  defaultSourcingLoader,
  defaultUpdateSourcingFinding,
  emptyApplicationEventsResult,
  emptyApplicationLinksResult,
  emptyAttemptResult,
  emptyApplicationResult,
  emptyActionQueueResult,
  emptyConnectorStatusResult,
  emptySourcingResult
} from './app/loaders'
import { buildApplicationListQuery, buildActionQueueListQuery, buildSourcingFindingsListQuery } from './app/query'
import { useAppUpdates } from './updates/use-app-updates'
import { isDocumentHidden, useMediaQuery } from './app/useMediaQuery'
import { AppShell } from './AppShell'
import { useWindowChromeState } from './app/use-window-chrome-state'
import {
  APP_VIEWS,
  SETTINGS_PANELS,
  defaultFilters,
  type ApplicationDetailSeed,
  type AppView,
  type FilterState,
  type SettingsPanelId
} from './app/types'
import type { WorkspaceSummary } from './workspace/workspace.initializer'
import type { ConnectorScheduleUiApi } from './settings/connector-schedule.types'

const narrowSidebarMediaQuery = '(max-width: 767px)'
const DATA_AUTO_REFRESH_INTERVAL_MS = 15_000
const initialConnectorStatusResult: ConnectorStatusListResult = {
  available: true,
  items: [],
}

interface AppProps {
  applicationLoader?: (query: ApplicationListQuery) => Promise<ApplicationListResult>
  applicationDetailLoader?: (applicationId: string) => Promise<ApplicationDetail | null>
  applicationLinksLoader?: (input: ApplicationLinksListInput) => Promise<ApplicationLinksListResult>
  applicationEventsLoader?: (input: ApplicationEventsListInput) => Promise<ApplicationEventsListResult>
  applicationArchiver?: (input: ArchiveApplicationInput) => Promise<void>
  applicationCreator?: (input: CreateApplicationInput) => Promise<ApplicationDetail>
  applicationLinkCreator?: (input: CreateApplicationLinkInput) => Promise<ApplicationLinkRecord>
  applicationLinkUpdater?: (input: UpdateApplicationLinkInput) => Promise<ApplicationLinkRecord>
  applicationNoteAppender?: (input: AppendApplicationNoteInput) => Promise<ApplicationDetail>
  applicationStatusUpdater?: (input: StatusUpdateInput) => Promise<ApplicationDetail>
  applicationUpdater?: (input: UpdateApplicationInput) => Promise<ApplicationDetail>
  applicationWorkflowUpdater?: (input: UpdateApplicationWorkflowInput) => Promise<ApplicationDetail>
  attemptLoader?: (applicationId: string) => Promise<ApplicationAttemptsListResult>
  createSourcingFinding?: (input: CreateSourcingFindingInput) => Promise<SourcingFinding>
  actionQueueLoader?: (query: ActionQueueListQuery) => Promise<ActionQueueListResult>
  connectorStatusLoader?: () => Promise<ConnectorStatusListResult>
  connectorStatusReconnector?: (
    input: LocalConnectorStatusActionInput
  ) => Promise<LocalConnectorReconnectActionResult>
  connectorStatusSkipper?: (
    input: LocalConnectorSkipActionInput
  ) => Promise<LocalConnectorSkipActionResult>
  connectorsApi?: ConnectorsPreloadApi
  connectorScheduleApi?: ConnectorScheduleUiApi
  scoreRecorder?: (input: ScoreInput) => Promise<ScoreRecord>
  sourcingLoader?: (input: SourcingFindingsListInput) => Promise<SourcingFindingsListResult>
  promoteSourcingFinding?: (input: PromoteSourcingFindingInput) => Promise<SourcingFinding>
  decideSourcingFinding?: (input: SetSourcingFindingDecisionInput) => Promise<SourcingFinding>
  updateSourcingFinding?: (input: UpdateSourcingFindingInput) => Promise<SourcingFinding>
  profileApi?: ProfilePreloadApi
  policyApi?: PolicyPreloadApi
  settingsApi?: SettingsPreloadApi
  updatesApi?: UpdatesPreloadApi
  workspaceApi?: WorkspacePreloadApi
}

function App({
  applicationLoader = defaultApplicationLoader,
  applicationDetailLoader = defaultApplicationDetailLoader,
  applicationLinksLoader = defaultApplicationLinksLoader,
  applicationEventsLoader = defaultApplicationEventsLoader,
  applicationCreator = defaultApplicationCreator,
  applicationLinkCreator = defaultApplicationLinkCreator,
  applicationLinkUpdater = defaultApplicationLinkUpdater,
  applicationNoteAppender = defaultApplicationNoteAppender,
  applicationStatusUpdater = defaultApplicationStatusUpdater,
  applicationUpdater = defaultApplicationUpdater,
  applicationWorkflowUpdater = defaultApplicationWorkflowUpdater,
  attemptLoader = defaultAttemptLoader,
  createSourcingFinding = defaultCreateSourcingFinding,
  actionQueueLoader = defaultActionQueueLoader,
  connectorStatusLoader = defaultConnectorStatusLoader,
  connectorStatusReconnector = defaultConnectorStatusReconnector,
  connectorStatusSkipper = defaultConnectorStatusSkipper,
  connectorsApi = defaultConnectorsApi,
  connectorScheduleApi = defaultConnectorScheduleApi,
  scoreRecorder = defaultScoreRecorder,
  sourcingLoader = defaultSourcingLoader,
  promoteSourcingFinding = defaultPromoteSourcingFinding,
  decideSourcingFinding = defaultDecideSourcingFinding,
  updateSourcingFinding = defaultUpdateSourcingFinding,
  policyApi = defaultPolicyApi,
  profileApi = defaultProfileApi,
  settingsApi = defaultSettingsApi,
  updatesApi = defaultUpdatesApi,
  workspaceApi = defaultWorkspaceApi,
}: AppProps) {
  const [filters, setFilters] = useState<FilterState>(defaultFilters)
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings)
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [appView, setAppView] = useState<AppView>(APP_VIEWS.APPLICATIONS)
  const [selectedSettingsPanel, setSelectedSettingsPanel] = useState<SettingsPanelId>(
    SETTINGS_PANELS.GENERAL,
  )
  const [focusedConnectorRunId, setFocusedConnectorRunId] = useState<string | null>(null)
  const [settingsRestartRequired, setSettingsRestartRequired] = useState(false)
  const [sidebarHoverExpanded, setSidebarHoverExpanded] = useState(false)
  const [narrowSidebarOpen, setNarrowSidebarOpen] = useState(false)
  const isNarrowViewport = useMediaQuery(narrowSidebarMediaQuery)
  const windowChromeState = useWindowChromeState()
  const [offset, setOffset] = useState(0)
  const [applicationReloadKey, setApplicationReloadKey] = useState(0)
  const [result, setResult] = useState<ApplicationListResult>(emptyApplicationResult)
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoadedApplications, setHasLoadedApplications] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionQueueBucket, setActionQueueBucket] = useState<ActionQueueBucket | undefined>(undefined)
  const [actionQueueOffset, setActionQueueOffset] = useState(0)
  const [actionQueueReloadKey, setActionQueueReloadKey] = useState(0)
  const [actionQueueResult, setActionQueueResult] = useState<ActionQueueListResult>(emptyActionQueueResult)
  const [isActionQueueLoading, setIsActionQueueLoading] = useState(false)
  const [hasLoadedActionQueue, setHasLoadedActionQueue] = useState(false)
  const [actionQueueError, setActionQueueError] = useState<string | null>(null)
  const [connectorStatusReloadKey, setConnectorStatusReloadKey] = useState(0)
  const [connectorStatusResult, setConnectorStatusResult] = useState<ConnectorStatusListResult>(initialConnectorStatusResult)
  const [isConnectorStatusLoading, setIsConnectorStatusLoading] = useState(false)
  const [hasLoadedConnectorStatus, setHasLoadedConnectorStatus] = useState(false)
  const [connectorStatusError, setConnectorStatusError] = useState<string | null>(null)
  const [sourcingMergeStatus, setSourcingMergeStatus] = useState<SourcingMergeStatus | undefined>(undefined)
  const [sourcingDestinationClass, setSourcingDestinationClass] = useState<SourcingDestinationClass | undefined>(undefined)
  const [sourcingUsability, setSourcingUsability] = useState<SourcingUsability | undefined>(undefined)
  const [sourcingSourceId, setSourcingSourceId] = useState('')
  const [sourcingOffset, setSourcingOffset] = useState(0)
  const [sourcingReloadKey, setSourcingReloadKey] = useState(0)
  const [sourcingResult, setSourcingResult] = useState<SourcingFindingsListResult>(emptySourcingResult)
  const [isSourcingLoading, setIsSourcingLoading] = useState(false)
  const [hasLoadedSourcing, setHasLoadedSourcing] = useState(false)
  const [sourcingError, setSourcingError] = useState<string | null>(null)
  const [promotingFindingId, setPromotingFindingId] = useState<string | null>(null)
  const [selectedApplication, setSelectedApplication] = useState<ApplicationDetailSeed | null>(null)
  const [applicationDetail, setApplicationDetail] = useState<ApplicationDetail | null>(null)
  const [applicationLinksResult, setApplicationLinksResult] = useState<ApplicationLinksListResult>(emptyApplicationLinksResult)
  const [applicationEventsResult, setApplicationEventsResult] = useState<ApplicationEventsListResult>(emptyApplicationEventsResult)
  const [isApplicationDetailLoading, setIsApplicationDetailLoading] = useState(false)
  const [isApplicationLinksLoading, setIsApplicationLinksLoading] = useState(false)
  const [isApplicationEventsLoading, setIsApplicationEventsLoading] = useState(false)
  const [applicationDetailError, setApplicationDetailError] = useState<string | null>(null)
  const [applicationLinksError, setApplicationLinksError] = useState<string | null>(null)
  const [applicationEventsError, setApplicationEventsError] = useState<string | null>(null)
  const { checkForUpdates, installUpdate, updateState } = useAppUpdates(updatesApi)
  const { toast } = useToast()
  const [attemptResult, setAttemptResult] = useState<ApplicationAttemptsListResult>(emptyAttemptResult)
  const [isAttemptLoading, setIsAttemptLoading] = useState(false)
  const [attemptError, setAttemptError] = useState<string | null>(null)
  const [editingApplication, setEditingApplication] = useState<ApplicationListItem | null>(null)
  const [isAddingApplication, setIsAddingApplication] = useState(false)
  const previousAppViewRef = useRef(appView)
  const updateReadyToastVersionsRef = useRef(new Set<string>())
  const query = useMemo(() => buildApplicationListQuery(filters, offset), [filters, offset])
  const actionQueueQuery = useMemo(
    () => buildActionQueueListQuery(actionQueueBucket, actionQueueOffset),
    [actionQueueBucket, actionQueueOffset],
  )
  const sourcingQuery = useMemo(
    () => buildSourcingFindingsListQuery(
      sourcingMergeStatus,
      sourcingSourceId,
      sourcingOffset,
      sourcingDestinationClass,
      sourcingUsability,
    ),
    [sourcingDestinationClass, sourcingMergeStatus, sourcingOffset, sourcingSourceId, sourcingUsability],
  )
  const isInitialLoading = isLoading && !hasLoadedApplications
  const canAutoRefreshData =
    appView === APP_VIEWS.APPLICATIONS
      ? hasLoadedApplications && !isLoading
      : appView === APP_VIEWS.ACTION_QUEUE
        ? hasLoadedActionQueue && !isActionQueueLoading
        : appView === APP_VIEWS.CONNECTORS
          ? hasLoadedConnectorStatus && !isConnectorStatusLoading
          : appView === APP_VIEWS.SOURCING
            ? hasLoadedSourcing && !isSourcingLoading
            : false

  useEffect(() => {
    let isMounted = true

    void settingsApi.get().then((savedSettings) => {
      if (isMounted) {
        setSettings(savedSettings)
        setFiltersExpanded(savedSettings.showAdvancedFilters)
      }
    })

    return () => {
      isMounted = false
    }
  }, [settingsApi])

  useEffect(() => {
    let isMounted = true

    void workspaceApi.getCurrent().then((currentWorkspace) => {
      if (isMounted) {
        setWorkspace(currentWorkspace)
      }
    }).catch(() => {
      if (isMounted) {
        setWorkspace(null)
      }
    })

    return () => {
      isMounted = false
    }
  }, [workspaceApi])

  useEffect(() => {
    const openSettingsFromNativeMenu = () => {
      setSettingsOpen(false)
      setSidebarHoverExpanded(false)
      setNarrowSidebarOpen(false)
      setAppView(APP_VIEWS.SETTINGS)
    }

    window.addEventListener('valedictorian:open-settings', openSettingsFromNativeMenu)

    return () => {
      window.removeEventListener('valedictorian:open-settings', openSettingsFromNativeMenu)
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    setIsLoading(true)
    applicationLoader(query)
      .then((nextResult) => {
        if (isMounted) {
          setResult(nextResult)
          setHasLoadedApplications(true)
          setError(null)
        }
      })
      .catch(() => {
        if (isMounted) {
          setError('Applications could not be loaded.')
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [applicationLoader, applicationReloadKey, query])

  useEffect(() => {
    if (appView !== APP_VIEWS.ACTION_QUEUE) {
      return undefined
    }

    let isMounted = true

    setIsActionQueueLoading(true)
    actionQueueLoader(actionQueueQuery)
      .then((nextResult) => {
        if (isMounted) {
          setActionQueueResult(nextResult)
          setHasLoadedActionQueue(true)
          setActionQueueError(null)
        }
      })
      .catch(() => {
        if (isMounted) {
          setActionQueueError('Action Queue could not be loaded.')
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsActionQueueLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [appView, actionQueueLoader, actionQueueQuery, actionQueueReloadKey])

  useEffect(() => {
    if (appView !== APP_VIEWS.CONNECTORS) {
      return undefined
    }

    let isMounted = true

    setIsConnectorStatusLoading(true)
    connectorStatusLoader()
      .then((nextResult) => {
        if (isMounted) {
          setConnectorStatusResult(nextResult)
          setHasLoadedConnectorStatus(true)
          setConnectorStatusError(null)
        }
      })
      .catch(() => {
        if (isMounted) {
          setConnectorStatusResult(emptyConnectorStatusResult)
          setConnectorStatusError('Connector status could not be loaded.')
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsConnectorStatusLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [appView, connectorStatusLoader, connectorStatusReloadKey])

  useEffect(() => {
    if (appView !== APP_VIEWS.SOURCING) {
      return undefined
    }

    let isMounted = true

    setIsSourcingLoading(true)
    sourcingLoader(sourcingQuery)
      .then((nextResult) => {
        if (isMounted) {
          setSourcingResult(nextResult)
          setHasLoadedSourcing(true)
          setSourcingError(null)
        }
      })
      .catch(() => {
        if (isMounted) {
          setSourcingError('Sourcing findings could not be loaded.')
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsSourcingLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [appView, sourcingLoader, sourcingQuery, sourcingReloadKey])

  useEffect(() => {
    const previousAppView = previousAppViewRef.current

    previousAppViewRef.current = appView

    if (
      appView !== APP_VIEWS.APPLICATIONS ||
      previousAppView === APP_VIEWS.APPLICATIONS ||
      !hasLoadedApplications
    ) {
      return
    }

    reloadApplications()
  }, [appView, hasLoadedApplications])

  useEffect(() => {
    if (!canAutoRefreshData) {
      return undefined
    }

    const refreshActiveDataView = () => {
      if (isDocumentHidden()) {
        return
      }

      if (appView === APP_VIEWS.APPLICATIONS) {
        setApplicationReloadKey((current) => current + 1)
      } else if (appView === APP_VIEWS.ACTION_QUEUE) {
        setActionQueueReloadKey((current) => current + 1)
      } else if (appView === APP_VIEWS.CONNECTORS) {
        setConnectorStatusReloadKey((current) => current + 1)
      } else if (appView === APP_VIEWS.SOURCING) {
        setSourcingReloadKey((current) => current + 1)
      }
    }
    const refreshOnVisible = () => {
      if (!isDocumentHidden()) {
        refreshActiveDataView()
      }
    }
    const intervalId = window.setInterval(refreshActiveDataView, DATA_AUTO_REFRESH_INTERVAL_MS)

    window.addEventListener('focus', refreshOnVisible)
    document.addEventListener('visibilitychange', refreshOnVisible)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshOnVisible)
      document.removeEventListener('visibilitychange', refreshOnVisible)
    }
  }, [appView, canAutoRefreshData])

  useEffect(() => {
    if (updateState?.status !== 'ready') {
      return
    }

    const toastKey = updateState.availableVersion ?? 'unknown'

    if (updateReadyToastVersionsRef.current.has(toastKey)) {
      return
    }

    updateReadyToastVersionsRef.current.add(toastKey)
    toast({
      action: {
        label: 'Restart',
        onClick: installUpdate,
      },
      description: updateState.availableVersion
        ? `Valedictorian ${updateState.availableVersion} has downloaded.`
        : 'A Valedictorian update has downloaded.',
      title: 'Update ready',
      variant: 'success',
    })
  }, [installUpdate, toast, updateState])

  useEffect(() => {
    if (!selectedApplication) {
      return undefined
    }

    let isMounted = true

    setIsAttemptLoading(true)
    attemptLoader(selectedApplication.id)
      .then((nextResult) => {
        if (isMounted) {
          setAttemptResult(nextResult)
          setAttemptError(null)
        }
      })
      .catch(() => {
        if (isMounted) {
          setAttemptResult(emptyAttemptResult)
          setAttemptError('Attempts could not be loaded.')
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsAttemptLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [attemptLoader, selectedApplication])

  useEffect(() => {
    if (!selectedApplication) {
      return undefined
    }

    let isMounted = true
    const applicationId = selectedApplication.id

    setIsApplicationDetailLoading(true)
    applicationDetailLoader(applicationId)
      .then((nextDetail) => {
        if (isMounted) {
          setApplicationDetail(nextDetail)
          setApplicationDetailError(nextDetail ? null : 'Application detail could not be found.')
        }
      })
      .catch(() => {
        if (isMounted) {
          setApplicationDetail(null)
          setApplicationDetailError('Application detail could not be loaded.')
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsApplicationDetailLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [applicationDetailLoader, selectedApplication])

  useEffect(() => {
    if (!selectedApplication) {
      return undefined
    }

    let isMounted = true

    setIsApplicationLinksLoading(true)
    applicationLinksLoader({ applicationId: selectedApplication.id })
      .then((nextResult) => {
        if (isMounted) {
          setApplicationLinksResult(nextResult)
          setApplicationLinksError(null)
        }
      })
      .catch(() => {
        if (isMounted) {
          setApplicationLinksResult(emptyApplicationLinksResult)
          setApplicationLinksError('Links could not be loaded.')
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsApplicationLinksLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [applicationLinksLoader, selectedApplication])

  useEffect(() => {
    if (!selectedApplication) {
      return undefined
    }

    let isMounted = true

    setIsApplicationEventsLoading(true)
    applicationEventsLoader({ applicationId: selectedApplication.id })
      .then((nextResult) => {
        if (isMounted) {
          setApplicationEventsResult(nextResult)
          setApplicationEventsError(null)
        }
      })
      .catch(() => {
        if (isMounted) {
          setApplicationEventsResult(emptyApplicationEventsResult)
          setApplicationEventsError('Events could not be loaded.')
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsApplicationEventsLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [applicationEventsLoader, selectedApplication])

  function updateFilter(key: keyof FilterState, value: string) {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }))
    setOffset(0)
  }

  function resetFilters() {
    setFilters(defaultFilters)
    setOffset(0)
  }

  function updateActionQueueBucket(bucket: ActionQueueBucket | undefined) {
    setActionQueueBucket(bucket)
    setActionQueueOffset(0)
  }

  function updateSourcingMergeStatus(mergeStatus: SourcingMergeStatus | undefined) {
    setSourcingMergeStatus(mergeStatus)
    setSourcingOffset(0)
  }

  function updateSourcingSource(sourceId: string) {
    setSourcingSourceId(sourceId)
    setSourcingOffset(0)
  }

  function reloadApplications() {
    setApplicationReloadKey((current) => current + 1)
  }

  function reloadActionQueue() {
    setActionQueueReloadKey((current) => current + 1)
  }

  function reloadActionQueueIfLoaded() {
    if (appView === APP_VIEWS.ACTION_QUEUE || hasLoadedActionQueue) {
      reloadActionQueue()
    }
  }

  function reloadApplicationViews() {
    reloadApplications()
    reloadActionQueueIfLoaded()
  }

  function reloadSourcing() {
    setSourcingReloadKey((current) => current + 1)
  }

  function reloadConnectorRunOutcomes() {
    setConnectorStatusReloadKey((current) => current + 1)
    reloadSourcing()
    void connectorStatusLoader()
      .then((nextResult) => {
        setConnectorStatusResult(nextResult)
        setHasLoadedConnectorStatus(true)
        setConnectorStatusError(null)
      })
      .catch(() => {
        setConnectorStatusResult(emptyConnectorStatusResult)
        setConnectorStatusError('Connector status could not be loaded.')
      })
    void sourcingLoader(sourcingQuery)
      .then((nextResult) => {
        setSourcingResult(nextResult)
        setHasLoadedSourcing(true)
        setSourcingError(null)
      })
      .catch(() => {
        setSourcingError('Sourcing findings could not be loaded.')
      })
  }

  function handleConnectorStatusAction(
    connector: ConnectorStatusView,
    action: ConnectorStatusAction,
  ) {
    const title = action.id === 'reconnect'
      ? `Reconnect ${connector.displayName}`
      : `Skip ${connector.displayName}`
    const actionPromise = action.id === 'reconnect'
      ? connectorStatusReconnector({ connectorInstanceId: connector.id })
      : connectorStatusSkipper({
        connectorInstanceId: connector.id,
        reason: 'user_skipped_auth_required_run',
      })

    void actionPromise
      .then((result) => {
        toast({
          description: result.message,
          title,
        })
        setConnectorStatusReloadKey((current) => current + 1)
      })
      .catch(() => {
        toast({
          description: 'Connector status action could not be completed.',
          title,
        })
      })
  }

  function promoteFinding(findingId: string) {
    setPromotingFindingId(findingId)
    setSourcingError(null)

    void promoteSourcingFinding({ findingId })
      .then((promotedFinding) => {
        setSourcingResult((current) => ({
          ...current,
          items: current.items.map((item) =>
            item.id === promotedFinding.id ? promotedFinding : item,
          ),
        }))
        reloadApplications()
        reloadActionQueueIfLoaded()
      })
      .catch(() => {
        setSourcingError('Sourcing finding could not be promoted.')
      })
      .finally(() => {
        setPromotingFindingId(null)
      })
  }

  function updateSettings(patch: AppSettingsPatch) {
    const nextSettings = normalizeAppSettings({
      ...settings,
      ...patch,
    })

    setSettings(nextSettings)

    if (typeof patch.showAdvancedFilters === 'boolean') {
      setFiltersExpanded(patch.showAdvancedFilters)
    }

    if (requiresRestart(patch)) {
      setSettingsRestartRequired(true)
    }

    void settingsApi.update(patch).then((savedSettings) => {
      setSettings(savedSettings)

      if (typeof patch.showAdvancedFilters === 'boolean') {
        setFiltersExpanded(savedSettings.showAdvancedFilters)
      }
    })
  }

  function openApplicationDetail(application: ApplicationDetailSeed) {
    setSelectedApplication(application)
    setApplicationDetail(null)
    setApplicationLinksResult(emptyApplicationLinksResult)
    setApplicationEventsResult(emptyApplicationEventsResult)
    setAttemptResult(emptyAttemptResult)
    setApplicationDetailError(null)
    setApplicationLinksError(null)
    setApplicationEventsError(null)
    setAttemptError(null)
  }

  function openActionQueueApplicationEditor(application: ApplicationDetailSeed) {
    void applicationDetailLoader(application.id)
      .then((detail) => {
        if (detail) {
          setEditingApplication(detail)
        } else {
          setActionQueueError('Application detail could not be found.')
        }
      })
      .catch(() => {
        setActionQueueError('Application detail could not be loaded.')
      })
  }

  useEffect(() => {
    if (isNarrowViewport) {
      setSidebarHoverExpanded(false)
    } else {
      setNarrowSidebarOpen(false)
    }
  }, [isNarrowViewport])

  const desktopSidebarState = settings.sidebarCollapsed
    ? sidebarHoverExpanded
      ? 'hover'
      : 'collapsed'
    : 'expanded'
  const sidebarState = isNarrowViewport
    ? narrowSidebarOpen
      ? 'drawer-open'
      : 'drawer-closed'
    : desktopSidebarState
  const sidebarVisible = isNarrowViewport
    ? narrowSidebarOpen
    : desktopSidebarState !== 'collapsed'
  const viewTitle =
    appView === APP_VIEWS.SETTINGS
      ? 'Settings'
      : appView === APP_VIEWS.PROFILE
        ? 'Profile'
        : appView === APP_VIEWS.ACTION_QUEUE
          ? 'Action Queue'
          : appView === APP_VIEWS.CONNECTORS
            ? 'Connectors'
            : appView === APP_VIEWS.CONNECTOR_RUNS
              ? 'Connector Runs'
              : appView === APP_VIEWS.SOURCING
                ? 'Sourcing'
                : 'Applications'
  const contentColumnClass = settings.sidebarCollapsed ? 'md:col-start-2' : ''
  const sidebarToggleCollapsed = isNarrowViewport ? !narrowSidebarOpen : settings.sidebarCollapsed
  const temporaryDesktopSidebar = !isNarrowViewport && desktopSidebarState === 'hover'

  function closeTransientSidebar() {
    setSidebarHoverExpanded(false)
    setNarrowSidebarOpen(false)
  }

  function togglePinnedSidebar() {
    if (isNarrowViewport) {
      setNarrowSidebarOpen((open) => !open)
      return
    }

    const nextCollapsed = !settings.sidebarCollapsed

    if (!nextCollapsed) {
      setSidebarHoverExpanded(false)
    }

    updateSettings({ sidebarCollapsed: nextCollapsed })
  }

  return (
    <TooltipProvider delayDuration={500}>
      <AppShell
      actionQueueBucket={actionQueueBucket}
      actionQueueError={actionQueueError}
      actionQueueOffset={actionQueueOffset}
      actionQueueResult={actionQueueResult}
      appView={appView}
      applicationCreator={applicationCreator}
      applicationDetail={applicationDetail}
      applicationDetailError={applicationDetailError}
      applicationEventsError={applicationEventsError}
      applicationEventsResult={applicationEventsResult}
      applicationLinkCreator={applicationLinkCreator}
      applicationLinkUpdater={applicationLinkUpdater}
      applicationLinksError={applicationLinksError}
      applicationLinksResult={applicationLinksResult}
      applicationNoteAppender={applicationNoteAppender}
      applicationStatusUpdater={applicationStatusUpdater}
      applicationUpdater={applicationUpdater}
      applicationWorkflowUpdater={applicationWorkflowUpdater}
      attemptError={attemptError}
      attemptResult={attemptResult}
      checkForUpdates={checkForUpdates}
      closeTransientSidebar={closeTransientSidebar}
      connectorStatusError={connectorStatusError}
      connectorStatusResult={connectorStatusResult}
      connectorsApi={connectorsApi}
      connectorScheduleApi={connectorScheduleApi}
      contentColumnClass={contentColumnClass}
      createSourcingFinding={createSourcingFinding}
      decideSourcingFinding={decideSourcingFinding}
      editingApplication={editingApplication}
      error={error}
      filters={filters}
      filtersExpanded={filtersExpanded}
      focusedConnectorRunId={focusedConnectorRunId}
      handleConnectorStatusAction={handleConnectorStatusAction}
      hasLoadedActionQueue={hasLoadedActionQueue}
      hasLoadedApplications={hasLoadedApplications}
      hasLoadedConnectorStatus={hasLoadedConnectorStatus}
      hasLoadedSourcing={hasLoadedSourcing}
      installUpdate={installUpdate}
      isActionQueueLoading={isActionQueueLoading}
      isAddingApplication={isAddingApplication}
      isApplicationDetailLoading={isApplicationDetailLoading}
      isApplicationEventsLoading={isApplicationEventsLoading}
      isApplicationLinksLoading={isApplicationLinksLoading}
      isAttemptLoading={isAttemptLoading}
      isConnectorStatusLoading={isConnectorStatusLoading}
      isInitialLoading={isInitialLoading}
      isNarrowViewport={isNarrowViewport}
      isSourcingLoading={isSourcingLoading}
      narrowSidebarOpen={narrowSidebarOpen}
      offset={offset}
      openActionQueueApplicationEditor={openActionQueueApplicationEditor}
      openApplicationDetail={openApplicationDetail}
      policyApi={policyApi}
      profileApi={profileApi}
      promoteFinding={promoteFinding}
      promotingFindingId={promotingFindingId}
      reloadApplicationViews={reloadApplicationViews}
      reloadConnectorRunOutcomes={reloadConnectorRunOutcomes}
      reloadSourcing={reloadSourcing}
      resetFilters={resetFilters}
      result={result}
      scoreRecorder={scoreRecorder}
      selectedApplication={selectedApplication}
      selectedSettingsPanel={selectedSettingsPanel}
      setActionQueueOffset={setActionQueueOffset}
      setAppView={setAppView}
      setEditingApplication={setEditingApplication}
      setFiltersExpanded={setFiltersExpanded}
      setFocusedConnectorRunId={setFocusedConnectorRunId}
      setIsAddingApplication={setIsAddingApplication}
      setNarrowSidebarOpen={setNarrowSidebarOpen}
      setOffset={setOffset}
      setSelectedApplication={setSelectedApplication}
      setSelectedSettingsPanel={setSelectedSettingsPanel}
      setSettingsOpen={setSettingsOpen}
      setSidebarHoverExpanded={setSidebarHoverExpanded}
      setSourcingDestinationClass={setSourcingDestinationClass}
      setSourcingOffset={setSourcingOffset}
      setSourcingUsability={setSourcingUsability}
      settings={settings}
      settingsOpen={settingsOpen}
      settingsRestartRequired={settingsRestartRequired}
      sidebarHoverExpanded={sidebarHoverExpanded}
      sidebarState={sidebarState}
      sidebarToggleCollapsed={sidebarToggleCollapsed}
      sidebarVisible={sidebarVisible}
      sourcingDestinationClass={sourcingDestinationClass}
      sourcingError={sourcingError}
      sourcingMergeStatus={sourcingMergeStatus}
      sourcingOffset={sourcingOffset}
      sourcingResult={sourcingResult}
      sourcingSourceId={sourcingSourceId}
      sourcingUsability={sourcingUsability}
      temporaryDesktopSidebar={temporaryDesktopSidebar}
      viewTitle={viewTitle}
      togglePinnedSidebar={togglePinnedSidebar}
      updateActionQueueBucket={updateActionQueueBucket}
      updateFilter={updateFilter}
      updateSettings={updateSettings}
      updateSourcingFinding={updateSourcingFinding}
      updateSourcingMergeStatus={updateSourcingMergeStatus}
      updateSourcingSource={updateSourcingSource}
      updateState={updateState}
      windowChromeState={windowChromeState}
      workspace={workspace}
      workspaceApi={workspaceApi}
      />
    </TooltipProvider>
  )
}

export default App
