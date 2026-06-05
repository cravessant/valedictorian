import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    author?: string
    dependencies?: Record<string, string>
    description?: string
    devDependencies?: Record<string, string>
    scripts?: Record<string, string>
  }
}

function readElectronBuilderConfig() {
  const configText = fs.readFileSync(path.resolve('electron-builder.json5'), 'utf8')
  return JSON.parse(configText.replace(/^\s*\/\/.*\r?\n/, '')) as {
    appId?: string
    productName?: string
    mac?: {
      icon?: string
      identity?: null | string
    }
  }
}

describe('build configuration', () => {
  it('sets app package metadata used by Electron Builder', () => {
    const packageJson = readPackageJson()

    expect(packageJson.description).toBe('Local job application tracker and agent access app.')
    expect(packageJson.author).toBe('Keni')
  })

  it('sets Electron app identity and local unsigned build settings', () => {
    const config = readElectronBuilderConfig()

    expect(config.appId).toBe('com.jobautomation.jobapp')
    expect(config.productName).toBe('Job App')
    expect(config.mac?.identity).toBeNull()
    expect(config.mac?.icon).toBe('build/icon.icns')
    expect(fs.existsSync(path.resolve('build/icon.icns'))).toBe(true)
  })

  it('uses Electron Builder native dependency helpers without @electron/rebuild', () => {
    const packageJson = readPackageJson()

    expect(packageJson.devDependencies?.['prebuild-install']).toBeDefined()
    expect(packageJson.devDependencies?.['@electron/rebuild']).toBeUndefined()
    expect(packageJson.scripts?.dev).toContain('electron-builder install-app-deps')
    expect(packageJson.scripts?.['rebuild:native']).toBe('electron-builder install-app-deps')
  })

  it('includes headless table and virtualization dependencies', () => {
    const packageJson = readPackageJson()

    expect(packageJson.dependencies?.['@tanstack/react-table']).toBeDefined()
    expect(packageJson.dependencies?.['@tanstack/react-virtual']).toBeDefined()
  })

  it('depends on the shared SDK but does not publish the standalone CLI bin', () => {
    const packageJson = readPackageJson() as ReturnType<typeof readPackageJson> & {
      bin?: Record<string, string>
    }

    expect(packageJson.dependencies?.['job-app-sdk']).toBeDefined()
    expect(packageJson.bin).toBeUndefined()
    expect(packageJson.scripts?.cli).toBeUndefined()
  })

  it('builds the shared SDK before app commands that import package entrypoints', () => {
    const packageJson = readPackageJson()
    const buildSdk = 'pnpm -C ../job-app-sdk build'

    expect(packageJson.scripts?.dev).toContain(buildSdk)
    expect(packageJson.scripts?.build).toContain(buildSdk)
    expect(packageJson.scripts?.lint).toContain(buildSdk)
    expect(packageJson.scripts?.test).toContain(buildSdk)
  })

  it('keeps published CLI and old agent client source out of the Electron app package', () => {
    expect(fs.existsSync(path.resolve('src/cli'))).toBe(false)
    expect(fs.existsSync(path.resolve('src/agent'))).toBe(false)
  })

  it('scopes third-party Node rebuild deprecation suppression to better-sqlite3 rebuilds', () => {
    const packageJson = readPackageJson()
    const quietRebuild = 'NODE_OPTIONS=--disable-warning=DEP0176 pnpm rebuild better-sqlite3'

    expect(packageJson.scripts?.test).toContain(quietRebuild)
    expect(packageJson.scripts?.build).toContain(quietRebuild)
    expect(packageJson.scripts?.['db:migrate']).toContain(quietRebuild)
    expect(packageJson.scripts?.['rebuild:node']).toBe(quietRebuild)
  })
})
