import { useState, type ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sidebar,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { AlertCircle, ArrowLeft, Bot, Brush, CircleUserRound, Cog, Database, FolderOpen, Globe2, KeyRound, Monitor, Search, Server, ShieldCheck, SlidersHorizontal, Terminal } from 'lucide-react'
import type { PolicyPreloadApi } from '../ipc/policy.preload'
import type { ProfilePreloadApi } from '../ipc/profile.preload'
import type { ConnectorsPreloadApi } from '../ipc/connectors.preload'
import type { WorkspacePreloadApi } from '../ipc/workspace.preload'
import type { AppSettings, AppSettingsPatch, RuntimePreference } from './app-settings'
import { SETTINGS_PANELS, type SettingsPanelId } from '../app/types'
import { SettingsToggleRow } from '../app/AppChrome'
import { ProfileSettingsPanel } from '../modules/profile/ProfileSettingsPanel'
import { SettingsTextInput } from './SettingsTextInput'
import type { WorkspaceSummary } from '../workspace/workspace.initializer'
import { ConnectorRunsPanel } from './ConnectorRunsPanel'
import { ConnectorSettingsPanel } from './ConnectorSettingsPanel'
import type { ConnectorScheduleUiApi } from './connector-schedule.types'
import { PolicySettingsPanel } from './PolicySettingsPanel'

interface SettingsPageProps {
  connectorsApi: ConnectorsPreloadApi
  connectorScheduleApi: ConnectorScheduleUiApi
  contentColumnClass: string
  policyApi: PolicyPreloadApi
  profileApi: ProfilePreloadApi
  restartRequired: boolean
  selectedPanel: SettingsPanelId
  settings: AppSettings
  workspace: WorkspaceSummary | null
  workspaceApi: WorkspacePreloadApi
  onConnectorRunSettled: () => void
  onOpenSourcingRuns: (runId?: string) => void
  onSettingsPatch: (patch: AppSettingsPatch) => void
}

interface SettingsSidebarProps {
  selectedPanel: SettingsPanelId
  temporary: boolean
  onBack: () => void
  onMouseLeave: () => void
  onPanelChange: (panel: SettingsPanelId) => void
}

interface SettingsNavItem {
  icon: ReactNode
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
        icon: <CircleUserRound className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.PROFILE,
        label: 'Profile',
      },
      {
        icon: <Cog className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.GENERAL,
        label: 'General',
      },
      {
        icon: <Brush className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.APPEARANCE,
        label: 'Appearance',
      },
    ],
  },
  {
    group: 'Integrations',
    items: [
      {
        icon: <Database className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.CONFIGURATION,
        label: 'Configuration',
      },
      {
        icon: <Globe2 className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.CONNECTORS,
        label: 'Connectors',
      },
      {
        icon: <Terminal className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.AGENT_ACCESS,
        label: 'Agent access',
      },
    ],
  },
  {
    group: 'Automation',
    items: [
      {
        icon: <Bot className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.AGENT_WORKFLOWS,
        label: 'Agent workflows',
      },
      {
        icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.POLICY,
        label: 'Policy',
      },
    ],
  },
  {
    group: 'Advanced',
    items: [
      {
        icon: <KeyRound className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.ADVANCED,
        label: 'Developer settings',
      },
      {
        icon: <Database className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.DATA,
        label: 'Data',
      },
    ],
  },
]

