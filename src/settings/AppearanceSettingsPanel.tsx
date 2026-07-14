import { useEffect, useState, type CSSProperties } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { typography } from '@/components/ui/typography'
import { Check, RotateCcw, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import { SettingsToggleRow } from '../app/AppChrome'
import type { AppSettings, AppSettingsPatch } from './app-settings'
import {
  getThemeContrastIssues,
  getThemeDefinition,
  isThemeColor,
  resolveTheme,
  themePresetIds,
  type ResolvedTheme,
  type ThemeColorRole,
} from '../theme/theme-registry'

interface AppearanceSettingsPanelProps {
  settings: AppSettings
  onSettingsPatch: (patch: AppSettingsPatch) => void
}

interface ColorRoleGroup {
  label: string
  roles: ThemeColorRole[]
}

const colorRoleGroups: ColorRoleGroup[] = [
  {
    label: 'Surfaces',
    roles: ['background', 'foreground', 'card', 'cardForeground', 'popover', 'popoverForeground'],
  },
  {
    label: 'Actions',
    roles: [
      'primary',
      'primaryForeground',
      'secondary',
      'secondaryForeground',
      'accent',
      'accentForeground',
      'destructive',
    ],
  },
  {
    label: 'Controls',
    roles: ['border', 'input', 'ring'],
  },
  {
    label: 'Status',
    roles: ['success', 'warning'],
  },
  {
    label: 'Decorations',
    roles: ['bodyGradientStart', 'bodyGradientEnd', 'selection', 'formControlIcon'],
  },
]

export function AppearanceSettingsPanel({
  settings,
  onSettingsPatch,
}: AppearanceSettingsPanelProps) {
  const resolvedTheme = resolveTheme(settings.theme)
  const contrastIssues = getThemeContrastIssues(resolvedTheme)
  const hasOverrides = Object.keys(settings.theme.overrides).length > 0

  function updateTheme(theme: AppSettings['theme']) {
    onSettingsPatch({ theme })
  }

  function selectPreset(presetId: string) {
    if (!themePresetIds.includes(presetId as typeof themePresetIds[number])) {
      return
    }

    updateTheme({ presetId: presetId as typeof themePresetIds[number], overrides: {} })
  }

  function updateColor(role: ThemeColorRole, value: string) {
    if (!isThemeColor(value)) {
      return
    }

    updateTheme({
      presetId: settings.theme.presetId,
      overrides: {
        ...settings.theme.overrides,
        [role]: value,
      },
    })
  }

  function resetColor(role: ThemeColorRole) {
    const { [role]: _removed, ...overrides } = settings.theme.overrides
    updateTheme({ presetId: settings.theme.presetId, overrides })
  }

  function resetTheme() {
    updateTheme({ presetId: settings.theme.presetId, overrides: {} })
  }

  return (
    <section aria-labelledby="appearance-settings-title" className="space-y-8">
      <div>
        <h2 id="appearance-settings-title" className={typography.sectionTitle}>
          Appearance
        </h2>
        <p className={typography.sectionDescription}>
          Make this workspace feel like yours. Theme changes apply immediately and stay with this workspace.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
        <div className="@container/theme-panel rounded-lg border border-border bg-card/55 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className={typography.panelTitle}>Workspace theme</h3>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Start with a preset, then tune any semantic color below.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={!hasOverrides}
              onClick={resetTheme}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Reset theme
            </Button>
          </div>

          <RadioGroup
            aria-label="Workspace theme presets"
            className="mt-5 grid grid-cols-1 gap-3 @md/theme-panel:grid-cols-2 @2xl/theme-panel:grid-cols-3"
            value={settings.theme.presetId}
            onValueChange={selectPreset}
          >
            {themePresetIds.map((presetId) => (
              <ThemePresetCard
                key={presetId}
                presetId={presetId}
                selected={settings.theme.presetId === presetId}
                customized={settings.theme.presetId === presetId && hasOverrides}
              />
            ))}
          </RadioGroup>
        </div>

        <ThemePreview theme={resolvedTheme} />
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className={typography.panelTitle}>Customize colors</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Use six- or eight-digit hex values. Alpha is supported for translucent surfaces and selection.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {hasOverrides ? `${Object.keys(settings.theme.overrides).length} custom colors` : 'Using preset colors'}
          </span>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {colorRoleGroups.map((group) => (
            <ColorRoleGroupCard
              key={group.label}
              group={group}
              overrides={settings.theme.overrides}
              palette={resolvedTheme.palette}
              onColorChange={updateColor}
              onReset={resetColor}
            />
          ))}
        </div>
      </div>

      <ContrastFeedback issues={contrastIssues} />

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

function ThemePresetCard({
  presetId,
  selected,
  customized,
}: {
  presetId: typeof themePresetIds[number]
  selected: boolean
  customized: boolean
}) {
  const definition = getThemeDefinition(presetId)
  const controlId = `theme-preset-${presetId}`

  return (
    <Label
      className={`relative min-h-32 cursor-pointer items-start rounded-md border p-3 pr-9 text-left transition-[border-color,background-color,box-shadow] duration-150 motion-reduce:transition-none ${
        selected
          ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary/30'
          : 'border-border bg-background/35 hover:border-ring/70 hover:bg-accent/35'
      }`}
      htmlFor={controlId}
    >
      <div className="min-w-0 flex-1">
        <span className="flex h-5 overflow-hidden rounded-sm border border-black/10">
          {definition.swatches.map((swatch) => (
            <span
              key={swatch}
              className="min-w-0 flex-1"
              style={{ backgroundColor: swatch }}
              aria-hidden="true"
            />
          ))}
        </span>
        <span className="mt-3 block text-sm font-medium text-foreground">{definition.label}</span>
        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
          {customized ? 'Customized' : definition.description}
        </span>
      </div>
      <RadioGroupItem
        id={controlId}
        value={presetId}
        aria-label={definition.label}
        className="absolute top-3 right-3"
      />
    </Label>
  )
}

function ThemePreview({ theme }: { theme: ResolvedTheme }) {
  const { palette } = theme
  const previewStyle = {
    '--preview-background': palette.background,
    '--preview-foreground': palette.foreground,
    '--preview-card': palette.card,
    '--preview-card-foreground': palette.cardForeground,
    '--preview-muted': palette.muted,
    '--preview-muted-foreground': palette.mutedForeground,
    '--preview-primary': palette.primary,
    '--preview-primary-foreground': palette.primaryForeground,
    '--preview-border': palette.border,
  } as CSSProperties

  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="theme-preview"
      style={previewStyle}
    >
      <div className="flex items-center justify-between border-b px-4 py-3 text-xs" style={{ borderColor: palette.border, backgroundColor: palette.card, color: palette.cardForeground }}>
        <span className="font-medium">Preview</span>
        <span style={{ color: palette.mutedForeground }}>Applications</span>
      </div>
      <div className="grid min-h-56 grid-cols-[5rem_1fr]" style={{ backgroundColor: palette.background, color: palette.foreground }}>
        <aside className="border-r p-3" style={{ borderColor: palette.border, backgroundColor: palette.card }}>
          <div className="h-2.5 w-8 rounded-sm" style={{ backgroundColor: palette.primary }} />
          <div className="mt-5 space-y-2">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="h-2 rounded-sm"
                style={{ backgroundColor: item === 0 ? palette.primary : palette.muted }}
              />
            ))}
          </div>
        </aside>
        <div className="space-y-3 p-4">
          <div className="rounded-md border p-3" style={{ borderColor: palette.border, backgroundColor: palette.card, color: palette.cardForeground }}>
            <div className="flex items-center justify-between gap-2">
              <span className="h-2.5 w-20 rounded-sm" style={{ backgroundColor: palette.foreground, opacity: 0.8 }} />
              <span className="rounded-sm px-1.5 py-1 text-[9px]" style={{ backgroundColor: palette.primary, color: palette.primaryForeground }}>Open</span>
            </div>
            <div className="mt-3 space-y-2">
              {[0, 1, 2].map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <span className="h-1.5 flex-1 rounded-sm" style={{ backgroundColor: item === 0 ? palette.foreground : palette.muted, opacity: item === 0 ? 0.65 : 1 }} />
                  <span className="h-1.5 w-8 rounded-sm" style={{ backgroundColor: palette.muted }} />
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['primary', palette.primary],
              ['success', palette.success],
              ['warning', palette.warning],
            ].map(([role, color]) => (
              <div key={role} className="h-7 rounded-sm border" style={{ borderColor: palette.border, backgroundColor: color, opacity: 0.85 }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ColorRoleGroupCard({
  group,
  overrides,
  palette,
  onColorChange,
  onReset,
}: {
  group: ColorRoleGroup
  overrides: Partial<ResolvedTheme['palette']>
  palette: ResolvedTheme['palette']
  onColorChange: (role: ThemeColorRole, value: string) => void
  onReset: (role: ThemeColorRole) => void
}) {
  return (
    <div className="rounded-lg border border-border bg-card/45 p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</h4>
      <div className="mt-3 divide-y divide-border/70">
        {group.roles.map((role) => (
          <ColorRoleRow
            key={role}
            role={role}
            value={palette[role]}
            customized={role in overrides}
            onChange={(value) => onColorChange(role, value)}
            onReset={() => onReset(role)}
          />
        ))}
      </div>
    </div>
  )
}

function ColorRoleRow({
  role,
  value,
  customized,
  onChange,
  onReset,
}: {
  role: ThemeColorRole
  value: string
  customized: boolean
  onChange: (value: string) => void
  onReset: () => void
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  const colorInputValue = value.slice(0, 7)
  const label = formatColorRole(role)

  return (
    <div className="grid grid-cols-[minmax(5.5rem,1fr)_2.75rem_minmax(0,1.2fr)_auto] items-center gap-2 py-2.5">
      <Label className="min-w-0 text-xs text-foreground" htmlFor={`theme-color-${role}`}>
        <span className="truncate">{label}</span>
        {customized ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" title="Customized" /> : null}
      </Label>
      <Input
        aria-label={`${label} color picker`}
        className="h-8 w-12 cursor-pointer p-1"
        type="color"
        value={colorInputValue}
        onChange={(event) => onChange(`${event.target.value}${value.length === 9 ? value.slice(7) : ''}`)}
      />
      <Input
        id={`theme-color-${role}`}
        aria-label={`${label} hex value`}
        className="h-8 font-mono text-xs uppercase"
        value={draft}
        onChange={(event) => {
          const nextDraft = event.target.value
          setDraft(nextDraft)
          if (isThemeColor(nextDraft)) {
            onChange(nextDraft)
          }
        }}
        onBlur={() => {
          if (!isThemeColor(draft)) {
            setDraft(value)
          }
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Reset ${label}`}
        title={`Reset ${label}`}
        disabled={!customized}
        onClick={onReset}
      >
        <RotateCcw aria-hidden="true" />
      </Button>
    </div>
  )
}

function ContrastFeedback({
  issues,
}: {
  issues: ReturnType<typeof getThemeContrastIssues>
}) {
  if (issues.length === 0) {
    return (
      <Alert className="border-success/30 bg-success/5 text-success">
        <Check aria-hidden="true" />
        <AlertTitle>Contrast checks pass</AlertTitle>
        <AlertDescription className="text-success/80">
          The main text and control pairs meet the recommended 4.5:1 contrast ratio.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert variant="destructive">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>Review contrast</AlertTitle>
      <AlertDescription>
        <span>Some text pairs are below the recommended 4.5:1 ratio:</span>
        <ul className="list-disc pl-5">
          {issues.map((issue) => (
            <li key={`${issue.foreground}-${issue.background}`}>
              {formatColorRole(issue.foreground)} on {formatColorRole(issue.background)} ({issue.ratio}:1)
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

function formatColorRole(role: ThemeColorRole) {
  return role.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase())
}
