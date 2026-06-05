import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const indexCssPath = resolve(process.cwd(), 'src/index.css')

describe('theme config', () => {
  it('uses Catppuccin Blur Mocha colors as the app palette', () => {
    const indexCss = readFileSync(indexCssPath, 'utf8')

    expect(indexCss).toContain('--background: #1e1e2ed7;')
    expect(indexCss).toContain('--card: #181825cc;')
    expect(indexCss).toContain('--primary: #cba6f7;')
    expect(indexCss).toContain('--foreground: #cdd6f4;')
    expect(indexCss).toContain('.app-drag')
    expect(indexCss).toContain('-webkit-app-region: drag;')
    expect(indexCss).toContain('.app-no-drag')
    expect(indexCss).toContain('-webkit-app-region: no-drag;')
  })
})
