import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { CircleUserRound, Database, Globe2, ListChecks, Search, Server, Settings as SettingsIcon, X, PanelLeft } from 'lucide-react'
import type { AppSettings, AppSettingsPatch, RuntimePreference } from '../settings/app-settings'
import { APP_VIEWS, type MainAppView } from './types'

interface AppTopbarProps {
  sidebarCollapsed: boolean
  title: string
  onToggleSidebar: () => void
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
  currentView: MainAppView
  settings: AppSettings
  settingsOpen: boolean
  temporary: boolean
  onMouseLeave: () => void
  onOpenProfilePage: () => void
  onOpenSettingsPage: () => void
  onViewChange: (view: Exclude<MainAppView, typeof APP_VIEWS.PROFILE>) => void
  onSettingsOpenChange: (open: boolean) => void
  onSettingsPatch: (patch: AppSettingsPatch) => void
}

function AppSidebar({
  currentView,
  settings,
  settingsOpen,
  temporary,
  onMouseLeave,
  onOpenProfilePage,
  onOpenSettingsPage,
  onViewChange,
  onSettingsOpenChange,
  onSettingsPatch,
}: AppSidebarProps) {
  return (
    <aside
      aria-label="Application navigation"
      className={`flex h-[calc(100vh-3rem)] w-[280px] flex-col overflow-visible border-r border-border bg-card/80 p-4 ${
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
          className={applicationNavClass(currentView === APP_VIEWS.PROFILE)}
          onClick={onOpenProfilePage}
        >
          <CircleUserRound className="h-4 w-4" aria-hidden="true" />
          Profile
        </button>
        <button
          type="button"
          className={applicationNavClass(currentView === APP_VIEWS.APPLICATIONS)}
          onClick={() => onViewChange(APP_VIEWS.APPLICATIONS)}
        >
          <Database className="h-4 w-4" aria-hidden="true" />
          Applications
        </button>
        <button
          type="button"
          className={applicationNavClass(currentView === APP_VIEWS.QUEUE)}
          onClick={() => onViewChange(APP_VIEWS.QUEUE)}
        >
          <ListChecks className="h-4 w-4" aria-hidden="true" />
          Queue
        </button>
        <button
          type="button"
          className={applicationNavClass(currentView === APP_VIEWS.SOURCING)}
          onClick={() => onViewChange(APP_VIEWS.SOURCING)}
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          Sourcing
        </button>
      </nav>

      <div className="mt-auto">
        <SettingsPopover
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

function applicationNavClass(active: boolean) {
  return `flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-medium ${
    active
      ? 'bg-accent text-accent-foreground'
      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
  }`
}

interface SettingsPopoverProps {
  open: boolean
  settings: AppSettings
  onClose: () => void
  onOpenChange: (open: boolean) => void
  onOpenSettingsPage: () => void
  onSettingsPatch: (patch: AppSettingsPatch) => void
}

function SettingsPopover({
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



export { AppTopbar, AppSidebar, SettingsToggleRow }
