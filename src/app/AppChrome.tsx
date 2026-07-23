import { useEffect, useId, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sidebar,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/use-toast'
import { AlertCircle, Building2, CircleUserRound, Database, Download, Globe2, Plug, Search, Server, Settings as SettingsIcon, X, PanelLeft, RefreshCw } from 'lucide-react'
import { actionFailureToastInput } from './error-presentation'
import type { UpdateState } from '../ipc/updates.preload'
import type { AppSettings, AppSettingsPatch, RuntimePreference } from '../settings/app-settings'
import { APP_VIEWS, type MainAppView } from './types'

interface AppTopbarProps {
  isFullScreen: boolean
  sidebarCollapsed: boolean
  title: string
  updateState?: UpdateState | null
  onCheckForUpdates?: () => void
  onInstallUpdate?: () => void
  onToggleSidebar: () => void
}

function AppTopbar({
  isFullScreen,
  sidebarCollapsed,
  title,
  updateState = null,
  onCheckForUpdates,
  onInstallUpdate,
  onToggleSidebar,
}: AppTopbarProps) {
  const buildIdentity = import.meta.env.VITE_VALEDICTORIAN_BUILD_IDENTITY
  return (
    <header
      aria-label="App chrome"
      className={`app-drag flex h-12 items-center gap-2 border-b border-border bg-background/95 pr-3 ${
        isFullScreen ? 'pl-3' : 'pl-[4.75rem]'
      }`}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="app-no-drag h-7 w-7 shrink-0 border border-border/70 bg-card/70 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={onToggleSidebar}
          >
            <PanelLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        </TooltipContent>
      </Tooltip>
      <div className="min-w-0 truncate text-sm font-semibold leading-none text-foreground">{title}</div>
      {buildIdentity ? (
        <code className="app-no-drag ml-auto max-w-[45vw] truncate rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning">
          {buildIdentity}
        </code>
      ) : null}
      <UpdateStatusControl
        onCheck={onCheckForUpdates}
        state={updateState}
        onInstall={onInstallUpdate}
      />
    </header>
  )
}

interface UpdateStatusControlProps {
  onCheck?: () => void
  state: UpdateState | null
  onInstall?: () => void
}

function UpdateStatusControl({ onCheck, state, onInstall }: UpdateStatusControlProps) {
  if (!state || state.status === 'disabled') {
    return null
  }

  if (state.status === 'idle' || state.status === 'unavailable') {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="app-no-drag ml-auto h-7 gap-2 px-2.5"
        onClick={onCheck}
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Check for updates
      </Button>
    )
  }

  if (state.status === 'checking') {
    return (
      <div className="app-no-drag ml-auto inline-flex h-7 items-center gap-2 rounded-md border border-border bg-card/80 px-2.5 text-xs font-medium text-muted-foreground">
        <Spinner aria-label="Checking for updates" className="size-3.5" />
        Checking for updates
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div
        role="alert"
        aria-live="polite"
        className="app-no-drag ml-auto inline-flex h-7 max-w-[min(22rem,45vw)] items-center gap-2 rounded-md border border-destructive/40 bg-destructive/15 px-2.5 text-xs font-medium text-destructive"
      >
        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">Update check failed</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-1.5 text-destructive hover:bg-destructive/20 hover:text-destructive"
          onClick={onCheck}
        >
          Retry
        </Button>
      </div>
    )
  }

  if (state.status === 'downloading') {
    const percent = Math.min(100, Math.max(0, Math.round(state.percent ?? 0)))
    return (
      <div className="app-no-drag ml-auto inline-flex h-7 items-center gap-2 rounded-md border border-border bg-card/80 px-2.5 text-xs font-medium text-muted-foreground">
        <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>Downloading update {percent}%</span>
        <Progress
          aria-label="Downloading update"
          className="h-1 w-16"
          value={percent}
        />
      </div>
    )
  }

  return (
    <Button
      type="button"
      size="sm"
      className="app-no-drag ml-auto h-7 gap-2 px-2.5"
      onClick={onInstall}
    >
      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
      Restart to update
    </Button>
  )
}

interface AppSidebarProps {
  currentView: MainAppView
  settings: AppSettings
  settingsOpen: boolean
  visibleViews?: readonly MainAppView[]
  onOpenProfilePage?: () => void
  onOpenSettingsPage?: () => void
  onViewChange: (
    view: Exclude<MainAppView, typeof APP_VIEWS.PROFILE>,
  ) => void
  onSettingsOpenChange: (open: boolean) => void
  onSettingsPatch: (patch: AppSettingsPatch) => void | Promise<void>
}

