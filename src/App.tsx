import { useEffect, useMemo, useRef, useState } from 'react'
import { clearDestructiveToastDedupeFor, useToast } from '@/components/ui/use-toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import { actionFailureToastInput, type ErrorPresentation } from './app/error-presentation'
import {
  actionQueueLoadFailure,
  applicationsLoadFailure,
  connectorStatusLoadFailure,
  sourcingLoadFailure,
} from './app/app-load-failure'
import {
  GlobalFailureOwnerProvider,
  takeLocalLoadFailure,
  useCreateGlobalFailureOwner,
} from './app/global-failure-owner'
import { useApplicationDetailSubsectionLoads } from './app/use-application-detail-subsection-loads'
import { useOpportunityAndActionQueueMutations } from './app/use-opportunity-and-action-queue-mutations'
import { useAppBootstrapLoads } from './app/use-app-bootstrap-loads'
import type { PolicyPreloadApi } from './ipc/policy.preload'
import type { ProfilePreloadApi } from './ipc/profile.preload'
import type { ConnectorsPreloadApi } from './ipc/connectors.preload'
import type { ConnectorSkipActionResult } from './ipc/connectors.public'
import type { SettingsPreloadApi } from './ipc/settings.preload'
import type { UpdatesPreloadApi } from './ipc/updates.preload'
import type { WorkspacePreloadApi } from './ipc/workspace.preload'
import type {
  ConnectorStatusAction,
  ConnectorStatusListResult,
  ConnectorStatusView
} from './modules/connectors/connector.status'
import { performConnectorStatusAction } from './modules/connectors/connector-status-actions'
import type {
  LocalConnectorReconnectActionResult,
  LocalConnectorSkipActionInput,
  LocalConnectorStatusActionInput
} from './runtime/local-valedictorian-client'
import {
  applyOptimisticSettingsPatch,
  commitSettingsPatch,
  createSettingsMutationTargetGate,
  settingsPatchKeys,
} from './app/settings-mutation'
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
  type AppSettingsPatch
} from './settings/app-settings'
import { applyResolvedTheme } from './theme/theme-applier'
import { resolveTheme } from './theme/theme-registry'
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
  defaultRawRecordsApi,
  defaultUpdateSourcingFinding,
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
  PAGE_LIMIT,
  SETTINGS_PANELS,
  defaultFilters,
  type AppView,
  type FilterState,
  type SettingsPanelId
} from './app/types'
import type { ConnectorScheduleUiApi } from './settings/connector-schedule.types'
import type { RawNormalizationRunFilter, RawRecordsReadApi } from './modules/sourcing/raw-normalization.types'
import { locateSourcingFinding } from './modules/sourcing/locate-sourcing-finding'

