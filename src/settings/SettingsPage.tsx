import { useEffect, useState, type ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { AlertCircle, ArrowLeft, Bot, Brush, CircleUserRound, Cog, Database, FolderOpen, Globe2, KeyRound, Monitor, Search, Server, ShieldCheck, SlidersHorizontal, Terminal } from 'lucide-react'
import {
  defaultPolicyConfig,
  isPolicyEvidenceTag,
  type PolicyConfig,
  type PolicyConfigPatch,
  type PolicyEvidenceTag,
} from 'sparxie'
import type { PolicyPreloadApi } from '../ipc/policy.preload'
import type { ProfilePreloadApi } from '../ipc/profile.preload'
import type { WorkspacePreloadApi } from '../ipc/workspace.preload'
import type { AppSettings, AppSettingsPatch } from './app-settings'
import { SETTINGS_PANELS, type SettingsPanelId } from '../app/types'
import { SettingsToggleRow } from '../app/AppChrome'
import { ProfileSettingsPanel } from '../modules/profile/ProfileSettingsPanel'
import { SettingsTextInput } from './SettingsTextInput'
import type { WorkspaceSummary } from '../workspace/workspace.initializer'

interface SettingsPageProps {
  contentColumnClass: string
  policyApi: PolicyPreloadApi
  profileApi: ProfilePreloadApi
  restartRequired: boolean
  selectedPanel: SettingsPanelId
  settings: AppSettings
  workspace: WorkspaceSummary | null
  workspaceApi: WorkspacePreloadApi
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
      className={`absolute left-0 top-0 z-40 h-full w-[280px] max-w-[85vw] overflow-auto border-r border-border bg-card/80 p-4 shadow-2xl md:h-[calc(100vh-3rem)] md:max-w-none ${
        temporary ? 'md:absolute md:left-0 md:top-0 md:z-40 md:shadow-2xl' : 'md:static md:z-auto md:shadow-none'
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
  workspace,
  workspaceApi,
  onSettingsPatch,
}: SettingsPageProps) {
  const selectedItem = settingsNavGroups
    .flatMap((group) => group.items)
    .find((item) => item.id === selectedPanel)
  const selectedLabel = selectedItem?.label ?? 'General'
  const apiBaseUrl = `http://${settings.localApiHost}:${settings.localApiPort}`

  return (
    <main className={`h-full min-w-0 overflow-auto px-5 py-6 text-foreground md:h-[calc(100vh-3rem)] sm:px-8 lg:px-12 ${contentColumnClass}`}>
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
        <pre className="mt-3 overflow-auto rounded-md bg-background p-3 text-xs text-foreground">
          <code>{`VALEDICTORIAN_API_URL=${apiBaseUrl} valedictorian-cli --json workspaces list`}</code>
        </pre>
        <pre className="mt-2 overflow-auto rounded-md bg-background p-3 text-xs text-foreground">
          <code>{`VALEDICTORIAN_API_URL=${apiBaseUrl} valedictorian-cli --json applications list --workspace ${workspaceSelector}`}</code>
        </pre>
        <pre className="mt-2 overflow-auto rounded-md bg-background p-3 text-xs text-foreground">
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

function PolicySettingsPanel({ policyApi }: { policyApi: PolicyPreloadApi }) {
  const [draftConfig, setDraftConfig] = useState<PolicyConfig>(defaultPolicyConfig)
  const [savedConfig, setSavedConfig] = useState<PolicyConfig>(defaultPolicyConfig)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [savingSection, setSavingSection] = useState<PolicySaveScope>(null)
  const { toast } = useToast()

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)

    policyApi.config
      .get()
      .then((nextConfig) => {
        if (!cancelled) {
          setDraftConfig(nextConfig)
          setSavedConfig(nextConfig)
          setError(null)
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Policy settings failed to load.')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [policyApi])

  function updateDraft(updater: (currentConfig: PolicyConfig) => PolicyConfig) {
    setDraftConfig((currentConfig) => updater(currentConfig))
  }

  function updatePolicyNumber(
    value: string,
    fallback: number,
    onValue: (value: number) => void,
    options: { integer?: boolean; max?: number; min?: number } = {},
  ) {
    const nextValue = Number(value)

    if (!Number.isFinite(nextValue)) {
      onValue(fallback)
      return
    }

    const min = options.min ?? 1
    const max = options.max ?? Number.POSITIVE_INFINITY
    const boundedValue = Math.min(Math.max(nextValue, min), max)
    onValue(options.integer ? Math.round(boundedValue) : boundedValue)
  }

  function savePolicySection(section: PolicySectionKey) {
    const sectionTitle = policySectionTitles[section]
    setSavingSection(section)
    void policyApi.config
      .update(buildPolicySectionPatch(section, draftConfig))
      .then((nextConfig) => {
        setSavedConfig(nextConfig)
        setDraftConfig((currentDraft) => mergeSavedPolicySection(currentDraft, nextConfig, section))
        setError(null)
        toast({
          title: `${sectionTitle} saved.`,
          variant: 'success',
        })
      })
      .catch((saveError: unknown) => {
        const message =
          saveError instanceof Error ? saveError.message : 'Policy settings failed to save.'
        setError(message)
        toast({
          description: message,
          title: 'Policy update failed',
          variant: 'destructive',
        })
      })
      .finally(() => setSavingSection(null))
  }

  function resetPolicyConfig() {
    setSavingSection('reset')
    void policyApi.config
      .reset()
      .then((nextConfig) => {
        setDraftConfig(nextConfig)
        setSavedConfig(nextConfig)
        setError(null)
        toast({
          title: 'Policy reset.',
          variant: 'success',
        })
      })
      .catch((resetError: unknown) => {
        const message = resetError instanceof Error ? resetError.message : 'Policy reset failed.'
        setError(message)
        toast({
          description: message,
          title: 'Policy update failed',
          variant: 'destructive',
        })
      })
      .finally(() => setSavingSection(null))
  }

  return (
    <section aria-labelledby="policy-settings-title" className="space-y-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="policy-settings-title" className="text-xl font-semibold text-foreground">
            Policy
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Queue buckets, evidence gates, submit checks, retry thresholds, and sourcing windows.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={isLoading || savingSection !== null}
          onClick={resetPolicyConfig}
        >
          {savingSection === 'reset' ? 'Resetting...' : 'Reset policy'}
        </Button>
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

      <PolicySection
        isSaving={savingSection === 'queue-decisions'}
        saveDisabled={
          isLoading ||
          savingSection !== null ||
          !hasPolicySectionChanges(draftConfig, savedConfig, 'queue-decisions')
        }
        saveLabel="Save queue decisions"
        title="Queue decisions"
        onSave={() => savePolicySection('queue-decisions')}
      >
        <SettingsTextInput
          label="Apply cutoff"
          type="number"
          value={String(draftConfig.scoring.applyCutoff)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.scoring.applyCutoff, (applyCutoff) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                scoring: { ...currentConfig.scoring, applyCutoff },
              })),
            )
          }
        />
        <SettingsTextInput
          label="Stale lock hours"
          type="number"
          value={String(draftConfig.queue.staleLockHours)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.queue.staleLockHours, (staleLockHours) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                queue: { ...currentConfig.queue, staleLockHours },
              })),
            )
          }
        />
      </PolicySection>

      <PolicySection
        isSaving={savingSection === 'manual-review'}
        saveDisabled={
          isLoading ||
          savingSection !== null ||
          !hasPolicySectionChanges(draftConfig, savedConfig, 'manual-review')
        }
        saveLabel="Save manual review"
        title="Manual review"
        onSave={() => savePolicySection('manual-review')}
      >
        <SettingsTextInput
          label="Manual pickup delay"
          type="number"
          value={String(draftConfig.manualReview.pickupDelayHours)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.manualReview.pickupDelayHours, (pickupDelayHours) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                manualReview: { ...currentConfig.manualReview, pickupDelayHours },
              })),
            )
          }
        />
        <SettingsTextInput
          label="Pickup window start"
          type="time"
          value={draftConfig.manualReview.daytimeWindow.start}
          onChange={(start) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              manualReview: {
                ...currentConfig.manualReview,
                daytimeWindow: { ...currentConfig.manualReview.daytimeWindow, start },
              },
            }))
          }
        />
        <SettingsTextInput
          label="Pickup window end"
          type="time"
          value={draftConfig.manualReview.daytimeWindow.end}
          onChange={(end) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              manualReview: {
                ...currentConfig.manualReview,
                daytimeWindow: { ...currentConfig.manualReview.daytimeWindow, end },
              },
            }))
          }
        />
        <SettingsTextInput
          label="Pickup window timezone"
          value={draftConfig.manualReview.daytimeWindow.timezone}
          onChange={(timezone) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              manualReview: {
                ...currentConfig.manualReview,
                daytimeWindow: { ...currentConfig.manualReview.daytimeWindow, timezone },
              },
            }))
          }
        />
        <PolicyTextArea
          label="Non-overridable evidence tags"
          value={formatStringList(draftConfig.manualReview.nonOverridableTags)}
          onChange={(value) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              manualReview: {
                ...currentConfig.manualReview,
                nonOverridableTags: parsePolicyEvidenceTagList(value),
              },
            }))
          }
        />
        <PolicyTextArea
          label="Manual review companies"
          value={formatStringList(draftConfig.manualReview.manualReviewCompanyPatterns)}
          onChange={(value) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              manualReview: {
                ...currentConfig.manualReview,
                manualReviewCompanyPatterns: parseStringList(value),
              },
            }))
          }
        />
        <PolicyTextArea
          label="Explicit approval companies"
          value={formatStringList(draftConfig.manualReview.explicitApprovalCompanyPatterns)}
          onChange={(value) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              manualReview: {
                ...currentConfig.manualReview,
                explicitApprovalCompanyPatterns: parseStringList(value),
              },
            }))
          }
        />
      </PolicySection>

      <PolicySection
        isSaving={savingSection === 'evidence-requirements'}
        saveDisabled={
          isLoading ||
          savingSection !== null ||
          !hasPolicySectionChanges(draftConfig, savedConfig, 'evidence-requirements')
        }
        saveLabel="Save evidence requirements"
        title="Evidence requirements"
        onSave={() => savePolicySection('evidence-requirements')}
      >
        <PolicyTextArea
          label="Allowed native platforms"
          value={formatStringList(draftConfig.officialPath.allowedNativePlatforms)}
          onChange={(value) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              officialPath: {
                ...currentConfig.officialPath,
                allowedNativePlatforms: parseStringList(value),
              },
            }))
          }
        />
        <PolicyTextArea
          label="High-risk form builders"
          value={formatStringList(draftConfig.officialPath.highRiskFormBuilders)}
          onChange={(value) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              officialPath: {
                ...currentConfig.officialPath,
                highRiskFormBuilders: parseStringList(value),
              },
            }))
          }
        />
        <SettingsToggleRow
          checked={draftConfig.officialPath.requireEmployerDomainVerificationForHighRiskForms}
          description="High-risk forms need employer-domain proof before promotion."
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          label="Require employer-domain verification"
          onChange={(requireEmployerDomainVerificationForHighRiskForms) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              officialPath: {
                ...currentConfig.officialPath,
                requireEmployerDomainVerificationForHighRiskForms,
              },
            }))
          }
        />
      </PolicySection>

      <PolicySection
        isSaving={savingSection === 'application-gates'}
        saveDisabled={
          isLoading ||
          savingSection !== null ||
          !hasPolicySectionChanges(draftConfig, savedConfig, 'application-gates')
        }
        saveLabel="Save application gates"
        title="Application gates"
        onSave={() => savePolicySection('application-gates')}
      >
        <SettingsToggleRow
          checked={draftConfig.verification.requireFinalReviewReceiptForSubmit}
          description="Submit outcomes need a final review receipt."
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          label="Require final review receipt"
          onChange={(requireFinalReviewReceiptForSubmit) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              verification: {
                ...currentConfig.verification,
                requireFinalReviewReceiptForSubmit,
              },
            }))
          }
        />
        <SettingsToggleRow
          checked={draftConfig.verification.requireSecondPassForSubmit}
          description="Submit outcomes need second-pass verification."
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          label="Require second pass verification"
          onChange={(requireSecondPassForSubmit) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              verification: {
                ...currentConfig.verification,
                requireSecondPassForSubmit,
              },
            }))
          }
        />
      </PolicySection>

      <PolicySection
        isSaving={savingSection === 'retry-recovery'}
        saveDisabled={
          isLoading ||
          savingSection !== null ||
          !hasPolicySectionChanges(draftConfig, savedConfig, 'retry-recovery')
        }
        saveLabel="Save retry recovery"
        title="Retry recovery"
        onSave={() => savePolicySection('retry-recovery')}
      >
        <SettingsTextInput
          label="Captcha/security retries"
          type="number"
          value={String(draftConfig.retries.captchaSecurityMinProfileAttempts)}
          onChange={(value) =>
            updatePolicyNumber(
              value,
              draftConfig.retries.captchaSecurityMinProfileAttempts,
              (captchaSecurityMinProfileAttempts) =>
                updateDraft((currentConfig) => ({
                  ...currentConfig,
                  retries: {
                    ...currentConfig.retries,
                    captchaSecurityMinProfileAttempts,
                  },
                })),
              { integer: true },
            )
          }
        />
        <SettingsTextInput
          label="Platform error retries"
          type="number"
          value={String(draftConfig.retries.platformErrorMinProfileAttempts)}
          onChange={(value) =>
            updatePolicyNumber(
              value,
              draftConfig.retries.platformErrorMinProfileAttempts,
              (platformErrorMinProfileAttempts) =>
                updateDraft((currentConfig) => ({
                  ...currentConfig,
                  retries: {
                    ...currentConfig.retries,
                    platformErrorMinProfileAttempts,
                  },
                })),
              { integer: true },
            )
          }
        />
        <SettingsToggleRow
          checked={draftConfig.retries.loginNeededRequiresRecoveryAttempt}
          description="Login-needed outcomes require recovery evidence."
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          label="Login recovery required"
          onChange={(loginNeededRequiresRecoveryAttempt) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              retries: {
                ...currentConfig.retries,
                loginNeededRequiresRecoveryAttempt,
              },
            }))
          }
        />
      </PolicySection>

      <PolicySection
        isSaving={savingSection === 'sourcing-windows'}
        saveDisabled={
          isLoading ||
          savingSection !== null ||
          !hasPolicySectionChanges(draftConfig, savedConfig, 'sourcing-windows')
        }
        saveLabel="Save sourcing windows"
        title="Sourcing windows"
        onSave={() => savePolicySection('sourcing-windows')}
      >
        <SettingsTextInput
          label="Sourcing timezone"
          value={draftConfig.sourcing.timezone}
          onChange={(timezone) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              sourcing: { ...currentConfig.sourcing, timezone },
            }))
          }
        />
        <SettingsTextInput
          label="Overlap minutes"
          type="number"
          value={String(draftConfig.sourcing.overlapMinutes)}
          onChange={(value) =>
            updatePolicyNumber(
              value,
              draftConfig.sourcing.overlapMinutes,
              (overlapMinutes) =>
                updateDraft((currentConfig) => ({
                  ...currentConfig,
                  sourcing: { ...currentConfig.sourcing, overlapMinutes },
                })),
              { integer: true },
            )
          }
        />
        <SettingsTextInput
          label="Weekday cadence"
          type="number"
          value={String(draftConfig.sourcing.weekdayNormalCadenceHours)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.sourcing.weekdayNormalCadenceHours, (weekdayNormalCadenceHours) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                sourcing: { ...currentConfig.sourcing, weekdayNormalCadenceHours },
              })),
            )
          }
        />
        <SettingsTextInput
          label="Overnight cadence"
          type="number"
          value={String(draftConfig.sourcing.weekdayOvernightCadenceHours)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.sourcing.weekdayOvernightCadenceHours, (weekdayOvernightCadenceHours) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                sourcing: { ...currentConfig.sourcing, weekdayOvernightCadenceHours },
              })),
            )
          }
        />
        <SettingsTextInput
          label="Weekend cadence"
          type="number"
          value={String(draftConfig.sourcing.weekendCadenceHours)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.sourcing.weekendCadenceHours, (weekendCadenceHours) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                sourcing: { ...currentConfig.sourcing, weekendCadenceHours },
              })),
            )
          }
        />
        <SettingsTextInput
          label="Minimum lookback"
          type="number"
          value={String(draftConfig.sourcing.minimumNormalLookbackHours)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.sourcing.minimumNormalLookbackHours, (minimumNormalLookbackHours) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                sourcing: { ...currentConfig.sourcing, minimumNormalLookbackHours },
              })),
            )
          }
        />
        <SettingsTextInput
          label="Overnight start hour"
          type="number"
          value={String(draftConfig.sourcing.overnightStartHour)}
          onChange={(value) =>
            updatePolicyNumber(
              value,
              draftConfig.sourcing.overnightStartHour,
              (overnightStartHour) =>
                updateDraft((currentConfig) => ({
                  ...currentConfig,
                  sourcing: { ...currentConfig.sourcing, overnightStartHour },
                })),
              { integer: true, max: 23, min: 0 },
            )
          }
        />
        <SettingsTextInput
          label="Overnight end hour"
          type="number"
          value={String(draftConfig.sourcing.overnightEndHour)}
          onChange={(value) =>
            updatePolicyNumber(
              value,
              draftConfig.sourcing.overnightEndHour,
              (overnightEndHour) =>
                updateDraft((currentConfig) => ({
                  ...currentConfig,
                  sourcing: { ...currentConfig.sourcing, overnightEndHour },
                })),
              { integer: true, max: 23, min: 0 },
            )
          }
        />
      </PolicySection>
    </section>
  )
}

