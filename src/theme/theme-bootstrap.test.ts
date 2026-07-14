import { describe, expect, it } from 'vitest'
import { readRendererThemeConfig, serializeResolvedTheme } from './theme-bootstrap'
import { resolveTheme } from './theme-registry'

describe('theme bootstrap arguments', () => {
  it('round-trips a resolved workspace theme through renderer arguments', () => {
    const theme = resolveTheme({
      presetId: 'graphite',
      overrides: { primary: '#12345678' },
    })

    expect(readRendererThemeConfig([
      `--valedictorian-theme=${serializeResolvedTheme(theme)}`,
    ])).toEqual(theme)
  })

  it('ignores absent or malformed theme arguments', () => {
    expect(readRendererThemeConfig([])).toBeNull()
    expect(readRendererThemeConfig(['--valedictorian-theme=not-json'])).toBeNull()
    expect(readRendererThemeConfig([
      '--valedictorian-theme=%7B%22presetId%22%3A%22graphite%22%7D',
    ])).toBeNull()
  })
})
