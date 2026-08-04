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
    asar?: boolean
    asarUnpack?: string[]
    detectUpdateChannel?: boolean
    extraResources?: Array<{
      filter?: string[]
      from?: string
      to?: string
    }>
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
      artifactName?: string
    }
    nsis?: {
      allowToChangeInstallationDirectory?: boolean
      deleteAppDataOnUninstall?: boolean
      oneClick?: boolean
      perMachine?: boolean
    }
    publish?: Array<{
      provider?: string
      url?: string
    }>
    win?: {
      target?: Array<{
        arch?: string[]
        target?: string
      }>
      artifactName?: string
    }
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
    // Published update metadata and the release workflow both key off these names.
    expect(config.asar).toBe(true)
    expect(config.mac?.artifactName).toBe('${productName}-Mac-${version}-Installer.${ext}')
    expect(config.win?.artifactName).toBe('${productName}-Windows-${version}-Setup.${ext}')
    expect(fs.existsSync(path.resolve('build/icon.icns'))).toBe(true)
    expect(fs.existsSync(path.resolve('build/entitlements.mac.plist'))).toBe(true)
    expect(fs.existsSync(path.resolve('build/entitlements.mac.inherit.plist'))).toBe(true)

    expect(packageJson.dependencies?.['@sparxie/sdk']).toBeDefined()
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
    expect(packageJson.scripts?.['prebuild:mac']).toBe('pnpm run build:local-runtime-package')
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
    expect(packageJson.dependencies?.['@sparxie/sdk']).toMatch(/^\d+\.\d+\.\d+$/)
    expect(packageJson.dependencies?.['@sparxie/sdk']).not.toContain('github:')
    expect(packageJson.dependencies?.['@sparxie/sdk']).not.toContain('../sparxie')
    expect(scripts).not.toEqual(expect.arrayContaining([expect.stringContaining('../sparxie')]))
    expect(fs.existsSync(path.resolve('pnpm-lock.yaml'))).toBe(true)

    const pnpmWorkspaceConfig = fs.readFileSync(path.resolve('pnpm-workspace.yaml'), 'utf8')
    expect(pnpmWorkspaceConfig).toContain('minimumReleaseAgeExclude:')
    expect(pnpmWorkspaceConfig).toContain("- '@sparxie/*'")
    expect(pnpmWorkspaceConfig).not.toContain('- sparxie')
  })

  it('enforces peer compatibility through the lint quality entrypoint', () => {
    const packageJson = readPackageJson()

    expect(packageJson.scripts?.['peers:check']).toBe('pnpm peers check')
    expect(packageJson.scripts?.lint).toContain('pnpm run peers:check')
  })

  it('packages the current PGlite runtime contract', () => {
    const packageJson = readPackageJson()
    const config = readElectronBuilderConfig()

    expect(packageJson.dependencies?.['@electric-sql/pglite']).toBe('0.5.4')
    expect(config.files).toEqual(
      expect.arrayContaining([
        'dist',
        'dist-electron',
        'node_modules/@electric-sql/pglite/**/*',
        '!node_modules/@sparxie/valedictorian-connectors-core/src{,/**/*}',
        '!node_modules/@sparxie/valedictorian-connectors-core/tsconfig.build.json',
        '!node_modules/@sparxie/valedictorian-local-runtime/node_modules{,/**/*}',
      ]),
    )
    expect(config.files?.join('\n')).not.toMatch(/better-sqlite3|bindings|file-uri-to-path/)
    expect(config.extraResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'node_modules/@electric-sql/pglite/dist',
          to: 'pglite-runtime',
          filter: expect.arrayContaining(['pglite.wasm', 'initdb.wasm', 'pglite.data']),
        }),
        expect.objectContaining({
          from: 'packages/local-runtime/drizzle',
          to: 'drizzle',
        }),
      ]),
    )
    expect(config.mac?.hardenedRuntime).toBe(true)
    expect(config.mac?.notarize).toBe(true)
    expect(config.win?.target).toEqual([{ target: 'nsis', arch: ['x64'] }])
    expect(config.nsis).toMatchObject({
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      deleteAppDataOnUninstall: false,
    })
    expect(packageJson.scripts?.['smoke:pglite-package']).toBe(
      'node scripts/run-packaged-pglite-smoke.mjs',
    )
  })

  it('runs packaged PGlite restart smoke verification on macOS and Windows CI', () => {
    const ciWorkflow = fs.readFileSync(path.resolve('.github/workflows/ci.yml'), 'utf8')
    const releaseWorkflow = fs.readFileSync(path.resolve('.github/workflows/release-mac.yml'), 'utf8')

    expect(ciWorkflow).toContain('package-smoke:')
    expect(ciWorkflow.slice(ciWorkflow.indexOf('package-smoke:'))).not.toContain('needs: test')
    expect(ciWorkflow).toContain('blacksmith-6vcpu-macos-latest')
    expect(ciWorkflow).toContain('blacksmith-2vcpu-windows-2025')
    expect(ciWorkflow).toContain('pnpm exec electron-builder --win --publish never')
    expect(ciWorkflow).not.toContain('electron-builder --win --dir')
    expect(ciWorkflow).toContain('Verify Windows installer')
    expect(ciWorkflow).toContain('pnpm run smoke:pglite-package')
    expect(releaseWorkflow).toContain('pnpm run smoke:pglite-package')
  })

  it('keeps Electron main runtime-probed packages out of the Vite bundle', () => {
    const viteConfig = readViteConfig()
    const testSetup = fs.readFileSync(path.resolve('src/test/setup.ts'), 'utf8')
    const pgliteHarness = fs.readFileSync(
      path.resolve('src/runtime/local-valedictorian-client.test-harness.ts'),
      'utf8',
    )
    const serverPgliteHarness = fs.readFileSync(
      path.resolve('src/server/local-valedictorian-client.test-harness.ts'),
      'utf8',
    )
    const normalizedPgliteHarness = pgliteHarness.replace(/\s+/g, ' ')

    expect(viteConfig).toContain("globalSetup: './src/test/global-setup.ts'")
    expect(viteConfig).toContain('maxWorkers: 2')
    expect(viteConfig).toContain('minWorkers: process.env.CI ? 2 : 1')
    expect(viteConfig).toContain("pool: 'threads'")
    expect(viteConfig).toContain('sequencer: DurationBalancedSequencer')
    const sequencer = fs.readFileSync(
      path.resolve('src/test/duration-balanced-sequencer.ts'),
      'utf8',
    )
    expect(sequencer).toContain('override async sort(')
    expect(sequencer).toContain('sortAssignedShardFilesByDescendingWeight')
    expect(sequencer).toContain('sortWorkspaceSpecsByDescendingWeight')
    expect(sequencer).toContain('assignWorkspaceSpecsToDurationBalancedShards')
    expect(sequencer).toMatch(
      /override async sort\(files: TestSpecification\[]\) \{\n\s+return sortWorkspaceSpecsByDescendingWeight/,
    )
    expect(sequencer).toMatch(
      /override async shard\(files: TestSpecification\[]\) \{[\s\S]*?assignWorkspaceSpecsToDurationBalancedShards/,
    )
    const sortWorkspaceFn = sequencer.match(
      /export function sortWorkspaceSpecsByDescendingWeight\([\s\S]*?\n\}/,
    )?.[0]
    expect(sortWorkspaceFn).toBeTruthy()
    expect(sortWorkspaceFn).not.toContain('new Map')
    expect(sortWorkspaceFn).toContain('left.index - right.index')
    const assignWorkspaceFn = sequencer.match(
      /export function assignWorkspaceSpecsToDurationBalancedShards\([\s\S]*?\n\}/,
    )?.[0]
    expect(assignWorkspaceFn).toBeTruthy()
    expect(assignWorkspaceFn).not.toMatch(/new Map\(\s*files\.map/)
    expect(assignWorkspaceFn).toContain('left.index - right.index')
    expect(normalizedPgliteHarness).toContain(
      'clonedFromTemplate ? createPgliteDatabase(pglite) : await migratePgliteDatabase(pglite)',
    )
    expect(
      normalizedPgliteHarness.match(
        /const clonedFromTemplate = prepareConfiguredPgliteDataPath\(pgliteDataPath\)/g,
      ),
    ).toHaveLength(2)
    expect(normalizedPgliteHarness).toContain(
      'if (!dataDir) activeTempPaths.add(pgliteDataPath) const clonedFromTemplate = prepareConfiguredPgliteDataPath(pgliteDataPath)',
    )
    expect(serverPgliteHarness).toContain('prepareConfiguredPgliteDataPath')
    expect(viteConfig).toContain('testTimeout: process.env.CI ? 30_000 : 5_000')
    expect(testSetup).toContain(
      'configure({ asyncUtilTimeout: process.env.CI ? 15_000 : 1_000 })',
    )
    expect(testSetup).toContain("if (typeof document !== 'undefined')")
    expect(testSetup).toContain("await import('@testing-library/jest-dom/vitest')")
    expect(testSetup).toContain("await import('@testing-library/react')")
    expect(testSetup).not.toMatch(/^import .*@testing-library/m)
    expect(testSetup).toContain('export {}')
    expect(viteConfig).toContain(
      "export const mainExternals = ['@electric-sql/pglite', 'undici']",
    )
    expect(viteConfig).not.toContain('better-sqlite3')
  })

  it('documents project config discovery separately from app-owned workspace state', () => {
    const readme = readReadme()

    expect(readme).toContain('## Project config discovery')
    expect(readme).toContain('valedictorian.config.json')
    expect(readme).toContain('<workspace>/.valedictorian/manifest.json')
    expect(readme).toContain('Do not store API tokens, OAuth tokens, passwords, or client secrets in project config.')
  })
})
