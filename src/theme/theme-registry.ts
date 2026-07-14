export const themePresetIds = [
  'catppuccin-blur-mocha',
  'catppuccin-latte',
  'graphite',
] as const

export type ThemePresetId = typeof themePresetIds[number]

export const themeColorRoles = [
  'background',
  'foreground',
  'card',
  'cardForeground',
  'popover',
  'popoverForeground',
  'primary',
  'primaryForeground',
  'secondary',
  'secondaryForeground',
  'muted',
  'mutedForeground',
  'accent',
  'accentForeground',
  'destructive',
  'border',
  'input',
  'ring',
  'success',
  'warning',
  'bodyGradientStart',
  'bodyGradientEnd',
  'selection',
  'formControlIcon',
] as const

export type ThemeColorRole = typeof themeColorRoles[number]
export type ThemePalette = Record<ThemeColorRole, string>
export type ThemePaletteOverrides = Partial<ThemePalette>

export interface ThemeSettings {
  presetId: ThemePresetId
  overrides: ThemePaletteOverrides
}

export interface ResolvedTheme {
  presetId: ThemePresetId
  palette: ThemePalette
  colorScheme: 'light' | 'dark'
  firstPaintBackground: string
  titleBarBackground: string
  titleBarSymbolColor: string
  radius: string
}

export interface ThemeDefinition extends ResolvedTheme {
  label: string
  description: string
  swatches: string[]
}

const catppuccinBlurMocha: ThemeDefinition = {
  presetId: 'catppuccin-blur-mocha',
  label: 'Catppuccin Blur Mocha',
  description: 'The original Valedictorian palette: soft lavender on deep mocha surfaces.',
  colorScheme: 'dark',
  firstPaintBackground: '#181825',
  titleBarBackground: '#181825',
  titleBarSymbolColor: '#cdd6f4',
  radius: '0.375rem',
  swatches: ['#1e1e2e', '#181825', '#cba6f7', '#a6e3a1', '#f38ba8'],
  palette: {
    background: '#1e1e2ed7',
    foreground: '#cdd6f4',
    card: '#181825cc',
    cardForeground: '#cdd6f4',
    popover: '#181825f2',
    popoverForeground: '#cdd6f4',
    primary: '#cba6f7',
    primaryForeground: '#11111b',
    secondary: '#313244',
    secondaryForeground: '#cdd6f4',
    muted: '#313244',
    mutedForeground: '#a6adc8',
    accent: '#45475a',
    accentForeground: '#f5e0dc',
    destructive: '#f38ba8',
    border: '#31324499',
    input: '#313244',
    ring: '#cba6f7',
    success: '#a6e3a1',
    warning: '#f9e2af',
    bodyGradientStart: '#1e1e2e',
    bodyGradientEnd: '#181825',
    selection: '#cba6f750',
    formControlIcon: '#a6adc8',
  },
}

const catppuccinLatte: ThemeDefinition = {
  presetId: 'catppuccin-latte',
  label: 'Catppuccin Latte',
  description: 'A light workspace with warm paper surfaces and deep mauve text.',
  colorScheme: 'light',
  firstPaintBackground: '#e6e9ef',
  titleBarBackground: '#e6e9ef',
  titleBarSymbolColor: '#4c4f69',
  radius: '0.375rem',
  swatches: ['#eff1f5', '#e6e9ef', '#8839ef', '#40a02b', '#d20f39'],
  palette: {
    background: '#eff1f5',
    foreground: '#4c4f69',
    card: '#e6e9ef',
    cardForeground: '#4c4f69',
    popover: '#e6e9ef',
    popoverForeground: '#4c4f69',
    primary: '#8839ef',
    primaryForeground: '#eff1f5',
    secondary: '#ccd0da',
    secondaryForeground: '#4c4f69',
    muted: '#dce0e8',
    mutedForeground: '#6c6f85',
    accent: '#bcc0cc',
    accentForeground: '#3c3f52',
    destructive: '#d20f39',
    border: '#bcc0cc',
    input: '#ccd0da',
    ring: '#8839ef',
    success: '#40a02b',
    warning: '#df8e1d',
    bodyGradientStart: '#eff1f5',
    bodyGradientEnd: '#e6e9ef',
    selection: '#8839ef35',
    formControlIcon: '#6c6f85',
  },
}

const graphite: ThemeDefinition = {
  presetId: 'graphite',
  label: 'Graphite',
  description: 'A neutral dark palette with cool blue focus accents and quiet surfaces.',
  colorScheme: 'dark',
  firstPaintBackground: '#1b2228',
  titleBarBackground: '#1b2228',
  titleBarSymbolColor: '#e7eef2',
  radius: '0.375rem',
  swatches: ['#12161a', '#1b2228', '#7dd3fc', '#86efac', '#fb7185'],
  palette: {
    background: '#12161a',
    foreground: '#e7eef2',
    card: '#1b2228',
    cardForeground: '#e7eef2',
    popover: '#1b2228',
    popoverForeground: '#e7eef2',
    primary: '#7dd3fc',
    primaryForeground: '#08202d',
    secondary: '#26313a',
    secondaryForeground: '#e7eef2',
    muted: '#26313a',
    mutedForeground: '#a9b7c2',
    accent: '#34424d',
    accentForeground: '#e7eef2',
    destructive: '#fb7185',
    border: '#34424d',
    input: '#26313a',
    ring: '#7dd3fc',
    success: '#86efac',
    warning: '#facc15',
    bodyGradientStart: '#12161a',
    bodyGradientEnd: '#1b2228',
    selection: '#7dd3fc35',
    formControlIcon: '#a9b7c2',
  },
}

