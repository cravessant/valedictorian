import { useEffect, useState, type ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { AlertCircle, ArrowLeft, Bot, Brush, CircleUserRound, Cog, Database, Globe2, KeyRound, Monitor, Search, Server, ShieldCheck, SlidersHorizontal, Terminal } from 'lucide-react'
import { defaultPolicyConfig, type PolicyConfig, type PolicyConfigPatch } from 'sparxie'
import type { PolicyPreloadApi } from '../ipc/policy.preload'
import type { ProfilePreloadApi } from '../ipc/profile.preload'
import type { AppSettings, AppSettingsPatch } from './app-settings'
import { SETTINGS_PANELS, type SettingsPanelId } from '../app/types'
import { SettingsToggleRow } from '../app/AppChrome'
import { ProfileSettingsPanel } from '../modules/profile/ProfileSettingsPanel'
import { SettingsTextInput } from './SettingsTextInput'

interface SettingsPageProps {
  contentColumnClass: string
  policyApi: PolicyPreloadApi
  profileApi: ProfilePreloadApi
  restartRequired: boolean
  selectedPanel: SettingsPanelId
  settings: AppSettings
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
      {
        icon: <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />,
        id: SETTINGS_PANELS.SOURCING_RUNS,
        label: 'Sourcing runs',
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
      className={`h-[calc(100vh-3rem)] w-[280px] overflow-auto border-r border-border bg-card/80 p-4 ${
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
  policyApi,
  profileApi,
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
    <main className={`h-[calc(100vh-3rem)] min-w-0 overflow-auto px-5 py-6 text-foreground sm:px-8 lg:px-12 ${contentColumnClass}`}>
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
          {selectedPanel === SETTINGS_PANELS.GENERAL ? (
            <GeneralSettingsPanel settings={settings} onSettingsPatch={onSettingsPatch} />
          ) : null}
          {selectedPanel === SETTINGS_PANELS.CONFIGURATION ? (
            <ConfigurationSettingsPanel settings={settings} onSettingsPatch={onSettingsPatch} />
          ) : null}
          {selectedPanel === SETTINGS_PANELS.AGENT_ACCESS ? (
            <AgentAccessSettingsPanel apiBaseUrl={apiBaseUrl} settings={settings} />
          ) : null}
          {selectedPanel === SETTINGS_PANELS.APPEARANCE ? (
            <AppearanceSettingsPanel settings={settings} onSettingsPatch={onSettingsPatch} />
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

function PolicySettingsPanel({ policyApi }: { policyApi: PolicyPreloadApi }) {
  const [config, setConfig] = useState<PolicyConfig>(defaultPolicyConfig)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let cancelled = false

    policyApi.config
      .get()
      .then((nextConfig) => {
        if (!cancelled) {
          setConfig(nextConfig)
          setError(null)
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Policy settings failed to load.')
        }
      })

    return () => {
      cancelled = true
    }
  }, [policyApi])

  function updatePolicyConfig(patch: PolicyConfigPatch) {
    setIsSaving(true)
    void policyApi.config
      .update(patch)
      .then((nextConfig) => {
        setConfig(nextConfig)
        setError(null)
      })
      .catch((saveError: unknown) => {
        setError(saveError instanceof Error ? saveError.message : 'Policy settings failed to save.')
      })
      .finally(() => setIsSaving(false))
  }

  function updatePositiveNumber(value: string, fallback: number, onValue: (value: number) => void) {
    const nextValue = Number(value)
    onValue(Number.isFinite(nextValue) && nextValue > 0 ? nextValue : fallback)
  }

  return (
    <section aria-labelledby="policy-settings-title" className="space-y-7">
      <div>
        <h2 id="policy-settings-title" className="text-xl font-semibold text-foreground">
          Policy
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Decision gates and scheduler-ready windows for external harnesses.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive" className="bg-card">
          <AlertCircle className="absolute left-4 top-4 h-4 w-4" aria-hidden="true" />
          <div className="pl-7">
            <AlertTitle>Policy failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </div>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <SettingsTextInput
          label="Apply cutoff"
          value={String(config.scoring.applyCutoff)}
          onChange={(value) =>
            updatePositiveNumber(value, config.scoring.applyCutoff, (applyCutoff) =>
              updatePolicyConfig({ scoring: { applyCutoff } }),
            )
          }
        />
        <SettingsTextInput
          label="Manual pickup hours"
          value={String(config.manualReview.pickupDelayHours)}
          onChange={(value) =>
            updatePositiveNumber(value, config.manualReview.pickupDelayHours, (pickupDelayHours) =>
              updatePolicyConfig({ manualReview: { pickupDelayHours } }),
            )
          }
        />
        <SettingsTextInput
          label="Stale lock hours"
          value={String(config.queue.staleLockHours)}
          onChange={(value) =>
            updatePositiveNumber(value, config.queue.staleLockHours, (staleLockHours) =>
              updatePolicyConfig({ queue: { staleLockHours } }),
            )
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SettingsTextInput
          label="Weekday cadence"
          value={String(config.sourcing.weekdayNormalCadenceHours)}
          onChange={(value) =>
            updatePositiveNumber(value, config.sourcing.weekdayNormalCadenceHours, (weekdayNormalCadenceHours) =>
              updatePolicyConfig({ sourcing: { weekdayNormalCadenceHours } }),
            )
          }
        />
        <SettingsTextInput
          label="Overnight cadence"
          value={String(config.sourcing.weekdayOvernightCadenceHours)}
          onChange={(value) =>
            updatePositiveNumber(value, config.sourcing.weekdayOvernightCadenceHours, (weekdayOvernightCadenceHours) =>
              updatePolicyConfig({ sourcing: { weekdayOvernightCadenceHours } }),
            )
          }
        />
        <SettingsTextInput
          label="Weekend cadence"
          value={String(config.sourcing.weekendCadenceHours)}
          onChange={(value) =>
            updatePositiveNumber(value, config.sourcing.weekendCadenceHours, (weekendCadenceHours) =>
              updatePolicyConfig({ sourcing: { weekendCadenceHours } }),
            )
          }
        />
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={isSaving}
          onClick={() => {
            setIsSaving(true)
            void policyApi.config
              .reset()
              .then((nextConfig) => {
                setConfig(nextConfig)
                setError(null)
              })
              .catch((resetError: unknown) => {
                setError(resetError instanceof Error ? resetError.message : 'Policy reset failed.')
              })
              .finally(() => setIsSaving(false))
          }}
        >
          Reset policy
        </Button>
        {isSaving ? <span className="text-sm text-muted-foreground">Saving...</span> : null}
      </div>
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
  icon: ReactNode
  label: string
  onChange: () => void
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

function isFunctionalSettingsPanel(panel: SettingsPanelId) {
  return (
    panel === SETTINGS_PANELS.GENERAL ||
    panel === SETTINGS_PANELS.PROFILE ||
    panel === SETTINGS_PANELS.CONFIGURATION ||
    panel === SETTINGS_PANELS.AGENT_ACCESS ||
    panel === SETTINGS_PANELS.APPEARANCE ||
    panel === SETTINGS_PANELS.POLICY
  )
}

export { SettingsPage, SettingsSidebar }
