import { useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Brush,
  CircleUserRound,
  Cog,
  Database,
  Globe2,
  KeyRound,
  Monitor,
  PanelLeft,
  Search,
  Server,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Terminal,
  X,
} from 'lucide-react'
import type { ApplicationsPreloadApi } from './ipc/applications.preload'
import type { SettingsPreloadApi } from './ipc/settings.preload'
import { ApplicationTable } from './modules/applications/ApplicationTable'
import {
  applicationListSorts,
  applicationStatuses,
  type ApplicationListQuery,
  type ApplicationListResult,
  type ApplicationListSort,
} from './modules/applications/application.types'
import {
  defaultAppSettings,
  normalizeAppSettings,
  type AppSettings,
  type AppSettingsPatch,
  type RuntimePreference,
} from './settings/app-settings'

const PAGE_LIMIT = 50

interface AppProps {
  applicationLoader?: (query: ApplicationListQuery) => Promise<ApplicationListResult>
  settingsApi?: SettingsPreloadApi
}

interface FilterState {
  search: string
  status: string
  priorityBand: string
  minScore: string
  workMode: string
  sort: ApplicationListSort
  createdFrom: string
  createdTo: string
  updatedFrom: string
  updatedTo: string
}

const defaultFilters: FilterState = {
  search: '',
  status: '',
  priorityBand: '',
  minScore: '',
  workMode: '',
  sort: 'priority_desc',
  createdFrom: '',
  createdTo: '',
  updatedFrom: '',
  updatedTo: '',
}

type AppView = 'applications' | 'settings'
type SettingsPanelId =
  | 'general'
  | 'profile'
  | 'appearance'
  | 'configuration'
  | 'agent-access'
  | 'sourcing-runs'
  | 'agent-workflows'
  | 'advanced'
  | 'data'

const emptyApplicationResult: ApplicationListResult = {
  items: [],
  total: 0,
  limit: PAGE_LIMIT,
  offset: 0,
  hasMore: false,
}

const defaultApplicationLoader = (query: ApplicationListQuery) => {
  const applicationWindow = window as Window & { applications?: ApplicationsPreloadApi }

  return applicationWindow.applications?.list(query) ?? Promise.resolve(emptyApplicationResult)
}

const defaultSettingsApi: SettingsPreloadApi = {
  get() {
    return getWindowSettingsApi()?.get() ?? Promise.resolve(defaultAppSettings)
  },
  reset() {
    return getWindowSettingsApi()?.reset() ?? Promise.resolve(defaultAppSettings)
  },
  update(patch) {
    return (
      getWindowSettingsApi()?.update(patch) ??
      Promise.resolve(normalizeAppSettings({ ...defaultAppSettings, ...patch }))
    )
  },
}

function getWindowSettingsApi() {
  return (window as Window & { settings?: SettingsPreloadApi }).settings
}

function App({
  applicationLoader = defaultApplicationLoader,
  settingsApi = defaultSettingsApi,
}: AppProps) {
  const [filters, setFilters] = useState<FilterState>(defaultFilters)
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [appView, setAppView] = useState<AppView>('applications')
  const [selectedSettingsPanel, setSelectedSettingsPanel] = useState<SettingsPanelId>('general')
  const [settingsRestartRequired, setSettingsRestartRequired] = useState(false)
  const [sidebarHoverExpanded, setSidebarHoverExpanded] = useState(false)
  const [offset, setOffset] = useState(0)
  const [result, setResult] = useState<ApplicationListResult>(emptyApplicationResult)
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoadedApplications, setHasLoadedApplications] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const query = useMemo(() => buildApplicationListQuery(filters, offset), [filters, offset])
  const isInitialLoading = isLoading && !hasLoadedApplications

  useEffect(() => {
    let isMounted = true

    settingsApi.get().then((savedSettings) => {
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
  }, [applicationLoader, query])

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

  const sidebarState = settings.sidebarCollapsed
    ? sidebarHoverExpanded
      ? 'hover'
      : 'collapsed'
    : 'expanded'
  const sidebarVisible = sidebarState !== 'collapsed'
  const viewTitle = appView === 'settings' ? 'Settings' : 'Applications'
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
        className={`relative grid min-h-[calc(100vh-3rem)] ${
          settings.sidebarCollapsed ? 'grid-cols-[0px_1fr]' : 'grid-cols-[280px_1fr]'
        }`}
      >
        {sidebarVisible ? (
          appView === 'settings' ? (
            <SettingsSidebar
              selectedPanel={selectedSettingsPanel}
              temporary={sidebarState === 'hover'}
              onBack={() => {
                setAppView('applications')
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
              filtersExpanded={filtersExpanded}
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
                setAppView('settings')
              }}
              onSettingsOpenChange={setSettingsOpen}
              onSettingsPatch={updateSettings}
            />
          )
        ) : null}

        {appView === 'settings' ? (
          <SettingsPage
            contentColumnClass={contentColumnClass}
            restartRequired={settingsRestartRequired}
            selectedPanel={selectedSettingsPanel}
            settings={settings}
            onSettingsPatch={updateSettings}
          />
        ) : (
          <main className={`min-h-[calc(100vh-3rem)] min-w-0 px-4 py-5 text-foreground sm:px-6 lg:px-8 ${contentColumnClass}`}>
            <section className="mx-auto flex max-w-7xl flex-col gap-4">
              <header className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    Job automation
                  </p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-normal text-foreground">
                    Applications
                  </h1>
                </div>
                <Badge variant="secondary" className="w-fit border border-border bg-card">
                  {result.total} rows
                </Badge>
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
                  onSortChange={(nextSort) => updateFilter('sort', nextSort)}
                  onPreviousPage={() => setOffset(Math.max(0, offset - PAGE_LIMIT))}
                  onNextPage={() => setOffset(offset + PAGE_LIMIT)}
                />
              ) : null}
            </section>
          </main>
        )}
      </div>
    </div>
  )
}

