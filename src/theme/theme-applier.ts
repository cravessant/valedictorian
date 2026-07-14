import {
  themeColorRoles,
  type ResolvedTheme,
  type ThemeColorRole,
} from './theme-registry'

const cssVariableByRole: Record<ThemeColorRole, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  cardForeground: '--card-foreground',
  popover: '--popover',
  popoverForeground: '--popover-foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  secondary: '--secondary',
  secondaryForeground: '--secondary-foreground',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  destructive: '--destructive',
  border: '--border',
  input: '--input',
  ring: '--ring',
  success: '--success',
  warning: '--warning',
  bodyGradientStart: '--body-gradient-start',
  bodyGradientEnd: '--body-gradient-end',
  selection: '--selection',
  formControlIcon: '--form-control-icon',
}

export interface ThemeRootLike {
  dataset: DOMStringMap
  style: CSSStyleDeclaration
  removeAttribute: (name: string) => void
  setAttribute: (name: string, value: string) => void
}

export function applyResolvedTheme(theme: ResolvedTheme, root: ThemeRootLike = document.documentElement) {
  root.dataset.theme = theme.presetId

  for (const role of themeColorRoles) {
    root.style.setProperty(cssVariableByRole[role], theme.palette[role])
  }

  root.style.setProperty('--color-scheme', theme.colorScheme)
  root.style.setProperty('--radius', theme.radius)
  root.style.setProperty('--title-bar-background', theme.titleBarBackground)
  root.style.setProperty('--title-bar-symbol-color', theme.titleBarSymbolColor)
  root.setAttribute('data-theme-ready', 'true')
}

export function clearAppliedTheme(root: ThemeRootLike = document.documentElement) {
  root.removeAttribute('data-theme-ready')
  root.removeAttribute('data-theme')

  for (const role of themeColorRoles) {
    root.style.removeProperty(cssVariableByRole[role])
  }

  root.style.removeProperty('--color-scheme')
  root.style.removeProperty('--radius')
  root.style.removeProperty('--title-bar-background')
  root.style.removeProperty('--title-bar-symbol-color')
}

export { cssVariableByRole }
