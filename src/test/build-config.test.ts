import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    bin?: Record<string, string>
    dependencies?: Record<string, string>
    name?: string
    scripts?: Record<string, string>
    version?: string
  }
}

function readReadme() {
  return fs.readFileSync(path.resolve('README.md'), 'utf8')
}

function readElectronBuilderConfig() {
  const configText = fs.readFileSync(path.resolve('electron-builder.json5'), 'utf8')
  return JSON.parse(configText.replace(/^\s*\/\/.*\r?\n/, '')) as {
    appId?: string
    asarUnpack?: string[]
    detectUpdateChannel?: boolean
    files?: string[]
    productName?: string
    mac?: {
      entitlements?: string
      entitlementsInherit?: string
      hardenedRuntime?: boolean
      icon?: string
      identity?: string
      notarize?: boolean
      target?: string[]
    }
    publish?: Array<{
      provider?: string
      url?: string
    }>
  }
}

function readViteConfig() {
  return fs.readFileSync(path.resolve('vite.config.ts'), 'utf8')
}

describe('build configuration', () => {
  it('keeps the Electron app packaged separately from the standalone CLI', () => {
    const packageJson = readPackageJson()
    const config = readElectronBuilderConfig()

    expect(packageJson.name).toBe('valedictorian-app')
    expect(config.appId).toBe('com.valedictorian.app')
    expect(config.productName).toBe('Valedictorian')
    expect(config.mac?.identity).toBe('Developer ID Application')
    expect(config.mac?.hardenedRuntime).toBe(true)
    expect(config.mac?.notarize).toBe(true)
    expect(config.mac?.entitlements).toBe('build/entitlements.mac.plist')
    expect(config.mac?.entitlementsInherit).toBe('build/entitlements.mac.inherit.plist')
    expect(config.mac?.icon).toBe('build/icon.icns')
    expect(config.mac?.target).toEqual(['dmg', 'zip'])
    expect(fs.existsSync(path.resolve('build/icon.icns'))).toBe(true)
    expect(fs.existsSync(path.resolve('build/entitlements.mac.plist'))).toBe(true)
    expect(fs.existsSync(path.resolve('build/entitlements.mac.inherit.plist'))).toBe(true)

    expect(packageJson.dependencies?.sparxie).toBeDefined()
    expect(packageJson.dependencies?.cosmiconfig).toBe('9.0.2')
    expect(packageJson.dependencies).not.toHaveProperty('conf')
    expect(packageJson.dependencies).not.toHaveProperty('configstore')
    expect(packageJson.bin).toBeUndefined()
    expect(fs.existsSync(path.resolve('src/cli'))).toBe(false)
    expect(fs.existsSync(path.resolve('src/agent'))).toBe(false)
  })

  it('can be installed and released as an app-only repository', () => {
    const packageJson = readPackageJson()
    const config = readElectronBuilderConfig()
    const scripts = Object.values(packageJson.scripts ?? {})

    expect(packageJson.version).toMatch(/^0\.\d+\.\d+-alpha\.\d+$/)
    expect(packageJson.scripts?.['build:mac']).toContain('--publish never')
    expect(packageJson.scripts?.['build:mac']).not.toContain('--mac dmg')
    expect(packageJson.scripts?.['build:mac:release']).toBeUndefined()
    expect(packageJson.dependencies?.['electron-updater']).toBeDefined()
    expect(config.detectUpdateChannel).toBe(false)
    expect(config.publish).toEqual([
      {
        provider: 'generic',
        url: 'https://updates.valedictorian.app/mac/alpha',
      },
    ])
    expect(packageJson.dependencies?.sparxie).toMatch(/^\d+\.\d+\.\d+$/)
    expect(packageJson.dependencies?.sparxie).not.toContain('github:')
    expect(packageJson.dependencies?.sparxie).not.toContain('../sparxie')
    expect(scripts).not.toEqual(expect.arrayContaining([expect.stringContaining('../sparxie')]))
    expect(fs.existsSync(path.resolve('pnpm-lock.yaml'))).toBe(true)

    const pnpmWorkspaceConfig = fs.readFileSync(path.resolve('pnpm-workspace.yaml'), 'utf8')
    expect(pnpmWorkspaceConfig).toContain('minimumReleaseAgeExclude:')
    expect(pnpmWorkspaceConfig).toContain('- sparxie')
    expect(pnpmWorkspaceConfig).toContain('sparxie: true')
  })

  it('packages native SQLite runtime helpers for the signed Mac app', () => {
    const packageJson = readPackageJson()
    const config = readElectronBuilderConfig()

    expect(packageJson.dependencies).toMatchObject({
      'better-sqlite3': expect.any(String),
      bindings: expect.any(String),
      'file-uri-to-path': expect.any(String),
    })
    expect(config.files).toEqual(
      expect.arrayContaining([
        'drizzle/**/*',
        'dist',
        'dist-electron',
        'node_modules/better-sqlite3/**/*',
        'node_modules/bindings/**/*',
        'node_modules/file-uri-to-path/**/*',
      ]),
    )
    expect(config.asarUnpack).toEqual(
      expect.arrayContaining(['**/node_modules/better-sqlite3/**']),
    )
  })

  it('keeps Electron main runtime-probed packages out of the Vite bundle', () => {
    const viteConfig = readViteConfig()

    expect(viteConfig).toContain("export const nativeMainExternals = ['better-sqlite3', 'undici']")
  })

  it('documents project config discovery separately from app-owned workspace state', () => {
    const readme = readReadme()

    expect(readme).toContain('## Project config discovery')
    expect(readme).toContain('valedictorian.config.json')
    expect(readme).toContain('<workspace>/.valedictorian/manifest.json')
    expect(readme).toContain('Do not store API tokens, OAuth tokens, passwords, or client secrets in project config.')
  })
})