interface AppTopbarProps {
  sidebarCollapsed: boolean
  title: string
  onToggleSidebar(): void
}

function AppTopbar({ sidebarCollapsed, title, onToggleSidebar }: AppTopbarProps) {
  return (
    <header
      aria-label="App chrome"
      className="app-drag flex h-12 items-center gap-3 border-b border-border bg-background/95 pl-20 pr-4"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="app-no-drag"
        onClick={onToggleSidebar}
      >
        <PanelLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <div className="min-w-0 text-sm font-semibold text-foreground">{title}</div>
    </header>
  )
}

interface AppSidebarProps {
  filtersExpanded: boolean
  settings: AppSettings
  settingsOpen: boolean
  temporary: boolean
  onMouseLeave(): void
  onOpenSettingsPage(): void
  onSettingsOpenChange(open: boolean): void
  onSettingsPatch(patch: AppSettingsPatch): void
}

function AppSidebar({
  filtersExpanded,
  settings,
  settingsOpen,
  temporary,
  onMouseLeave,
  onOpenSettingsPage,
  onSettingsOpenChange,
  onSettingsPatch,
}: AppSidebarProps) {
  return (
    <aside
      aria-label="Application navigation"
      className={`flex min-h-[calc(100vh-3rem)] w-[280px] flex-col overflow-visible border-r border-border bg-card/80 p-4 ${
        temporary ? 'absolute left-0 top-0 z-40 shadow-2xl' : ''
      }`}
      role="complementary"
      onMouseLeave={onMouseLeave}
    >
      <div className="mb-5">
        <p className="text-sm font-semibold text-foreground">Job App</p>
        <p className="mt-1 text-xs text-muted-foreground">
          <code className="rounded-md bg-secondary px-1.5 py-0.5 text-secondary-foreground">
            {settings.runtimeMode}
          </code>
        </p>
      </div>

      <nav aria-label="Application views" className="space-y-1">
        <button
          type="button"
          className="flex h-9 w-full items-center gap-2 rounded-md bg-accent px-2 text-left text-sm font-medium text-accent-foreground"
        >
          <Database className="h-4 w-4" aria-hidden="true" />
          Applications
        </button>
      </nav>

      <div className="mt-auto">
        <SettingsPopover
          filtersExpanded={filtersExpanded}
          open={settingsOpen}
          settings={settings}
          onClose={() => onSettingsOpenChange(false)}
          onOpenChange={onSettingsOpenChange}
          onOpenSettingsPage={onOpenSettingsPage}
          onSettingsPatch={onSettingsPatch}
        />
      </div>
    </aside>
  )
}

interface SettingsPopoverProps {
  filtersExpanded: boolean
  open: boolean
  settings: AppSettings
  onClose(): void
  onOpenChange(open: boolean): void
  onOpenSettingsPage(): void
  onSettingsPatch(patch: AppSettingsPatch): void
}

