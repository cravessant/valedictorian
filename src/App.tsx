import { useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/toaster'
import { AlertCircle, SlidersHorizontal } from 'lucide-react'
import type { PolicyPreloadApi } from './ipc/policy.preload'
import type { ProfilePreloadApi } from './ipc/profile.preload'
import type { SettingsPreloadApi } from './ipc/settings.preload'
import { ApplicationTable } from './modules/applications/ApplicationTable'
import { ApplicationDetailModal } from './modules/applications/ApplicationDetailModal'
import { ApplicationEditorModal } from './modules/applications/ApplicationEditorModal'
import { ProfileSettingsPanel } from './modules/profile/ProfileSettingsPanel'
import { QueuePage } from './modules/queue/QueuePage'
import { SourcingPage } from './modules/sourcing/SourcingPage'
import { AppSidebar, AppTopbar } from './app/AppChrome'
import { SettingsPage, SettingsSidebar } from './settings/SettingsPage'
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
  type QueueBucket,
  type QueueListQuery,
  type QueueListResult,
  type PromoteSourcingFindingInput,
  type ScoreInput,
  type SetSourcingFindingDecisionInput,
  type SourcingFinding,
  type SourcingFindingsListInput,
  type SourcingFindingsListResult,
  type SourcingMergeStatus,
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
  defaultQueueLoader,
  defaultScoreRecorder,
  defaultSettingsApi,
  defaultSourcingLoader,
  defaultUpdateSourcingFinding,
  emptyApplicationEventsResult,
  emptyApplicationLinksResult,
  emptyAttemptResult,
  emptyApplicationResult,
  emptyQueueResult,
  emptySourcingResult,
} from './app/loaders'
import { buildApplicationListQuery, buildQueueListQuery, buildSourcingFindingsListQuery } from './app/query'
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
  queueLoader?: (query: QueueListQuery) => Promise<QueueListResult>
  scoreRecorder?: (input: ScoreInput) => Promise<void>
  sourcingLoader?: (input: SourcingFindingsListInput) => Promise<SourcingFindingsListResult>
  promoteSourcingFinding?: (input: PromoteSourcingFindingInput) => Promise<SourcingFinding>
  decideSourcingFinding?: (input: SetSourcingFindingDecisionInput) => Promise<SourcingFinding>
  updateSourcingFinding?: (input: UpdateSourcingFindingInput) => Promise<SourcingFinding>
  profileApi?: ProfilePreloadApi
  policyApi?: PolicyPreloadApi
  settingsApi?: SettingsPreloadApi
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
  queueLoader = defaultQueueLoader,
  scoreRecorder = defaultScoreRecorder,
  sourcingLoader = defaultSourcingLoader,
  promoteSourcingFinding = defaultPromoteSourcingFinding,
  decideSourcingFinding = defaultDecideSourcingFinding,
  updateSourcingFinding = defaultUpdateSourcingFinding,
  policyApi = defaultPolicyApi,
  profileApi = defaultProfileApi,
  settingsApi = defaultSettingsApi,
}: AppProps) {
  const [filters, setFilters] = useState<FilterState>(defaultFilters)
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [appView, setAppView] = useState<AppView>(APP_VIEWS.APPLICATIONS)
  const [selectedSettingsPanel, setSelectedSettingsPanel] = useState<SettingsPanelId>(
    SETTINGS_PANELS.GENERAL,
  )
  const [settingsRestartRequired, setSettingsRestartRequired] = useState(false)
  const [sidebarHoverExpanded, setSidebarHoverExpanded] = useState(false)
  const [offset, setOffset] = useState(0)
  const [applicationReloadKey, setApplicationReloadKey] = useState(0)
  const [result, setResult] = useState<ApplicationListResult>(emptyApplicationResult)
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoadedApplications, setHasLoadedApplications] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queueBucket, setQueueBucket] = useState<QueueBucket | undefined>(undefined)
  const [queueOffset, setQueueOffset] = useState(0)
  const [queueReloadKey, setQueueReloadKey] = useState(0)
  const [queueResult, setQueueResult] = useState<QueueListResult>(emptyQueueResult)
  const [isQueueLoading, setIsQueueLoading] = useState(false)
  const [hasLoadedQueue, setHasLoadedQueue] = useState(false)
  const [queueError, setQueueError] = useState<string | null>(null)
  const [sourcingMergeStatus, setSourcingMergeStatus] = useState<SourcingMergeStatus | undefined>(undefined)
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
  const [attemptResult, setAttemptResult] = useState<ApplicationAttemptsListResult>(emptyAttemptResult)
  const [isAttemptLoading, setIsAttemptLoading] = useState(false)
  const [attemptError, setAttemptError] = useState<string | null>(null)
  const [editingApplication, setEditingApplication] = useState<ApplicationListItem | null>(null)
  const [isAddingApplication, setIsAddingApplication] = useState(false)
  const query = useMemo(() => buildApplicationListQuery(filters, offset), [filters, offset])
  const queueQuery = useMemo(
    () => buildQueueListQuery(queueBucket, queueOffset),
    [queueBucket, queueOffset],
  )
  const sourcingQuery = useMemo(
    () => buildSourcingFindingsListQuery(sourcingMergeStatus, sourcingSourceId, sourcingOffset),
    [sourcingMergeStatus, sourcingOffset, sourcingSourceId],
  )
  const isInitialLoading = isLoading && !hasLoadedApplications

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
    if (appView !== APP_VIEWS.QUEUE) {
      return undefined
    }

    let isMounted = true

    setIsQueueLoading(true)
    queueLoader(queueQuery)
      .then((nextResult) => {
        if (isMounted) {
          setQueueResult(nextResult)
          setHasLoadedQueue(true)
          setQueueError(null)
        }
      })
      .catch(() => {
        if (isMounted) {
          setQueueError('Queue could not be loaded.')
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsQueueLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [appView, queueLoader, queueQuery, queueReloadKey])

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

  function updateQueueBucket(bucket: QueueBucket | undefined) {
    setQueueBucket(bucket)
    setQueueOffset(0)
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

  function reloadQueue() {
    setQueueReloadKey((current) => current + 1)
  }

  function reloadQueueIfLoaded() {
    if (appView === APP_VIEWS.QUEUE || hasLoadedQueue) {
      reloadQueue()
    }
  }

  function reloadApplicationViews() {
    reloadApplications()
    reloadQueueIfLoaded()
  }

  function reloadSourcing() {
    setSourcingReloadKey((current) => current + 1)
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
        reloadQueueIfLoaded()
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

  function openQueueApplicationEditor(application: ApplicationDetailSeed) {
    void applicationDetailLoader(application.id)
      .then((detail) => {
        if (detail) {
          setEditingApplication(detail)
        } else {
          setQueueError('Application detail could not be found.')
        }
      })
      .catch(() => {
        setQueueError('Application detail could not be loaded.')
      })
  }

  const sidebarState = settings.sidebarCollapsed
    ? sidebarHoverExpanded
      ? 'hover'
      : 'collapsed'
    : 'expanded'
  const sidebarVisible = sidebarState !== 'collapsed'
  const viewTitle =
    appView === APP_VIEWS.SETTINGS
      ? 'Settings'
      : appView === APP_VIEWS.PROFILE
        ? 'Profile'
        : appView === APP_VIEWS.QUEUE
          ? 'Queue'
          : appView === APP_VIEWS.SOURCING
            ? 'Sourcing'
            : 'Applications'
  const contentColumnClass = settings.sidebarCollapsed ? 'col-start-2' : ''

  function togglePinnedSidebar() {
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
        sidebarCollapsed={settings.sidebarCollapsed}
        title={viewTitle}
        onToggleSidebar={togglePinnedSidebar}
      />
      {settings.sidebarCollapsed && !sidebarHoverExpanded ? (
        <button
          type="button"
          aria-label="Show sidebar temporarily"
          className="app-no-drag absolute left-0 top-12 z-30 h-[calc(100vh-3rem)] w-2 cursor-default bg-transparent"
          onMouseEnter={() => setSidebarHoverExpanded(true)}
        />
      ) : null}
      <div
        className={`relative grid h-[calc(100vh-3rem)] overflow-hidden ${
          settings.sidebarCollapsed ? 'grid-cols-[0px_1fr]' : 'grid-cols-[280px_1fr]'
        }`}
      >
        {sidebarVisible ? (
          appView === APP_VIEWS.SETTINGS ? (
            <SettingsSidebar
              selectedPanel={selectedSettingsPanel}
              temporary={sidebarState === 'hover'}
              onBack={() => {
                setAppView(APP_VIEWS.APPLICATIONS)
                setSidebarHoverExpanded(false)
              }}
              onMouseLeave={() => {
                if (settings.sidebarCollapsed) {
                  setSidebarHoverExpanded(false)
                }
              }}
              onPanelChange={setSelectedSettingsPanel}
            />
          ) : (
            <AppSidebar
              currentView={appView}
              settings={settings}
              settingsOpen={settingsOpen}
              temporary={sidebarState === 'hover'}
              onMouseLeave={() => {
                if (settings.sidebarCollapsed) {
                  setSidebarHoverExpanded(false)
                }
              }}
              onOpenSettingsPage={() => {
                setSettingsOpen(false)
                setSidebarHoverExpanded(false)
                setAppView(APP_VIEWS.SETTINGS)
              }}
              onOpenProfilePage={() => {
                setSettingsOpen(false)
                setSidebarHoverExpanded(false)
                setAppView(APP_VIEWS.PROFILE)
              }}
              onViewChange={(view) => {
                setSidebarHoverExpanded(false)
                setAppView(view)
              }}
              onSettingsOpenChange={setSettingsOpen}
              onSettingsPatch={updateSettings}
            />
          )
        ) : null}

        {appView === APP_VIEWS.SETTINGS ? (
          <SettingsPage
            contentColumnClass={contentColumnClass}
            policyApi={policyApi}
            profileApi={profileApi}
            restartRequired={settingsRestartRequired}
            selectedPanel={selectedSettingsPanel}
            settings={settings}
            onSettingsPatch={updateSettings}
          />
        ) : appView === APP_VIEWS.PROFILE ? (
          <main
            className={`h-[calc(100vh-3rem)] min-w-0 overflow-auto px-5 py-6 text-foreground sm:px-8 lg:px-12 ${contentColumnClass}`}
          >
            <div className="mx-auto max-w-4xl">
              <ProfileSettingsPanel profileApi={profileApi} />
            </div>
          </main>
        ) : appView === APP_VIEWS.QUEUE ? (
          <QueuePage
            bucket={queueBucket}
            contentColumnClass={contentColumnClass}
            isLoading={isQueueLoading && !hasLoadedQueue}
            result={queueResult}
            error={queueError}
            onBucketChange={updateQueueBucket}
            onEditApplication={openQueueApplicationEditor}
            onNextPage={() => setQueueOffset(queueOffset + PAGE_LIMIT)}
            onOpenApplication={openApplicationDetail}
            onPreviousPage={() => setQueueOffset(Math.max(0, queueOffset - PAGE_LIMIT))}
          />
        ) : appView === APP_VIEWS.SOURCING ? (
          <SourcingPage
            contentColumnClass={contentColumnClass}
            error={sourcingError}
            isLoading={isSourcingLoading && !hasLoadedSourcing}
            mergeStatus={sourcingMergeStatus}
            promotingFindingId={promotingFindingId}
            result={sourcingResult}
            sourceId={sourcingSourceId}
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
            onNextPage={() => setSourcingOffset(sourcingOffset + PAGE_LIMIT)}
            onOpenApplication={openApplicationDetail}
            onPreviousPage={() => setSourcingOffset(Math.max(0, sourcingOffset - PAGE_LIMIT))}
            onPromoteFinding={promoteFinding}
            onSourceChange={updateSourcingSource}
            onUpdateFinding={async (input) => {
              const finding = await updateSourcingFinding(input)
              reloadSourcing()
              return finding
            }}
          />
        ) : (
          <main className={`flex h-[calc(100vh-3rem)] min-w-0 flex-col overflow-hidden px-4 py-5 text-foreground sm:px-6 lg:px-8 ${contentColumnClass}`}>
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
                      onClick={() => setFiltersExpanded((current) => !current)}
                    >
                      <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                {filtersExpanded ? (
                  <>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                        Status
                        <select
                          aria-label="Status"
                          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                          value={filters.status}
                          onChange={(event) => updateFilter('status', event.target.value)}
                        >
                          <option value="">Any status</option>
                          {applicationStatuses.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                        Sort
                        <select
                          aria-label="Sort"
                          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                          value={filters.sort}
                          onChange={(event) => updateFilter('sort', event.target.value)}
                        >
                          {applicationListSorts.map((sort) => (
                            <option key={sort} value={sort}>
                              {sort}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                        Score band
                        <select
                          aria-label="Score band"
                          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                          value={filters.priorityBand}
                          onChange={(event) => updateFilter('priorityBand', event.target.value)}
                        >
                          <option value="">Any band</option>
                          <option value="high">high</option>
                          <option value="medium">medium</option>
                          <option value="skip">skip</option>
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                        Min score
                        <input
                          aria-label="Min score"
                          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
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
                          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                          value={filters.workMode}
                          onChange={(event) => updateFilter('workMode', event.target.value)}
                        >
                          <option value="">Any mode</option>
                          <option value="remote">remote</option>
                          <option value="onsite">onsite</option>
                          <option value="hybrid">hybrid</option>
                          <option value="unclear">unclear</option>
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
            await scoreRecorder(input)
            reloadApplicationViews()
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
        className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
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
        className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

export default App