export function SettingsSidebar({
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
    <Sidebar
      aria-label="Settings navigation"
      className={`absolute left-0 top-0 z-40 h-full w-[280px] max-w-[85vw] overflow-hidden border-r border-border bg-card/80 p-4 shadow-2xl md:h-[calc(100vh-3rem)] md:max-w-none ${
        temporary ? 'md:absolute md:left-0 md:top-0 md:z-40 md:shadow-2xl' : 'md:static md:z-auto md:shadow-none'
      }`}
      role="complementary"
      onMouseLeave={onMouseLeave}
    >
      <ScrollArea className="min-h-0 flex-1">
        <div>
          <SidebarHeader className="mb-4 gap-0 p-0">
            <Button type="button" variant="ghost" className="justify-start gap-2 px-2" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to app
            </Button>
          </SidebarHeader>

          <Label className="block text-xs font-medium text-muted-foreground" htmlFor="settings-search">
            Search settings
            <InputGroup className="mt-1">
              <InputGroupInput
                id="settings-search"
                placeholder="Search settings..."
                value={settingsSearch}
                onChange={(event) => setSettingsSearch(event.target.value)}
              />
              <InputGroupAddon align="inline-start">
                <Search className="h-4 w-4" aria-hidden="true" />
              </InputGroupAddon>
            </InputGroup>
          </Label>

          <nav className="mt-5 space-y-5" aria-label="Settings sections">
            {visibleGroups.map((group) => (
              <SidebarGroup key={group.group} className="p-0">
                <SidebarGroupLabel className="mb-1 h-auto px-2 py-0">
                  {group.group}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          type="button"
                          isActive={item.id === selectedPanel}
                          aria-current={item.id === selectedPanel ? 'page' : undefined}
                          className={
                            item.id === selectedPanel
                              ? undefined
                              : 'hover:bg-accent/70 hover:text-foreground'
                          }
                          onClick={() => onPanelChange(item.id)}
                        >
                          {item.icon}
                          {item.label}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </nav>
        </div>
      </ScrollArea>
    </Sidebar>
  )
}

export function SettingsPage({
  connectorsApi,
  connectorScheduleApi,
  contentColumnClass,
  policyApi,
  profileApi,
  restartRequired,
  selectedPanel,
  settings,
  workspace,
  workspaceApi,
  onConnectorRunSettled,
  onOpenSourcingRuns,
  onSettingsPatch,
}: SettingsPageProps) {
  const selectedItem = settingsNavGroups
    .flatMap((group) => group.items)
    .find((item) => item.id === selectedPanel)
  const selectedLabel = selectedItem?.label ?? 'General'
  const apiBaseUrl = `http://${settings.localApiHost}:${settings.localApiPort}`

  return (
    <main className={`h-full min-w-0 overflow-auto px-5 py-6 text-foreground md:h-[calc(100vh-3rem)] sm:px-8 lg:px-12 ${contentColumnClass}`}>
      <div className="max-w-4xl">
        <h1 className="text-2xl font-semibold tracking-normal text-foreground">Settings</h1>
        {restartRequired ? (
          <Alert className="mt-4">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>Restart required</AlertTitle>
            <AlertDescription>
              Backend mode, API host, port, token, and remote URL changes apply next launch.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="mt-8">
          {selectedPanel === SETTINGS_PANELS.GENERAL ? (
            <GeneralSettingsPanel settings={settings} onSettingsPatch={onSettingsPatch} />
          ) : null}
          {selectedPanel === SETTINGS_PANELS.CONFIGURATION ? (
            <ConfigurationSettingsPanel settings={settings} onSettingsPatch={onSettingsPatch} />
          ) : null}
          {selectedPanel === SETTINGS_PANELS.CONNECTORS ? (
            <ConnectorSettingsPanel
              connectorsApi={connectorsApi}
              connectorScheduleApi={connectorScheduleApi}
              onOpenSourcingRuns={onOpenSourcingRuns}
              onRunSettled={onConnectorRunSettled}
              profileApi={profileApi}
              workspaceId={workspace?.id ?? null}
            />
          ) : null}
          {selectedPanel === SETTINGS_PANELS.AGENT_ACCESS ? (
            <AgentAccessSettingsPanel
              apiBaseUrl={apiBaseUrl}
              settings={settings}
              workspace={workspace}
            />
          ) : null}
          {selectedPanel === SETTINGS_PANELS.APPEARANCE ? (
            <AppearanceSettingsPanel settings={settings} onSettingsPatch={onSettingsPatch} />
          ) : null}
          {selectedPanel === SETTINGS_PANELS.DATA ? (
            <DataSettingsPanel workspace={workspace} workspaceApi={workspaceApi} />
          ) : null}
          {selectedPanel === SETTINGS_PANELS.PROFILE ? (
            <ProfileSettingsPanel profileApi={profileApi} />
          ) : null}
          {selectedPanel === SETTINGS_PANELS.POLICY ? (
            <PolicySettingsPanel policyApi={policyApi} />
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
  onSettingsPatch: (patch: AppSettingsPatch) => void
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
        <h3 className="text-sm font-semibold text-foreground" id="backend-mode-heading">
          Backend mode
        </h3>
        <RadioGroup
          aria-labelledby="backend-mode-heading"
          className="mt-3 grid gap-3 md:grid-cols-3"
          value={settings.runtimeMode}
          onValueChange={(value) =>
            onSettingsPatch({ runtimeMode: value as RuntimePreference })
          }
        >
          <RuntimeModeOption
            description="SQLite through Electron IPC, no local HTTP server."
            icon={<Monitor className="h-4 w-4" aria-hidden="true" />}
            label="Local desktop"
            value="local-desktop"
          />
          <RuntimeModeOption
            description="SQLite plus the embedded HTTP API for Tailscale or CLI access."
            icon={<Server className="h-4 w-4" aria-hidden="true" />}
            label="Local shared"
            value="local-shared"
          />
          <RuntimeModeOption
            description="Use a hosted or remote HTTP API instead of local SQLite."
            icon={<Globe2 className="h-4 w-4" aria-hidden="true" />}
            label="Remote"
            value="remote"
          />
        </RadioGroup>
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
  onSettingsPatch: (patch: AppSettingsPatch) => void
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
  workspace,
}: {
  apiBaseUrl: string
  settings: AppSettings
  workspace: WorkspaceSummary | null
}) {
  const workspaceSelector = workspace?.id ?? '<workspace-id-or-name>'

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
        <pre className="mt-3 whitespace-pre-wrap break-all rounded-md bg-background p-3 text-xs text-foreground">
          <code>{`VALEDICTORIAN_API_URL=${apiBaseUrl} valedictorian-cli --json workspaces list`}</code>
        </pre>
        <pre className="mt-2 whitespace-pre-wrap break-all rounded-md bg-background p-3 text-xs text-foreground">
          <code>{`VALEDICTORIAN_API_URL=${apiBaseUrl} valedictorian-cli --json applications list --workspace ${workspaceSelector}`}</code>
        </pre>
        <pre className="mt-2 whitespace-pre-wrap break-all rounded-md bg-background p-3 text-xs text-foreground">
          <code>{`VALEDICTORIAN_API_TOKEN=<token> valedictorian-cli --json applications get <id> --workspace ${workspaceSelector}`}</code>
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

function DataSettingsPanel({
  workspace,
  workspaceApi,
}: {
  workspace: WorkspaceSummary | null
  workspaceApi: WorkspacePreloadApi
}) {
  return (
    <section aria-labelledby="data-settings-title" className="space-y-7">
      <div>
        <h2 id="data-settings-title" className="text-xl font-semibold text-foreground">
          Data
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Workspace files and local database paths.
        </p>
      </div>

      <div className="divide-y divide-border rounded-md border border-border bg-card">
        <SettingsTextInput
          label="Workspace path"
          readOnly
          value={workspace?.rootPath ?? 'No workspace selected'}
        />
        <SettingsTextInput
          label="Workspace data path"
          readOnly
          value={workspace?.dataPath ?? 'No workspace selected'}
        />
        <SettingsTextInput
          label="SQLite path"
          readOnly
          value={workspace?.sqlitePath ?? 'No workspace selected'}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" className="gap-2" onClick={() => void workspaceApi.chooseFolder()}>
          <FolderOpen className="h-4 w-4" aria-hidden="true" />
          Choose workspace
        </Button>
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          disabled={!workspace}
          onClick={() => void workspaceApi.revealCurrent()}
        >
          <FolderOpen className="h-4 w-4" aria-hidden="true" />
          Reveal workspace
        </Button>
      </div>
    </section>
  )
}

function AppearanceSettingsPanel({
  settings,
  onSettingsPatch,
}: {
  settings: AppSettings
  onSettingsPatch: (patch: AppSettingsPatch) => void
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
  description,
  icon,
  label,
  value,
}: {
  description: string
  icon: ReactNode
  label: string
  value: RuntimePreference
}) {
  const controlId = `runtime-mode-${value}`

  return (
    <Label
      className="flex cursor-pointer gap-3 rounded-md border border-border bg-card p-3 text-sm text-foreground"
      htmlFor={controlId}
    >
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
      </span>
      <RadioGroupItem
        aria-label={label}
        className="mt-1"
        id={controlId}
        value={value}
      />
    </Label>
  )
}

function isFunctionalSettingsPanel(panel: SettingsPanelId) {
  return (
    panel === SETTINGS_PANELS.GENERAL ||
    panel === SETTINGS_PANELS.PROFILE ||
    panel === SETTINGS_PANELS.CONFIGURATION ||
    panel === SETTINGS_PANELS.CONNECTORS ||
    panel === SETTINGS_PANELS.AGENT_ACCESS ||
    panel === SETTINGS_PANELS.APPEARANCE ||
    panel === SETTINGS_PANELS.POLICY ||
    panel === SETTINGS_PANELS.DATA
  )
}

export { ConnectorRunsPanel, ConnectorSettingsPanel }
