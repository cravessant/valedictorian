import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    bin?: Record<string, string>
    dependencies?: Record<string, string>
    scripts?: Record<string, string>
    version?: string
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
  it('keeps the Electron app packaged separately from the standalone CLI', () => {
    const packageJson = readPackageJson()
    const config = readElectronBuilderConfig()

    expect(config.appId).toBe('com.jobautomation.jobapp')
    expect(config.productName).toBe('Job App')
    expect(config.mac?.identity).toBeNull()
    expect(config.mac?.icon).toBe('build/icon.icns')
    expect(fs.existsSync(path.resolve('build/icon.icns'))).toBe(true)

    expect(packageJson.dependencies?.sparxie).toBeDefined()
    expect(packageJson.bin).toBeUndefined()
    expect(fs.existsSync(path.resolve('src/cli'))).toBe(false)
    expect(fs.existsSync(path.resolve('src/agent'))).toBe(false)
  })

  it('can be installed and released as an app-only repository', () => {
    const packageJson = readPackageJson()
    const scripts = Object.values(packageJson.scripts ?? {})

    expect(packageJson.version).toMatch(/^0\.\d+\.\d+-alpha\.\d+$/)
    expect(packageJson.dependencies?.sparxie).toBe('0.1.1')
    expect(scripts).not.toEqual(expect.arrayContaining([expect.stringContaining('../sparxie')]))
    expect(fs.existsSync(path.resolve('pnpm-lock.yaml'))).toBe(true)

    const pnpmWorkspaceConfig = fs.readFileSync(path.resolve('pnpm-workspace.yaml'), 'utf8')
    expect(pnpmWorkspaceConfig).toContain('minimumReleaseAgeExclude:')
    expect(pnpmWorkspaceConfig).toContain('- sparxie')
  })
})
