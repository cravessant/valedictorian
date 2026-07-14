import { beforeEach, describe, expect, it } from 'vitest'
import { applyResolvedTheme, clearAppliedTheme, cssVariableByRole } from './theme-applier'
import { resolveTheme, themeColorRoles } from './theme-registry'

describe('theme applier', () => {
  beforeEach(() => {
    clearAppliedTheme()
  })

  it('writes every semantic role and native decoration variable to the root', () => {
    const theme = resolveTheme({ presetId: 'catppuccin-latte', overrides: {} })

    applyResolvedTheme(theme)

    expect(document.documentElement.dataset.theme).toBe('catppuccin-latte')
    expect(document.documentElement).toHaveAttribute('data-theme-ready', 'true')
    for (const role of themeColorRoles) {
      expect(document.documentElement.style.getPropertyValue(cssVariableByRole[role])).toBe(theme.palette[role])
    }
    expect(document.documentElement.style.getPropertyValue('--color-scheme')).toBe('light')
  })

  it('clears previously applied theme values', () => {
    applyResolvedTheme(resolveTheme({ presetId: 'graphite', overrides: {} }))
    clearAppliedTheme()

    expect(document.documentElement).not.toHaveAttribute('data-theme-ready')
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('')
  })
})
