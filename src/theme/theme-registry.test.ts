import { describe, expect, it } from 'vitest'
import {
  getThemeContrastIssues,
  isThemeColor,
  normalizeThemeSettings,
  resolveTheme,
  themeColorRoles,
  themeDefinitions,
  themePresetIds,
} from './theme-registry'

describe('theme registry', () => {
  it('keeps the three supported presets complete and stable', () => {
    expect(themePresetIds).toEqual([
      'catppuccin-blur-mocha',
      'catppuccin-latte',
      'graphite',
    ])

    for (const presetId of themePresetIds) {
      const theme = themeDefinitions[presetId]

      expect(theme.label).toBeTruthy()
      expect(theme.swatches).toHaveLength(5)
      expect(Object.keys(theme.palette).sort()).toEqual([...themeColorRoles].sort())
    }
  })

  it('validates six- and eight-digit colors without allowing arbitrary CSS', () => {
    expect(isThemeColor('#123456')).toBe(true)
    expect(isThemeColor('#12345678')).toBe(true)
    expect(isThemeColor('#12345')).toBe(false)
    expect(isThemeColor('var(--primary)')).toBe(false)

    expect(
      normalizeThemeSettings({
        presetId: 'graphite',
        overrides: {
          primary: '#12345678',
          background: 'linear-gradient(red, blue)',
          unknown: '#ffffff',
        },
      }),
    ).toEqual({
      presetId: 'graphite',
      overrides: { primary: '#12345678' },
    })

    expect(normalizeThemeSettings({
      presetId: 'future-theme',
      overrides: { primary: '#123456' },
    })).toEqual({
      presetId: 'catppuccin-blur-mocha',
      overrides: {},
    })
  })

  it('layers overrides over a selected preset and can represent a clean reset', () => {
    const resolved = resolveTheme({
      presetId: 'catppuccin-latte',
      overrides: { primary: '#123456', selection: '#12345678' },
    })

    expect(resolved.presetId).toBe('catppuccin-latte')
    expect(resolved.palette.primary).toBe('#123456')
    expect(resolved.palette.selection).toBe('#12345678')
    expect(resolveTheme({
      presetId: 'catppuccin-latte',
      overrides: {
        bodyGradientEnd: '#11223344',
        card: '#22334455',
        foreground: '#aabbccdd',
      },
    })).toMatchObject({
      firstPaintBackground: '#112233',
      titleBarBackground: '#223344',
      titleBarSymbolColor: '#aabbcc',
    })
    expect(resolveTheme({ presetId: 'catppuccin-latte', overrides: {} }).palette.primary).toBe('#8839ef')
  })

  it('reports contrast issues for inaccessible custom pairs', () => {
    expect(getThemeContrastIssues(resolveTheme({
      presetId: 'graphite',
      overrides: {
        foreground: '#222222',
        background: '#333333',
      },
    }))).toEqual(expect.arrayContaining([
      expect.objectContaining({ foreground: 'foreground', background: 'background' }),
    ]))
  })
})