function AppSidebar({
  currentView,
  settings,
  settingsOpen,
  visibleViews,
  onOpenProfilePage,
  onOpenSettingsPage,
  onViewChange,
  onSettingsOpenChange,
  onSettingsPatch,
}: AppSidebarProps) {
  const isVisible = (view: MainAppView) => visibleViews?.includes(view) ?? true
  const connectorsChildrenId = useId()
  const connectorsChildActive =
    currentView === APP_VIEWS.CONNECTORS || currentView === APP_VIEWS.CONNECTOR_RUNS
  const connectorsOnlyShowsRuns = !isVisible(APP_VIEWS.CONNECTORS)
    && isVisible(APP_VIEWS.CONNECTOR_RUNS)
  const [connectorsExpanded, setConnectorsExpanded] = useState(
    connectorsChildActive || connectorsOnlyShowsRuns,
  )

  useEffect(() => {
    if (connectorsChildActive) {
      setConnectorsExpanded(true)
    }
  }, [connectorsChildActive])

  return (
    <Sidebar
      aria-label="Application navigation"
      className="absolute left-0 top-0 z-40 h-full w-[280px] max-w-[85vw] overflow-hidden border-r border-border bg-card/80 p-4 shadow-2xl md:static md:z-auto md:h-[calc(100vh-3rem)] md:max-w-none md:overflow-visible md:shadow-none"
      role="complementary"
    >
      <ScrollArea className="min-h-0 flex-1">
        <div>
          <SidebarHeader className="mb-5 gap-1 p-0">
            <p className="text-sm font-semibold text-foreground">Valedictorian</p>
            <p className="text-xs text-muted-foreground">
              <code className="rounded-md bg-secondary px-1.5 py-0.5 text-secondary-foreground">
                {settings.runtimeMode}
              </code>
            </p>
          </SidebarHeader>

          <nav aria-label="Application views">
            <SidebarMenu>
              {isVisible(APP_VIEWS.PROFILE) && onOpenProfilePage ? <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  isActive={currentView === APP_VIEWS.PROFILE}
                  aria-current={currentView === APP_VIEWS.PROFILE ? 'page' : undefined}
                  onClick={onOpenProfilePage}
                >
                  <CircleUserRound className="h-4 w-4" aria-hidden="true" />
                  Profile
                </SidebarMenuButton>
              </SidebarMenuItem> : null}
            </SidebarMenu>
              <SidebarGroup className="px-0 py-2">
                <SidebarGroupLabel className="h-auto px-2 py-1">Job lifecycle</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {isVisible(APP_VIEWS.CAPTURES) ? <SidebarMenuItem>
                      <SidebarMenuButton
                        type="button"
                        isActive={currentView === APP_VIEWS.CAPTURES}
                        aria-current={currentView === APP_VIEWS.CAPTURES ? 'page' : undefined}
                        onClick={() => onViewChange(APP_VIEWS.CAPTURES)}
                      >
                        <Database className="h-4 w-4" aria-hidden="true" />
                        Captures
                      </SidebarMenuButton>
                    </SidebarMenuItem> : null}
                    {isVisible(APP_VIEWS.JOBS) ? <SidebarMenuItem>
                      <SidebarMenuButton
                        type="button"
                        isActive={currentView === APP_VIEWS.JOBS}
                        aria-current={currentView === APP_VIEWS.JOBS ? 'page' : undefined}
                        onClick={() => onViewChange(APP_VIEWS.JOBS)}
                      >
                        <Server className="h-4 w-4" aria-hidden="true" />
                        Jobs
                      </SidebarMenuButton>
                    </SidebarMenuItem> : null}
                    {isVisible(APP_VIEWS.OPPORTUNITIES) ? <SidebarMenuItem>
                      <SidebarMenuButton
                        type="button"
                        isActive={currentView === APP_VIEWS.OPPORTUNITIES}
                        aria-current={currentView === APP_VIEWS.OPPORTUNITIES ? 'page' : undefined}
                        onClick={() => onViewChange(APP_VIEWS.OPPORTUNITIES)}
                      >
                        <Search className="h-4 w-4" aria-hidden="true" />
                        Opportunities
                      </SidebarMenuButton>
                    </SidebarMenuItem> : null}
                    {isVisible(APP_VIEWS.APPLICATIONS) ? <SidebarMenuItem>
                      <SidebarMenuButton
                        type="button"
                        isActive={currentView === APP_VIEWS.APPLICATIONS}
                        aria-current={currentView === APP_VIEWS.APPLICATIONS ? 'page' : undefined}
                        onClick={() => onViewChange(APP_VIEWS.APPLICATIONS)}
                      >
                        <Globe2 className="h-4 w-4" aria-hidden="true" />
                        Applications
                      </SidebarMenuButton>
                    </SidebarMenuItem> : null}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
              {isVisible(APP_VIEWS.COMPANIES) ? (
                <SidebarGroup className="px-0 py-2">
                  <SidebarGroupLabel className="h-auto px-2 py-1">
                    Workspace data
                  </SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          type="button"
                          isActive={currentView === APP_VIEWS.COMPANIES}
                          aria-current={
                            currentView === APP_VIEWS.COMPANIES ? 'page' : undefined
                          }
                          onClick={() => onViewChange(APP_VIEWS.COMPANIES)}
                        >
                          <Building2 className="h-4 w-4" aria-hidden="true" />
                          Companies
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ) : null}
            <SidebarMenu>
              {isVisible(APP_VIEWS.CONNECTORS) || isVisible(APP_VIEWS.CONNECTOR_RUNS) ? <Collapsible
                asChild
                open={connectorsExpanded}
                onOpenChange={setConnectorsExpanded}
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      type="button"
                      aria-controls={connectorsChildrenId}
                      isActive={connectorsChildActive}
                    >
                      <Plug className="h-4 w-4" aria-hidden="true" />
                      Connectors
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent id={connectorsChildrenId}>
                    <SidebarMenuSub className="mx-0 ml-4 translate-x-0 px-0 py-0 pl-2">
                      {isVisible(APP_VIEWS.CONNECTORS) ? <SidebarMenuSubItem>
                        <SidebarMenuSubButton
                          asChild
                          isActive={currentView === APP_VIEWS.CONNECTORS}
                        >
                          <button
                            type="button"
                            aria-current={
                              currentView === APP_VIEWS.CONNECTORS ? 'page' : undefined
                            }
                            onClick={() => onViewChange(APP_VIEWS.CONNECTORS)}
                          >
                            Overview
                          </button>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem> : null}
                      {isVisible(APP_VIEWS.CONNECTOR_RUNS) ? <SidebarMenuSubItem>
                        <SidebarMenuSubButton
                          asChild
                          isActive={currentView === APP_VIEWS.CONNECTOR_RUNS}
                        >
                          <button
                            type="button"
                            aria-label="Connector runs"
                            aria-current={
                              currentView === APP_VIEWS.CONNECTOR_RUNS ? 'page' : undefined
                            }
                            onClick={() => onViewChange(APP_VIEWS.CONNECTOR_RUNS)}
                          >
                            Runs
                          </button>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem> : null}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible> : null}
            </SidebarMenu>
          </nav>
        </div>
      </ScrollArea>

      <SidebarFooter className="mt-auto gap-0 p-0">
        <SettingsPopover
          open={settingsOpen}
          settings={settings}
          onClose={() => onSettingsOpenChange(false)}
          onOpenChange={onSettingsOpenChange}
          onOpenSettingsPage={onOpenSettingsPage}
          onSettingsPatch={onSettingsPatch}
        />
      </SidebarFooter>
    </Sidebar>
  )
}