export const themeDefinitions: Record<ThemePresetId, ThemeDefinition> = {
  'catppuccin-blur-mocha': catppuccinBlurMocha,
  'catppuccin-latte': catppuccinLatte,
  graphite,
}

export function getThemeDefinition(presetId: ThemePresetId) {
  return themeDefinitions[presetId]
}

export function createDefaultThemeSettings(): ThemeSettings {
  return {
    presetId: 'catppuccin-blur-mocha',
    overrides: {},
  }
}

export function normalizeThemeSettings(value: unknown): ThemeSettings {
  if (!value || typeof value !== 'object') {
    return createDefaultThemeSettings()
  }

  const candidate = value as Record<string, unknown>

  if (!isThemePresetId(candidate.presetId)) {
    return createDefaultThemeSettings()
  }

  const presetId = candidate.presetId
  const overrides = normalizeThemeOverrides(candidate.overrides)

  return { presetId, overrides }
}

export function resolveTheme(settings: ThemeSettings): ResolvedTheme {
  const definition = getThemeDefinition(settings.presetId)
  const palette = {
    ...definition.palette,
    ...settings.overrides,
  }

  return {
    ...definition,
    palette,
    firstPaintBackground: toOpaqueThemeColor(palette.bodyGradientEnd),
    titleBarBackground: toOpaqueThemeColor(palette.card),
    titleBarSymbolColor: toOpaqueThemeColor(palette.foreground),
  }
}

function toOpaqueThemeColor(color: string) {
  return color.slice(0, 7)
}

export function isThemePresetId(value: unknown): value is ThemePresetId {
  return typeof value === 'string' && themePresetIds.includes(value as ThemePresetId)
}

export function isThemeColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(value)
}

export interface ThemeContrastIssue {
  foreground: ThemeColorRole
  background: ThemeColorRole
  ratio: number
}

const contrastPairs: Array<[ThemeColorRole, ThemeColorRole]> = [
  ['foreground', 'background'],
  ['cardForeground', 'card'],
  ['popoverForeground', 'popover'],
  ['primaryForeground', 'primary'],
  ['secondaryForeground', 'secondary'],
  ['accentForeground', 'accent'],
]

export function getThemeContrastIssues(theme: ResolvedTheme, minimumRatio = 4.5) {
  return contrastPairs.reduce<ThemeContrastIssue[]>((issues, [foreground, background]) => {
    const ratio = contrastRatio(theme.palette[foreground], theme.palette[background])

    if (ratio < minimumRatio) {
      issues.push({ foreground, background, ratio: Math.round(ratio * 100) / 100 })
    }

    return issues
  }, [])
}

export function contrastRatio(foreground: string, background: string) {
  const foregroundRgb = parseThemeColor(foreground)
  const backgroundRgb = parseThemeColor(background)

  if (!foregroundRgb || !backgroundRgb) {
    return 1
  }

  const blendedForeground = blend(foregroundRgb, backgroundRgb)
  const foregroundLuminance = relativeLuminance(blendedForeground)
  const backgroundLuminance = relativeLuminance(backgroundRgb)
  const brightest = Math.max(foregroundLuminance, backgroundLuminance)
  const darkest = Math.min(foregroundLuminance, backgroundLuminance)

  return (brightest + 0.05) / (darkest + 0.05)
}

function normalizeThemeOverrides(value: unknown): ThemePaletteOverrides {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const candidate = value as Record<string, unknown>

  return themeColorRoles.reduce<ThemePaletteOverrides>((overrides, role) => {
    if (isThemeColor(candidate[role])) {
      overrides[role] = candidate[role]
    }

    return overrides
  }, {})
}

function parseThemeColor(value: string) {
  if (!isThemeColor(value)) {
    return null
  }

  const numeric = Number.parseInt(value.slice(1), 16)
  const hasAlpha = value.length === 9

  return {
    red: (numeric >> (hasAlpha ? 24 : 16)) & 0xff,
    green: (numeric >> (hasAlpha ? 16 : 8)) & 0xff,
    blue: (numeric >> (hasAlpha ? 8 : 0)) & 0xff,
    alpha: hasAlpha ? (numeric & 0xff) / 255 : 1,
  }
}

function blend(
  foreground: { red: number; green: number; blue: number; alpha: number },
  background: { red: number; green: number; blue: number; alpha: number },
) {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha)

  if (alpha === 0) {
    return { red: 0, green: 0, blue: 0 }
  }

  return {
    red: (foreground.red * foreground.alpha + background.red * background.alpha * (1 - foreground.alpha)) / alpha,
    green: (foreground.green * foreground.alpha + background.green * background.alpha * (1 - foreground.alpha)) / alpha,
    blue: (foreground.blue * foreground.alpha + background.blue * background.alpha * (1 - foreground.alpha)) / alpha,
  }
}

function relativeLuminance(rgb: { red: number; green: number; blue: number }) {
  const channels = [rgb.red, rgb.green, rgb.blue].map((channel) => channel / 255)
    .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}
