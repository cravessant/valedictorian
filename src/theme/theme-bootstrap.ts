import {
  isThemeColor,
  isThemePresetId,
  resolveTheme,
  themeColorRoles,
  type ResolvedTheme,
} from './theme-registry'

export const VALEDICTORIAN_THEME_ARGUMENT_PREFIX = '--valedictorian-theme='

export function serializeResolvedTheme(theme: ResolvedTheme) {
  return encodeURIComponent(JSON.stringify(theme))
}

export function readRendererThemeConfig(argv: string[]): ResolvedTheme | null {
  const encodedTheme = argv
    .find((argument) => argument.startsWith(VALEDICTORIAN_THEME_ARGUMENT_PREFIX))
    ?.slice(VALEDICTORIAN_THEME_ARGUMENT_PREFIX.length)

  if (!encodedTheme) {
    return null
  }

  try {
    const value = JSON.parse(decodeURIComponent(encodedTheme)) as unknown
    return normalizeResolvedTheme(value)
  } catch {
    return null
  }
}

function normalizeResolvedTheme(value: unknown): ResolvedTheme | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Partial<ResolvedTheme>

  if (!isThemePresetId(candidate.presetId) || !candidate.palette || typeof candidate.palette !== 'object') {
    return null
  }

  const palette = candidate.palette as Partial<ResolvedTheme['palette']>

  for (const role of themeColorRoles) {
    if (!isThemeColor(palette[role])) {
      return null
    }
  }

  const fallback = resolveTheme({ presetId: candidate.presetId, overrides: {} })

  return {
    ...fallback,
    palette: palette as ResolvedTheme['palette'],
    colorScheme: candidate.colorScheme === 'light' || candidate.colorScheme === 'dark'
      ? candidate.colorScheme
      : fallback.colorScheme,
    firstPaintBackground: isThemeColor(candidate.firstPaintBackground)
      ? candidate.firstPaintBackground
      : fallback.firstPaintBackground,
    titleBarBackground: isThemeColor(candidate.titleBarBackground)
      ? candidate.titleBarBackground
      : fallback.titleBarBackground,
    titleBarSymbolColor: isThemeColor(candidate.titleBarSymbolColor)
      ? candidate.titleBarSymbolColor
      : fallback.titleBarSymbolColor,
    radius: typeof candidate.radius === 'string' ? candidate.radius : fallback.radius,
  }
}
