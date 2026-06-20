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

function readElectronBuilderConfig() {
  const configText = fs.readFileSync(path.resolve('electron-builder.json5'), 'utf8')
  return JSON.parse(configText.replace(/^\s*\/\/.*\r?\n/, '')) as {
    appId?: string
    asarUnpack?: string[]
    files?: string[]
    productName?: string
    mac?: {
      entitlements?: string
      entitlementsInherit?: string
      hardenedRuntime?: boolean
      icon?: string
      identity?: string
      notarize?: boolean
    }
  }
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
    expect(fs.existsSync(path.resolve('build/icon.icns'))).toBe(true)
    expect(fs.existsSync(path.resolve('build/entitlements.mac.plist'))).toBe(true)
    expect(fs.existsSync(path.resolve('build/entitlements.mac.inherit.plist'))).toBe(true)

    expect(packageJson.dependencies?.sparxie).toBeDefined()
    expect(packageJson.bin).toBeUndefined()
    expect(fs.existsSync(path.resolve('src/cli'))).toBe(false)
    expect(fs.existsSync(path.resolve('src/agent'))).toBe(false)
  })

  it('can be installed and released as an app-only repository', () => {
    const packageJson = readPackageJson()
    const scripts = Object.values(packageJson.scripts ?? {})

    expect(packageJson.version).toMatch(/^0\.\d+\.\d+-alpha\.\d+$/)
    expect(packageJson.scripts?.['build:mac']).toContain('--publish never')
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
})
