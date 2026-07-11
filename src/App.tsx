import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/toaster'
import { useToast } from '@/components/ui/use-toast'
import { AlertCircle, SlidersHorizontal } from 'lucide-react'
import type { PolicyPreloadApi } from './ipc/policy.preload'
import type { ProfilePreloadApi } from './ipc/profile.preload'
import type { ConnectorsPreloadApi } from './ipc/connectors.preload'
import type { SettingsPreloadApi } from './ipc/settings.preload'
import type { UpdatesPreloadApi } from './ipc/updates.preload'
import type { WorkspacePreloadApi } from './ipc/workspace.preload'
import { ApplicationTable } from './modules/applications/ApplicationTable'
import { ApplicationDetailModal } from './modules/applications/ApplicationDetailModal'
import { ApplicationEditorModal } from './modules/applications/ApplicationEditorModal'
import { ProfileSettingsPanel } from './modules/profile/ProfileSettingsPanel'
import { ActionQueuePage } from './modules/action-queue/ActionQueuePage'
import { ConnectorStatusPage } from './modules/connectors/ConnectorStatusPage'
import type {
  ConnectorStatusAction,
  ConnectorStatusListResult,
  ConnectorStatusView,
} from './modules/connectors/connector.status'
import type {
  LocalConnectorReconnectActionResult,
  LocalConnectorSkipActionInput,
  LocalConnectorSkipActionResult,
  LocalConnectorStatusActionInput,
} from './runtime/local-valedictorian-client'
import { SourcingPage } from './modules/sourcing/SourcingPage'
import { AppSidebar, AppTopbar } from './app/AppChrome'
import { formatEnumLabel } from './app/labels'
import { ConnectorSettingsPanel, SettingsPage, SettingsSidebar } from './settings/SettingsPage'
import { requiresRestart } from './settings/requiresRestart'
import {
  applicationListSorts,
  applicationStatuses,
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
  type UpdateApplicationWorkflowInput,
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
  type UpdateSourcingFindingInput,
} from 'sparxie'
import {
  defaultAppSettings,
  normalizeAppSettings,
  type AppSettings,
  type AppSettingsPatch,
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
  emptySourcingResult,
} from './app/loaders'
import { buildApplicationListQuery, buildActionQueueListQuery, buildSourcingFindingsListQuery } from './app/query'
import { useAppUpdates } from './updates/use-app-updates'
import { useWindowChromeState } from './app/use-window-chrome-state'
import {
  APP_VIEWS,
  PAGE_LIMIT,
  SETTINGS_PANELS,
  defaultFilters,
  type ApplicationDetailSeed,
  type AppView,
  type FilterState,
  type SettingsPanelId,
} from './app/types'
import type { WorkspaceSummary } from './workspace/workspace.initializer'

const narrowSidebarMediaQuery = '(max-width: 767px)'
const DATA_AUTO_REFRESH_INTERVAL_MS = 15_000
const filterControlClassName = 'h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground'
const initialConnectorStatusResult: ConnectorStatusListResult = {
  available: true,
  items: [],
}

function getMediaQueryMatches(query: string) {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false
}

function isDocumentHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => getMediaQueryMatches(query))

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined
    }

    const mediaQueryList = window.matchMedia(query)
    const updateMatches = (event: MediaQueryListEvent) => setMatches(event.matches)

    setMatches(mediaQueryList.matches)
    mediaQueryList.addEventListener('change', updateMatches)

    return () => mediaQueryList.removeEventListener('change', updateMatches)
  }, [query])

  return matches
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
    <div
      className="relative min-h-screen text-foreground"
      data-sidebar-state={sidebarState}
      data-testid="app-shell"
      data-view={appView}
    >
      <AppTopbar
        isFullScreen={windowChromeState.isFullScreen}
        sidebarCollapsed={sidebarToggleCollapsed}
        title={viewTitle}
        updateState={updateState}
        onCheckForUpdates={() => {
          void checkForUpdates()
        }}
        onInstallUpdate={() => {
          void installUpdate()
        }}
        onToggleSidebar={togglePinnedSidebar}
      />
      {!isNarrowViewport && settings.sidebarCollapsed && !sidebarHoverExpanded ? (
        <button
          type="button"
          aria-label="Show sidebar temporarily"
          className="app-no-drag absolute left-0 top-12 z-30 h-[calc(100vh-3rem)] w-2 cursor-default bg-transparent"
          onMouseEnter={() => setSidebarHoverExpanded(true)}
        />
      ) : null}
      <div
        className={`relative grid h-[calc(100vh-3rem)] grid-cols-1 grid-rows-1 overflow-hidden ${
          settings.sidebarCollapsed ? 'md:grid-cols-[0px_1fr]' : 'md:grid-cols-[280px_1fr]'
        }`}
        data-testid="app-layout"
      >
        {isNarrowViewport && narrowSidebarOpen ? (
          <button
            type="button"
            aria-label="Close sidebar drawer"
            className="absolute inset-0 z-30 bg-background/70 md:hidden"
            onClick={() => setNarrowSidebarOpen(false)}
          />
        ) : null}

        {sidebarVisible ? (
          appView === APP_VIEWS.SETTINGS ? (
            <SettingsSidebar
              selectedPanel={selectedSettingsPanel}
              temporary={temporaryDesktopSidebar}
              onBack={() => {
                setAppView(APP_VIEWS.APPLICATIONS)
                closeTransientSidebar()
              }}
              onMouseLeave={() => {
                if (!isNarrowViewport && settings.sidebarCollapsed) {
                  setSidebarHoverExpanded(false)
                }
              }}
              onPanelChange={(panel) => {
                setSelectedSettingsPanel(panel)
                closeTransientSidebar()
              }}
            />
          ) : (
            <AppSidebar
              currentView={appView}
              settings={settings}
              settingsOpen={settingsOpen}
              temporary={temporaryDesktopSidebar}
              onMouseLeave={() => {
                if (!isNarrowViewport && settings.sidebarCollapsed) {
                  setSidebarHoverExpanded(false)
                }
              }}
              onOpenSettingsPage={() => {
                setSettingsOpen(false)
                closeTransientSidebar()
                setAppView(APP_VIEWS.SETTINGS)
              }}
              onOpenProfilePage={() => {
                setSettingsOpen(false)
                closeTransientSidebar()
                setAppView(APP_VIEWS.PROFILE)
              }}
              onViewChange={(view) => {
                closeTransientSidebar()
                setAppView(view)
              }}
              onSettingsOpenChange={setSettingsOpen}
              onSettingsPatch={updateSettings}
            />
          )
        ) : null}

        {appView === APP_VIEWS.SETTINGS ? (
          <SettingsPage
            connectorsApi={connectorsApi}
            contentColumnClass={contentColumnClass}
            policyApi={policyApi}
            profileApi={profileApi}
            restartRequired={settingsRestartRequired}
            selectedPanel={selectedSettingsPanel}
            settings={settings}
            workspace={workspace}
            workspaceApi={workspaceApi}
            onConnectorRunSettled={reloadConnectorRunOutcomes}
            onOpenSourcingRuns={() => setSelectedSettingsPanel(SETTINGS_PANELS.SOURCING_RUNS)}
            onSettingsPatch={updateSettings}
          />
        ) : appView === APP_VIEWS.PROFILE ? (
          <main
            className={`h-full min-w-0 overflow-auto px-5 py-6 text-foreground md:h-[calc(100vh-3rem)] sm:px-8 lg:px-12 ${contentColumnClass}`}
          >
            <div className="mx-auto max-w-4xl">
              <ProfileSettingsPanel profileApi={profileApi} />
            </div>
          </main>
        ) : appView === APP_VIEWS.ACTION_QUEUE ? (
          <ActionQueuePage
            actionBucket={actionQueueBucket}
            contentColumnClass={contentColumnClass}
            isLoading={isActionQueueLoading && !hasLoadedActionQueue}
            result={actionQueueResult}
            error={actionQueueError}
            onActionBucketChange={updateActionQueueBucket}
            onEditApplication={openActionQueueApplicationEditor}
            onNextPage={() => setActionQueueOffset(actionQueueOffset + PAGE_LIMIT)}
            onOpenApplication={openApplicationDetail}
            onPreviousPage={() => setActionQueueOffset(Math.max(0, actionQueueOffset - PAGE_LIMIT))}
          />
        ) : appView === APP_VIEWS.CONNECTORS ? (
          <ConnectorStatusPage
            contentColumnClass={contentColumnClass}
            error={connectorStatusError}
            isLoading={isConnectorStatusLoading && !hasLoadedConnectorStatus}
            operations={(
              <ConnectorSettingsPanel
                connectorsApi={connectorsApi}
                displayMode="main"
                onConnectorChanged={reloadConnectorRunOutcomes}
                profileApi={profileApi}
                onOpenSourcingRuns={() => {
                  setSettingsOpen(false)
                  closeTransientSidebar()
                  setSelectedSettingsPanel(SETTINGS_PANELS.SOURCING_RUNS)
                  setAppView(APP_VIEWS.SETTINGS)
                }}
                onRunSettled={reloadConnectorRunOutcomes}
              />
            )}
            result={connectorStatusResult}
            onAction={handleConnectorStatusAction}
          />
        ) : appView === APP_VIEWS.SOURCING ? (
          <SourcingPage
            contentColumnClass={contentColumnClass}
            error={sourcingError}
            isLoading={isSourcingLoading && !hasLoadedSourcing}
            mergeStatus={sourcingMergeStatus}
            destinationClass={sourcingDestinationClass}
            promotingFindingId={promotingFindingId}
            result={sourcingResult}
            sourceId={sourcingSourceId}
            usability={sourcingUsability}
            onCreateFinding={async (input) => {
              const finding = await createSourcingFinding(input)
              reloadSourcing()
              return finding
            }}
            onDecideFinding={async (input) => {
              const finding = await decideSourcingFinding(input)
              reloadSourcing()
              return finding
            }}
            onMergeStatusChange={updateSourcingMergeStatus}
            onDestinationClassChange={(destinationClass) => {
              setSourcingDestinationClass(destinationClass)
              setSourcingOffset(0)
            }}
            onNextPage={() => setSourcingOffset(sourcingOffset + PAGE_LIMIT)}
            onOpenApplication={openApplicationDetail}
            onPreviousPage={() => setSourcingOffset(Math.max(0, sourcingOffset - PAGE_LIMIT))}
            onPromoteFinding={promoteFinding}
            onSourceChange={updateSourcingSource}
            onUsabilityChange={(usability) => {
              setSourcingUsability(usability)
              setSourcingOffset(0)
            }}
            onUpdateFinding={async (input) => {
              const finding = await updateSourcingFinding(input)
              reloadSourcing()
              return finding
            }}
          />
        ) : (
          <main className={`flex h-full min-w-0 flex-col overflow-hidden px-4 py-5 text-foreground md:h-[calc(100vh-3rem)] sm:px-6 lg:px-8 ${contentColumnClass}`}>
            <section className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4">
              <header className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    Job automation
                  </p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-normal text-foreground">
                    Applications
                  </h1>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="w-fit border border-border bg-card">
                    {result.total} rows
                  </Badge>
                  <Button type="button" onClick={() => setIsAddingApplication(true)}>
                    Add application
                  </Button>
                </div>
              </header>

              <section
                aria-label="Application filters"
                className="rounded-md border border-border bg-card p-4"
              >
                <div className="flex gap-2">
                  <div className="flex-1">
                    <FilterTextInput
                      label="Search"
                      value={filters.search}
                      onChange={(value) => updateFilter('search', value)}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={filtersExpanded ? 'Hide filters' : 'Show filters'}
                      aria-expanded={filtersExpanded}
                      className="h-9 w-9 rounded-md"
                      onClick={() => setFiltersExpanded((current) => !current)}
                    >
                      <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                {filtersExpanded ? (
                  <>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                        Status
                        <select
                          aria-label="Status"
                          className={filterControlClassName}
                          value={filters.status}
                          onChange={(event) => updateFilter('status', event.target.value)}
                        >
                          <option value="">Any status</option>
                          {applicationStatuses.map((status) => (
                            <option key={status} value={status}>
                              {formatEnumLabel(status)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                        Sort
                        <select
                          aria-label="Sort"
                          className={filterControlClassName}
                          value={filters.sort}
                          onChange={(event) => updateFilter('sort', event.target.value)}
                        >
                          {applicationListSorts.map((sort) => (
                            <option key={sort} value={sort}>
                              {formatEnumLabel(sort)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                        Score band
                        <select
                          aria-label="Score band"
                          className={filterControlClassName}
                          value={filters.priorityBand}
                          onChange={(event) => updateFilter('priorityBand', event.target.value)}
                        >
                          <option value="">Any band</option>
                          <option value="high">High</option>
                          <option value="medium">Medium</option>
                          <option value="skip">Skip</option>
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                        Min score
                        <input
                          aria-label="Min score"
                          className={filterControlClassName}
                          min="0"
                          max="10"
                          type="number"
                          value={filters.minScore}
                          onChange={(event) => updateFilter('minScore', event.target.value)}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                        Work mode
                        <select
                          aria-label="Work mode"
                          className={filterControlClassName}
                          value={filters.workMode}
                          onChange={(event) => updateFilter('workMode', event.target.value)}
                        >
                          <option value="">Any mode</option>
                          <option value="remote">Remote</option>
                          <option value="onsite">Onsite</option>
                          <option value="hybrid">Hybrid</option>
                          <option value="unclear">Unclear</option>
                        </select>
                      </label>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <FilterDateInput
                        label="Created from"
                        value={filters.createdFrom}
                        onChange={(value) => updateFilter('createdFrom', value)}
                      />
                      <FilterDateInput
                        label="Created to"
                        value={filters.createdTo}
                        onChange={(value) => updateFilter('createdTo', value)}
                      />
                      <FilterDateInput
                        label="Updated from"
                        value={filters.updatedFrom}
                        onChange={(value) => updateFilter('updatedFrom', value)}
                      />
                      <FilterDateInput
                        label="Updated to"
                        value={filters.updatedTo}
                        onChange={(value) => updateFilter('updatedTo', value)}
                      />
                    </div>
                    <div
                      role="group"
                      aria-label="Filter actions"
                      className="mt-4 flex justify-end border-t border-border pt-3"
                    >
                      <Button type="button" variant="outline" onClick={resetFilters}>
                        Reset filters
                      </Button>
                    </div>
                  </>
                ) : null}
              </section>

              {isInitialLoading ? (
                <div
                  role="status"
                  aria-label="Applications loading"
                  className="rounded-md border border-border bg-card p-4"
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">Loading applications...</p>
                    <Skeleton className="h-2 w-24" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-4/5" />
                  </div>
                </div>
              ) : null}

              {error ? (
                <Alert variant="destructive" className="bg-card">
                  <AlertCircle className="absolute left-4 top-4 h-4 w-4" aria-hidden="true" />
                  <div className="pl-7">
                    <AlertTitle>Load failed</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </div>
                </Alert>
              ) : null}

              {hasLoadedApplications ? (
                <ApplicationTable
                  result={result}
                  sort={filters.sort}
                  onEditApplication={setEditingApplication}
                  onOpenApplication={openApplicationDetail}
                  onSortChange={(nextSort) => updateFilter('sort', nextSort)}
                  onPreviousPage={() => setOffset(Math.max(0, offset - PAGE_LIMIT))}
                  onNextPage={() => setOffset(offset + PAGE_LIMIT)}
                />
              ) : null}
            </section>
          </main>
        )}
      </div>
      {isAddingApplication ? (
        <ApplicationEditorModal
          mode="add"
          onClose={() => setIsAddingApplication(false)}
          onAppendNote={applicationNoteAppender}
          onCreate={applicationCreator}
          onSaved={reloadApplicationViews}
          onUpdate={applicationUpdater}
          onUpdateStatus={applicationStatusUpdater}
          onUpdateWorkflow={applicationWorkflowUpdater}
        />
      ) : null}
      {editingApplication ? (
        <ApplicationEditorModal
          application={editingApplication}
          mode="edit"
          onClose={() => setEditingApplication(null)}
          onAppendNote={applicationNoteAppender}
          onCreate={applicationCreator}
          onSaved={reloadApplicationViews}
          onUpdate={applicationUpdater}
          onUpdateStatus={applicationStatusUpdater}
          onUpdateWorkflow={applicationWorkflowUpdater}
        />
      ) : null}
      {selectedApplication ? (
        <ApplicationDetailModal
          application={applicationDetail ?? selectedApplication}
          attempts={attemptResult.items}
          detailError={applicationDetailError}
          events={applicationEventsResult.items}
          eventsError={applicationEventsError}
          isAttemptsLoading={isAttemptLoading}
          isDetailLoading={isApplicationDetailLoading}
          isEventsLoading={isApplicationEventsLoading}
          isLinksLoading={isApplicationLinksLoading}
          links={applicationLinksResult.items}
          linksError={applicationLinksError}
          attemptsError={attemptError}
          onCreateLink={async (input) => {
            const link = await applicationLinkCreator(input)
            reloadApplicationViews()
            return link
          }}
          onRecordScore={async (input) => {
            const score = await scoreRecorder(input)
            reloadApplicationViews()
            return score
          }}
          onUpdateLink={async (input) => {
            const link = await applicationLinkUpdater(input)
            reloadApplicationViews()
            return link
          }}
          onClose={() => setSelectedApplication(null)}
        />
      ) : null}
      <Toaster />
    </div>
  )
}

interface FilterInputProps {
  label: string
  value: string
  onChange: (value: string) => void
}

function FilterTextInput({ label, value, onChange }: FilterInputProps) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <input
        aria-label={label}
        className={filterControlClassName}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function FilterDateInput({ label, value, onChange }: FilterInputProps) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <input
        aria-label={label}
        className={filterControlClassName}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

export default App