interface SettingsPopoverProps {
  open: boolean
  settings: AppSettings
  onClose: () => void
  onOpenChange: (open: boolean) => void
  onOpenSettingsPage?: () => void
  onSettingsPatch: (patch: AppSettingsPatch) => void | Promise<void>
}

function SettingsPopover({
  open,
  settings,
  onClose,
  onOpenChange,
  onOpenSettingsPage,
  onSettingsPatch,
}: SettingsPopoverProps) {
  const { toast } = useToast()
  const remoteEnabled = settings.runtimeMode === 'remote'
  const sharingEnabled = settings.runtimeMode === 'local-shared'

  function patchSettings(patch: AppSettingsPatch) {
    void Promise.resolve(onSettingsPatch(patch)).catch((error: unknown) => {
      toast(actionFailureToastInput(error, {
        fallbackMessage: 'Settings could not be saved.',
        operationId: 'settings:update',
      }))
    })
  }

  function updateRuntimeMode(runtimeMode: RuntimePreference) {
    patchSettings({ runtimeMode })
  }

  return (
    <div className="relative z-50">
      {open ? (
        <div
          role="dialog"
          aria-label="Quick settings"
          className="absolute bottom-12 left-0 flex max-h-[calc(100vh-5rem)] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-2xl"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Valedictorian</p>
              <p className="text-xs text-muted-foreground">
                <code className="rounded-md bg-secondary px-1.5 py-0.5 text-secondary-foreground">
                  {settings.runtimeMode}
                </code>
              </p>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Close settings"
                  onClick={onClose}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Close settings</TooltipContent>
            </Tooltip>
          </div>

          <div className="min-h-0 overflow-y-auto">
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
            </div>

            <Label className="mt-3 grid gap-1 text-xs font-medium text-muted-foreground">
              Remote API URL
              <Input
                aria-label="Remote API URL"
                disabled={!remoteEnabled}
                value={settings.remoteApiUrl}
                onChange={(event) =>
                  patchSettings({
                    remoteApiUrl: event.target.value,
                  })
                }
              />
            </Label>
          </div>
          {onOpenSettingsPage ? <div className="mt-3 shrink-0 border-t border-border pt-3">
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start gap-2 px-2"
              onClick={onOpenSettingsPage}
            >
              <SettingsIcon className="h-4 w-4" aria-hidden="true" />
              Open all settings
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Backend changes apply after restart.
            </p>
          </div> : null}
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
  icon: ReactNode
  label: string
  onChange: (checked: boolean) => void
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
    <Label className="grid w-full cursor-pointer grid-cols-[auto_minmax(0,22rem)_auto] items-center justify-start gap-3 px-3 py-3 text-sm text-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55">
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </Label>
  )
}



export { AppTopbar, AppSidebar, SettingsToggleRow }