const narrowSidebarMediaQuery = '(max-width: 767px)'
const DATA_AUTO_REFRESH_INTERVAL_MS = 15_000

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
  ) => Promise<ConnectorSkipActionResult>
  connectorsApi?: ConnectorsPreloadApi
  connectorScheduleApi?: ConnectorScheduleUiApi
  scoreRecorder?: (input: ScoreInput) => Promise<ScoreRecord>
  sourcingLoader?: (input: SourcingFindingsListInput) => Promise<SourcingFindingsListResult>
  rawRecordsApi?: RawRecordsReadApi
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
  rawRecordsApi = defaultRawRecordsApi,
  promoteSourcingFinding = defaultPromoteSourcingFinding,
  decideSourcingFinding = defaultDecideSourcingFinding,
  updateSourcingFinding = defaultUpdateSourcingFinding,
  policyApi = defaultPolicyApi,
  profileApi = defaultProfileApi,
  settingsApi = defaultSettingsApi,
  updatesApi = defaultUpdatesApi,
  workspaceApi = defaultWorkspaceApi,
}: AppProps) {
  const {
    filtersExpanded,
    reloadSettings,
    reloadWorkspace,
    setFiltersExpanded,
    setSettings,
    settings,
    settingsLoadFailure,
    workspace,
    workspaceLoadFailure,
  } = useAppBootstrapLoads({ settingsApi, workspaceApi })
  const [filters, setFilters] = useState<FilterState>(defaultFilters)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [appView, setAppView] = useState<AppView>(APP_VIEWS.APPLICATIONS)
  const [selectedSettingsPanel, setSelectedSettingsPanel] = useState<SettingsPanelId>(
    SETTINGS_PANELS.GENERAL,
  )
  const [focusedConnectorRunId, setFocusedConnectorRunId] = useState<string | null>(null)
  const [normalizationRunFilter, setNormalizationRunFilter] = useState<RawNormalizationRunFilter | null>(null)
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
  const [error, setError] = useState<ErrorPresentation | null>(null)
  const [actionQueueBucket, setActionQueueBucket] = useState<ActionQueueBucket | undefined>(undefined)
  const [actionQueueOffset, setActionQueueOffset] = useState(0)
  const [actionQueueReloadKey, setActionQueueReloadKey] = useState(0)
  const [actionQueueResult, setActionQueueResult] = useState<ActionQueueListResult>(emptyActionQueueResult)
  const [isActionQueueLoading, setIsActionQueueLoading] = useState(false)
  const [hasLoadedActionQueue, setHasLoadedActionQueue] = useState(false)
  const [actionQueueError, setActionQueueError] = useState<ErrorPresentation | null>(null)
  const [connectorStatusReloadKey, setConnectorStatusReloadKey] = useState(0)
  const [connectorStatusResult, setConnectorStatusResult] = useState<ConnectorStatusListResult>(emptyConnectorStatusResult)
  const [isConnectorStatusLoading, setIsConnectorStatusLoading] = useState(false)
  const [hasLoadedConnectorStatus, setHasLoadedConnectorStatus] = useState(false)
  const [connectorStatusError, setConnectorStatusError] = useState<ErrorPresentation | null>(null)
  const connectorBackendGenerationRef = useRef(0)
  const hasLoadedApplicationsRef = useRef(false)
  const hasLoadedActionQueueRef = useRef(false)
  const hasLoadedConnectorStatusRef = useRef(false)
  const hasLoadedSourcingRef = useRef(false)
  const globalFailureOwner = useCreateGlobalFailureOwner()
  const globalFailureOwnerRef = useRef(globalFailureOwner)
  globalFailureOwnerRef.current = globalFailureOwner
  const applicationsQueryIdentityRef = useRef<ApplicationListQuery | null>(null)
  const actionQueueQueryIdentityRef = useRef<ActionQueueListQuery | null>(null)
  const sourcingQueryIdentityRef = useRef<{
    pendingFindingId: string | null
    query: SourcingFindingsListInput
  } | null>(null)
  const [sourcingMergeStatus, setSourcingMergeStatus] = useState<SourcingMergeStatus | undefined>(undefined)
  const [sourcingDestinationClass, setSourcingDestinationClass] = useState<SourcingDestinationClass | undefined>(undefined)
  const [sourcingUsability, setSourcingUsability] = useState<SourcingUsability | undefined>(undefined)
  const [sourcingSourceId, setSourcingSourceId] = useState('')
  const [sourcingOffset, setSourcingOffset] = useState(0)
  const [sourcingReloadKey, setSourcingReloadKey] = useState(0)
  const [sourcingResult, setSourcingResult] = useState<SourcingFindingsListResult>(emptySourcingResult)
  const [isSourcingLoading, setIsSourcingLoading] = useState(false)
  const [hasLoadedSourcing, setHasLoadedSourcing] = useState(false)
  const [sourcingError, setSourcingError] = useState<ErrorPresentation | null>(null)
  const [focusedSourcingFindingId, setFocusedSourcingFindingId] = useState<string | null>(null)
  const [pendingSourcingFindingId, setPendingSourcingFindingId] = useState<string | null>(null)
  const {
    attemptError,
    attemptResult,
    applicationDetail,
    applicationDetailError,
    applicationEventsError,
    applicationEventsResult,
    applicationLinksError,
    applicationLinksResult,
    isApplicationDetailLoading,
    isApplicationEventsLoading,
    isApplicationLinksLoading,
    isAttemptLoading,
    openApplicationDetail,
    reloadApplicationDetail,
    selectedApplication,
    setSelectedApplication,
  } = useApplicationDetailSubsectionLoads({
    applicationDetailLoader,
    applicationEventsLoader,
    applicationLinksLoader,
    attemptLoader,
  })
  const { checkForUpdates, installUpdate, updateState } = useAppUpdates(updatesApi)
  const { toast } = useToast()
  const [editingApplication, setEditingApplication] = useState<ApplicationListItem | null>(null)
  const [isAddingApplication, setIsAddingApplication] = useState(false)
  const previousAppViewRef = useRef(appView)
  const updateReadyToastVersionsRef = useRef(new Set<string>())
  const settingsKeyGenerationRef = useRef<Record<string, number>>({})
  const settingsApiRef = useRef(settingsApi)
  const committedSettingsRef = useRef(settings)
  const settingsMutationTargetGateRef = useRef(createSettingsMutationTargetGate())
  const isAppMountedRef = useRef(true)

  if (settingsApiRef.current !== settingsApi) {
    settingsApiRef.current = settingsApi
    for (const key of Object.keys(settingsKeyGenerationRef.current)) {
      settingsKeyGenerationRef.current[key] += 1
    }
    settingsMutationTargetGateRef.current.replaceTarget()
  }
  const {
    openActionQueueApplicationEditor,
    promoteFinding,
    promotingFindingIds,
  } = useOpportunityAndActionQueueMutations({
    applicationDetailLoader,
    isAppMountedRef,
    promoteSourcingFinding,
    reloadActionQueueIfLoaded: () => {
      if (appView === APP_VIEWS.ACTION_QUEUE || hasLoadedActionQueue) {
        setActionQueueReloadKey((current) => current + 1)
      }
    },
    reloadApplications: () => {
      setApplicationReloadKey((current) => current + 1)
    },
    setEditingApplication,
    setSourcingResult,
  })
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
    applyResolvedTheme(resolveTheme(settings.theme))
  }, [settings.theme])

  useEffect(() => {
    if (settingsMutationTargetGateRef.current.isIdle()) {
      committedSettingsRef.current = settings
    }
  }, [settings])

  useEffect(() => {
    const gate = settingsMutationTargetGateRef.current
    isAppMountedRef.current = true
    return () => {
      isAppMountedRef.current = false
      gate.invalidate()
      clearDestructiveToastDedupeFor('settings:update')
    }
  }, [])

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
    const binding = (window as Window & {
      valedictorianHttp?: {
        onBackendStateChanged?(listener: (state: { status: string }) => void): () => void
      }
    }).valedictorianHttp
    return binding?.onBackendStateChanged?.((state) => {
      connectorBackendGenerationRef.current += 1
      if (state.status === 'available') {
        setConnectorStatusReloadKey((current) => current + 1)
      } else {
        setConnectorStatusResult(emptyConnectorStatusResult)
        hasLoadedConnectorStatusRef.current = true
        setHasLoadedConnectorStatus(true)
        setIsConnectorStatusLoading(false)
        setConnectorStatusError(null)
      }
    })
  }, [])

  useEffect(() => {
    let isMounted = true
    const previousQuery = applicationsQueryIdentityRef.current
    const queryChanged = previousQuery !== null && previousQuery !== query
    applicationsQueryIdentityRef.current = query

    setIsLoading(true)
    if (queryChanged) {
      setResult(emptyApplicationResult)
      setError(null)
      hasLoadedApplicationsRef.current = false
      setHasLoadedApplications(false)
    }

    applicationLoader(query)
      .then((nextResult) => {
        if (isMounted) {
          setResult(nextResult)
          hasLoadedApplicationsRef.current = true
          setHasLoadedApplications(true)
          setError(null)
          globalFailureOwnerRef.current.clearGlobalFailure('applications')
        }
      })
      .catch((loadError: unknown) => {
        if (isMounted) {
          const failure = applicationsLoadFailure(loadError, hasLoadedApplicationsRef.current)
          setError(takeLocalLoadFailure(
            failure,
            globalFailureOwnerRef.current,
            'applications',
            () => setApplicationReloadKey((current) => current + 1),
          ))
          if (!failure && !hasLoadedApplicationsRef.current) {
            hasLoadedApplicationsRef.current = true
            setHasLoadedApplications(true)
          }
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
    const previousQuery = actionQueueQueryIdentityRef.current
    const queryChanged = previousQuery !== null && previousQuery !== actionQueueQuery
    actionQueueQueryIdentityRef.current = actionQueueQuery

    setIsActionQueueLoading(true)
    if (queryChanged) {
      setActionQueueResult(emptyActionQueueResult)
      setActionQueueError(null)
      hasLoadedActionQueueRef.current = false
      setHasLoadedActionQueue(false)
    }

    actionQueueLoader(actionQueueQuery)
      .then((nextResult) => {
        if (isMounted) {
          setActionQueueResult(nextResult)
          hasLoadedActionQueueRef.current = true
          setHasLoadedActionQueue(true)
          setActionQueueError(null)
          globalFailureOwnerRef.current.clearGlobalFailure('action-queue')
        }
      })
      .catch((loadError: unknown) => {
        if (isMounted) {
          const failure = actionQueueLoadFailure(loadError, hasLoadedActionQueueRef.current)
          setActionQueueError(takeLocalLoadFailure(
            failure,
            globalFailureOwnerRef.current,
            'action-queue',
            () => setActionQueueReloadKey((current) => current + 1),
          ))
          if (!failure && !hasLoadedActionQueueRef.current) {
            hasLoadedActionQueueRef.current = true
            setHasLoadedActionQueue(true)
          }
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
    const requestGeneration = connectorBackendGenerationRef.current

    setIsConnectorStatusLoading(true)
    connectorStatusLoader()
      .then((nextResult) => {
        if (isMounted && requestGeneration === connectorBackendGenerationRef.current) {
          setConnectorStatusResult(nextResult)
          hasLoadedConnectorStatusRef.current = true
          setHasLoadedConnectorStatus(true)
          setConnectorStatusError(null)
          globalFailureOwnerRef.current.clearGlobalFailure('connector-status')
        }
      })
      .catch((loadError: unknown) => {
        if (isMounted && requestGeneration === connectorBackendGenerationRef.current) {
          const failure = connectorStatusLoadFailure(loadError, hasLoadedConnectorStatusRef.current)
          setConnectorStatusError(takeLocalLoadFailure(
            failure,
            globalFailureOwnerRef.current,
            'connector-status',
            () => setConnectorStatusReloadKey((current) => current + 1),
          ))
          if (!failure && !hasLoadedConnectorStatusRef.current) {
            hasLoadedConnectorStatusRef.current = true
            setHasLoadedConnectorStatus(true)
          }
        }
      })
      .finally(() => {
        if (isMounted && requestGeneration === connectorBackendGenerationRef.current) {
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
    const nextIdentity = {
      pendingFindingId: pendingSourcingFindingId,
      query: sourcingQuery,
    }
    const previousIdentity = sourcingQueryIdentityRef.current
    const queryChanged = previousIdentity !== null && (
      previousIdentity.query !== nextIdentity.query
      || previousIdentity.pendingFindingId !== nextIdentity.pendingFindingId
    )
    sourcingQueryIdentityRef.current = nextIdentity

    setIsSourcingLoading(true)
    if (queryChanged) {
      setSourcingResult(emptySourcingResult)
      setSourcingError(null)
      hasLoadedSourcingRef.current = false
      setHasLoadedSourcing(false)
    }

    const request = pendingSourcingFindingId
      ? locateSourcingFinding(sourcingLoader, pendingSourcingFindingId, PAGE_LIMIT)
      : sourcingLoader(sourcingQuery)
    request
      .then((nextResult) => {
        if (isMounted) {
          if (!nextResult) {
            setSourcingError({
              message: `Opportunity ${pendingSourcingFindingId} could not be located.`,
              retryable: true,
              surface: 'scoped_load',
              title: 'Load failed',
            })
            return
          }
          setSourcingResult(nextResult)
          if (pendingSourcingFindingId) {
            setSourcingOffset(nextResult.offset)
            setPendingSourcingFindingId(null)
          }
          hasLoadedSourcingRef.current = true
          setHasLoadedSourcing(true)
          setSourcingError(null)
          globalFailureOwnerRef.current.clearGlobalFailure('sourcing')
        }
      })
      .catch((loadError: unknown) => {
        if (isMounted) {
          const failure = sourcingLoadFailure(loadError, hasLoadedSourcingRef.current)
          setSourcingError(takeLocalLoadFailure(
            failure,
            globalFailureOwnerRef.current,
            'sourcing',
            () => setSourcingReloadKey((current) => current + 1),
          ))
          if (!failure && !hasLoadedSourcingRef.current) {
            hasLoadedSourcingRef.current = true
            setHasLoadedSourcing(true)
          }
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
  }, [appView, pendingSourcingFindingId, sourcingLoader, sourcingQuery, sourcingReloadKey])

  function openSourcingFinding(findingId: string) {
    setSourcingMergeStatus(undefined)
    setSourcingDestinationClass(undefined)
    setSourcingUsability(undefined)
    setSourcingSourceId('')
    setSourcingOffset(0)
    setFocusedSourcingFindingId(findingId)
    setPendingSourcingFindingId(findingId)
    setAppView(APP_VIEWS.SOURCING)
  }

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

  function reloadConnectorStatus() {
    setConnectorStatusReloadKey((current) => current + 1)
  }

  function reloadConnectorRunOutcomes() {
    if (!isAppMountedRef.current) {
      return
    }
    setConnectorStatusReloadKey((current) => current + 1)
    reloadSourcing()
  }

  function handleConnectorStatusAction(
    connector: ConnectorStatusView,
    action: ConnectorStatusAction,
  ) {
    performConnectorStatusAction({
      action, connector, reconnect: connectorStatusReconnector, skip: connectorStatusSkipper,
      onCompleted: () => setConnectorStatusReloadKey((current) => current + 1), toast,
    })
  }

  function notifySettingsPatchFailure(error: unknown) {
    if (!isAppMountedRef.current) {
      return
    }
    toast(actionFailureToastInput(error, {
      fallbackMessage: 'Settings could not be saved.',
      operationId: 'settings:update',
    }))
  }

  function updateSettings(patch: AppSettingsPatch): Promise<void> {
    const apiTarget = settingsApi
    const operation: Record<string, number> = {}
    for (const key of settingsPatchKeys(patch)) {
      const next = (settingsKeyGenerationRef.current[key] ?? 0) + 1
      settingsKeyGenerationRef.current[key] = next
      operation[key] = next
    }
    const membership = settingsMutationTargetGateRef.current.begin()
    applyOptimisticSettingsPatch({
      patch,
      previousSettings: settings,
      setFiltersExpanded,
      setSettings,
    })
    return commitSettingsPatch({
      getCommittedSettings: () => committedSettingsRef.current,
      isActiveApiTarget: () => (
        settingsApiRef.current === apiTarget
        && membership.belongsToCurrentTarget()
      ),
      isCurrentOperation: () => Object.entries(operation).every(
        ([key, generation]) => settingsKeyGenerationRef.current[key] === generation,
      ),
      patch,
      setCommittedSettings: (next) => {
        committedSettingsRef.current = next
      },
      setFiltersExpanded,
      setSettings,
      setSettingsRestartRequired,
      settingsApi: apiTarget,
    }).finally(() => {
      membership.end()
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
              : appView === APP_VIEWS.SOURCING_NORMALIZATION
                ? 'Sourcing · Normalization'
              : appView === APP_VIEWS.SOURCING
                ? 'Opportunities'
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

    void updateSettings({ sidebarCollapsed: nextCollapsed }).catch(notifySettingsPatchFailure)
  }

  return (
    <TooltipProvider delayDuration={500}>
      <GlobalFailureOwnerProvider value={globalFailureOwner}>
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
      openSourcingFinding={openSourcingFinding}
      policyApi={policyApi}
      profileApi={profileApi}
      rawRecordsApi={rawRecordsApi}
      normalizationRunFilter={normalizationRunFilter}
      promoteFinding={promoteFinding}
      promotingFindingIds={promotingFindingIds}
      reloadApplicationViews={reloadApplicationViews}
      reloadApplications={reloadApplications}
      reloadActionQueue={reloadActionQueue}
      reloadApplicationDetail={reloadApplicationDetail}
      reloadConnectorStatus={reloadConnectorStatus}
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
      setNormalizationRunFilter={setNormalizationRunFilter}
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
      settingsLoadFailure={settingsLoadFailure}
      settingsOpen={settingsOpen}
      settingsRestartRequired={settingsRestartRequired}
      reloadSettings={reloadSettings}
      reloadWorkspace={reloadWorkspace}
      sidebarHoverExpanded={sidebarHoverExpanded}
      sidebarState={sidebarState}
      sidebarToggleCollapsed={sidebarToggleCollapsed}
      sidebarVisible={sidebarVisible}
      sourcingDestinationClass={sourcingDestinationClass}
      sourcingError={sourcingError}
      focusedSourcingFindingId={focusedSourcingFindingId}
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
      workspaceLoadFailure={workspaceLoadFailure}
      />
      </GlobalFailureOwnerProvider>
    </TooltipProvider>
  )
}

export default App