function PolicySection({
  children,
  isSaving,
  saveDisabled,
  saveLabel,
  title,
  onSave,
}: {
  children: ReactNode
  isSaving: boolean
  saveDisabled: boolean
  saveLabel: string
  title: string
  onSave: () => void
}) {
  return (
    <section aria-labelledby={`policy-section-${slugify(title)}`} className="space-y-3">
      <h3 id={`policy-section-${slugify(title)}`} className="text-sm font-semibold text-foreground">
        {title}
      </h3>
      <div className="divide-y divide-border rounded-md border border-border bg-card">
        {children}
        <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3">
          <Button type="button" disabled={saveDisabled} onClick={onSave}>
            {isSaving ? 'Saving...' : saveLabel}
          </Button>
        </div>
      </div>
    </section>
  )
}

function PolicyTextArea({
  label,
  onChange,
  value,
}: {
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <label className="grid gap-2 px-4 py-3 text-sm text-foreground md:grid-cols-[220px_1fr]">
      <span className="pt-2">
        <span className="block font-medium">{label}</span>
      </span>
      <textarea
        aria-label={label}
        className="min-h-24 w-full min-w-0 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function formatStringList(values: readonly string[]) {
  return values.join('\n')
}

function parseStringList(value: string) {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function parsePolicyEvidenceTagList(value: string): PolicyEvidenceTag[] {
  return parseStringList(value).filter(isPolicyEvidenceTag)
}

function slugify(value: string) {
  return value.toLowerCase().replace(/\s+/g, '-')
}

type PolicySectionKey =
  | 'application-gates'
  | 'evidence-requirements'
  | 'manual-review'
  | 'queue-decisions'
  | 'retry-recovery'
  | 'sourcing-windows'

type PolicySaveScope = PolicySectionKey | 'reset' | null

const policySectionTitles: Record<PolicySectionKey, string> = {
  'application-gates': 'Application gates',
  'evidence-requirements': 'Evidence requirements',
  'manual-review': 'Manual review',
  'queue-decisions': 'Queue decisions',
  'retry-recovery': 'Retry recovery',
  'sourcing-windows': 'Sourcing windows',
}

function hasPolicySectionChanges(
  draftConfig: PolicyConfig,
  savedConfig: PolicyConfig,
  section: PolicySectionKey,
) {
  return (
    JSON.stringify(readPolicySection(draftConfig, section)) !==
    JSON.stringify(readPolicySection(savedConfig, section))
  )
}

function buildPolicySectionPatch(
  section: PolicySectionKey,
  config: PolicyConfig,
): PolicyConfigPatch {
  switch (section) {
    case 'application-gates':
      return { verification: config.verification }
    case 'evidence-requirements':
      return { officialPath: config.officialPath }
    case 'manual-review':
      return { manualReview: config.manualReview }
    case 'queue-decisions':
      return {
        queue: config.queue,
        scoring: config.scoring,
      }
    case 'retry-recovery':
      return { retries: config.retries }
    case 'sourcing-windows':
      return { sourcing: config.sourcing }
  }
}

function mergeSavedPolicySection(
  draftConfig: PolicyConfig,
  savedConfig: PolicyConfig,
  section: PolicySectionKey,
): PolicyConfig {
  switch (section) {
    case 'application-gates':
      return { ...draftConfig, verification: savedConfig.verification }
    case 'evidence-requirements':
      return { ...draftConfig, officialPath: savedConfig.officialPath }
    case 'manual-review':
      return { ...draftConfig, manualReview: savedConfig.manualReview }
    case 'queue-decisions':
      return {
        ...draftConfig,
        queue: savedConfig.queue,
        scoring: savedConfig.scoring,
      }
    case 'retry-recovery':
      return { ...draftConfig, retries: savedConfig.retries }
    case 'sourcing-windows':
      return { ...draftConfig, sourcing: savedConfig.sourcing }
  }
}

function readPolicySection(config: PolicyConfig, section: PolicySectionKey) {
  switch (section) {
    case 'application-gates':
      return config.verification
    case 'evidence-requirements':
      return config.officialPath
    case 'manual-review':
      return config.manualReview
    case 'queue-decisions':
      return {
        queue: config.queue,
        scoring: config.scoring,
      }
    case 'retry-recovery':
      return config.retries
    case 'sourcing-windows':
      return config.sourcing
  }
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
    panel === SETTINGS_PANELS.POLICY ||
    panel === SETTINGS_PANELS.DATA
  )
}

export { SettingsPage, SettingsSidebar }