function SettingsPopover({
  filtersExpanded,
  open,
  settings,
  onClose,
  onOpenChange,
  onOpenSettingsPage,
  onSettingsPatch,
}: SettingsPopoverProps) {
  const remoteEnabled = settings.runtimeMode === 'remote'
  const sharingEnabled = settings.runtimeMode === 'local-shared'

  function updateRuntimeMode(runtimeMode: RuntimePreference) {
    onSettingsPatch({ runtimeMode })
  }

  return (
    <div className="relative z-50">
      {open ? (
        <div
          role="dialog"
          aria-label="Settings"
          className="absolute bottom-12 left-0 w-[calc(100vw-2rem)] max-w-sm rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-2xl"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Job App</p>
              <p className="text-xs text-muted-foreground">
                <code className="rounded-md bg-secondary px-1.5 py-0.5 text-secondary-foreground">
                  {settings.runtimeMode}
                </code>
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Close settings"
              onClick={onClose}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="divide-y divide-border rounded-md border border-border bg-card/80">
            <SettingsToggleRow
              checked={remoteEnabled}
              description="Point the app and tools at a remote HTTP API."
              icon={<Globe2 className="h-4 w-4" aria-hidden="true" />}
              label="Use remote backend"
              onChange={(checked) => updateRuntimeMode(checked ? 'remote' : 'local-desktop')}
            />
            <SettingsToggleRow
              checked={sharingEnabled}
              description="Prepare this machine for local API/Tailscale access."
              disabled={remoteEnabled}
              icon={<Server className="h-4 w-4" aria-hidden="true" />}
              label="Local API sharing"
              onChange={(checked) => updateRuntimeMode(checked ? 'local-shared' : 'local-desktop')}
            />
            <SettingsToggleRow
              checked={filtersExpanded}
              description="Keep the full filter toolbar visible on this page."
              icon={<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}
              label="Show advanced filters"
              onChange={(checked) => onSettingsPatch({ showAdvancedFilters: checked })}
            />
          </div>

          <label className="mt-3 grid gap-1 text-xs font-medium text-muted-foreground">
            Remote API URL
            <input
              aria-label="Remote API URL"
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!remoteEnabled}
              value={settings.remoteApiUrl}
              onChange={(event) =>
                onSettingsPatch({
                  remoteApiUrl: event.target.value,
                })
              }
            />
          </label>
          <div className="mt-3 border-t border-border pt-3">
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start gap-2 px-2"
              onClick={onOpenSettingsPage}
            >
              <SettingsIcon className="h-4 w-4" aria-hidden="true" />
              Open settings
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Backend changes apply after restart.
            </p>
          </div>
        </div>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="w-full justify-start gap-2 px-3 hover:bg-accent hover:text-accent-foreground"
      >
        <SettingsIcon className="h-4 w-4" aria-hidden="true" />
        Settings
      </Button>
    </div>
  )
}

interface SettingsToggleRowProps {
  checked: boolean
  description: string
  disabled?: boolean
  icon: React.ReactNode
  label: string
  onChange(checked: boolean): void
}

function SettingsToggleRow({
  checked,
  description,
  disabled = false,
  icon,
  label,
  onChange,
}: SettingsToggleRowProps) {
  return (
    <label className="flex cursor-pointer items-center gap-3 px-3 py-3 text-sm text-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55">
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <input
        aria-label={label}
        checked={checked}
        className="h-4 w-4 accent-primary"
        disabled={disabled}
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}

interface SettingsPageProps {
  contentColumnClass: string
  restartRequired: boolean
  selectedPanel: SettingsPanelId
  settings: AppSettings
  onSettingsPatch(patch: AppSettingsPatch): void
}

interface SettingsSidebarProps {
  selectedPanel: SettingsPanelId
  temporary: boolean
  onBack(): void
  onMouseLeave(): void
  onPanelChange(panel: SettingsPanelId): void
}

interface SettingsNavItem {
  icon: React.ReactNode
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
        icon: <Cog className="h-4 w-4" aria-hidden="true" />,
        id: 'general',
        label: 'General',
      },
      {
        icon: <CircleUserRound className="h-4 w-4" aria-hidden="true" />,
        id: 'profile',
        label: 'Profile',
      },
      {
        icon: <Brush className="h-4 w-4" aria-hidden="true" />,
        id: 'appearance',
        label: 'Appearance',
      },
    ],
  },
  {
    group: 'Integrations',
    items: [
      {
        icon: <Database className="h-4 w-4" aria-hidden="true" />,
        id: 'configuration',
        label: 'Configuration',
      },
      {
        icon: <Terminal className="h-4 w-4" aria-hidden="true" />,
        id: 'agent-access',
        label: 'Agent access',
      },
    ],
  },
  {
    group: 'Automation',
    items: [
      {
        icon: <Bot className="h-4 w-4" aria-hidden="true" />,
        id: 'agent-workflows',
        label: 'Agent workflows',
      },
      {
        icon: <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />,
        id: 'sourcing-runs',
        label: 'Sourcing runs',
      },
    ],
  },
  {
    group: 'Advanced',
    items: [
      {
        icon: <KeyRound className="h-4 w-4" aria-hidden="true" />,
        id: 'advanced',
        label: 'Developer settings',
      },
      {
        icon: <Database className="h-4 w-4" aria-hidden="true" />,
        id: 'data',
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
      className={`min-h-[calc(100vh-3rem)] w-[280px] border-r border-border bg-card/80 p-4 ${
        temporary ? 'absolute left-0 top-0 z-40 shadow-2xl' : ''
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
  contentColumnClass,
  restartRequired,
  selectedPanel,
  settings,
  onSettingsPatch,
}: SettingsPageProps) {
  const selectedItem = settingsNavGroups
    .flatMap((group) => group.items)
    .find((item) => item.id === selectedPanel)
  const selectedLabel = selectedItem?.label ?? 'General'
  const apiBaseUrl = `http://${settings.localApiHost}:${settings.localApiPort}`

  return (
    <main className={`min-h-[calc(100vh-3rem)] min-w-0 px-5 py-6 text-foreground sm:px-8 lg:px-12 ${contentColumnClass}`}>
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
          {selectedPanel === 'general' ? (
            <GeneralSettingsPanel settings={settings} onSettingsPatch={onSettingsPatch} />
          ) : null}
          {selectedPanel === 'configuration' ? (
            <ConfigurationSettingsPanel settings={settings} onSettingsPatch={onSettingsPatch} />
          ) : null}
          {selectedPanel === 'agent-access' ? (
            <AgentAccessSettingsPanel apiBaseUrl={apiBaseUrl} settings={settings} />
          ) : null}
          {selectedPanel === 'appearance' ? (
            <AppearanceSettingsPanel settings={settings} onSettingsPatch={onSettingsPatch} />
          ) : null}
          {!isFunctionalSettingsPanel(selectedPanel) ? (
            <ComingLaterSettingsPanel label={selectedLabel} />
          ) : null}
        </div>
      </div>
    </main>
  )
}

function GeneralSettingsPanel({
  settings,
  onSettingsPatch,
}: {
  settings: AppSettings
  onSettingsPatch(patch: AppSettingsPatch): void
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
  onSettingsPatch(patch: AppSettingsPatch): void
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
}: {
  apiBaseUrl: string
  settings: AppSettings
}) {
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
        <pre className="mt-3 overflow-auto rounded-md bg-background p-3 text-xs text-foreground">
          <code>{`JOB_APP_API_URL=${apiBaseUrl} job-app applications list --json`}</code>
        </pre>
        <pre className="mt-2 overflow-auto rounded-md bg-background p-3 text-xs text-foreground">
          <code>{`JOB_APP_API_TOKEN=<token> job-app applications get <id> --json`}</code>
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

function AppearanceSettingsPanel({
  settings,
  onSettingsPatch,
}: {
  settings: AppSettings
  onSettingsPatch(patch: AppSettingsPatch): void
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
  icon: React.ReactNode
  label: string
  onChange(): void
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

function SettingsTextInput({
  label,
  readOnly = false,
  type = 'text',
  value,
  onChange,
}: {
  label: string
  readOnly?: boolean
  type?: string
  value: string
  onChange?(value: string): void
}) {
  return (
    <label className="grid gap-2 px-4 py-3 text-sm text-foreground md:grid-cols-[180px_1fr] md:items-center">
      <span>
        <span className="block font-medium">{label}</span>
      </span>
      <input
        aria-label={label}
        className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground read-only:text-muted-foreground"
        readOnly={readOnly}
        type={type}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </label>
  )
}

function isFunctionalSettingsPanel(panel: SettingsPanelId) {
  return (
    panel === 'general' ||
    panel === 'configuration' ||
    panel === 'agent-access' ||
    panel === 'appearance'
  )
}

function requiresRestart(patch: AppSettingsPatch) {
  return (
    'apiToken' in patch ||
    'localApiHost' in patch ||
    'localApiPort' in patch ||
    'remoteApiUrl' in patch ||
    'runtimeMode' in patch
  )
}

interface FilterInputProps {
  label: string
  value: string
  onChange(value: string): void
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

function buildApplicationListQuery(
  filters: FilterState,
  offset: number,
): ApplicationListQuery {
  return removeEmptyValues({
    search: filters.search,
    status: filters.status as ApplicationListQuery['status'],
    priorityBand: filters.priorityBand,
    minScore: filters.minScore ? Number(filters.minScore) : undefined,
    workMode: filters.workMode as ApplicationListQuery['workMode'],
    sort: filters.sort,
    createdFrom: normalizeDateFilter(filters.createdFrom, 'start'),
    createdTo: normalizeDateFilter(filters.createdTo, 'end'),
    updatedFrom: normalizeDateFilter(filters.updatedFrom, 'start'),
    updatedTo: normalizeDateFilter(filters.updatedTo, 'end'),
    limit: PAGE_LIMIT,
    offset,
  })
}

function removeEmptyValues(query: ApplicationListQuery): ApplicationListQuery {
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== '' && value !== undefined),
  ) as ApplicationListQuery
}

function normalizeDateFilter(value: string, boundary: 'start' | 'end') {
  if (!value) {
    return undefined
  }

  return `${value}T${boundary === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`
}

export default App
