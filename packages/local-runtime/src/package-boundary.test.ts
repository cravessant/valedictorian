import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface LocalRuntimeArchitecture {
  decision: {
    issue: string
    status?: string
  }
  package: {
    independentlyBuildable: boolean
    name: string
    path: string
    private: boolean
  }
  ownedSource: string[]
  ownedBackendRoots: string[]
  ownedRuntimeComposition: string[]
  ownedMigrationAssets: string
  retainedApplicationOwnership: string[]
  constraints: {
    forbiddenPackageImports: string[]
    normalExportSurfacesAreExplicit: boolean
    safeStorageBoundary: string
    safeStorageOwnership: string
    schemaAndMigrationOwnership: string
    testingExportSurfacesAreExplicit: boolean
  }
}

const sourceRoot = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.dirname(sourceRoot)
const repositoryRoot = path.resolve(packageRoot, '../..')
const manifest = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
) as Record<string, any>
const architecture = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'architecture/local-runtime-package.json'), 'utf8'),
) as LocalRuntimeArchitecture

function sourceModuleSpecifiers(source: string) {
  return [
    ...source.matchAll(
      /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    ),
  ].flatMap((match) => match[1] ? [match[1]] : [])
}

function listTypeScriptFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return listTypeScriptFiles(entryPath)
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : []
  })
}

describe('@sparxie/valedictorian-local-runtime boundary', () => {
  it('declares the private independently buildable package identity', () => {
    expect(manifest.name).toBe(architecture.package.name)
    expect(manifest.private).toBe(architecture.package.private)
    expect(architecture.package.independentlyBuildable).toBe(true)
    expect(architecture.package.path).toBe('packages/local-runtime')
    expect(manifest.dependencies).toEqual(expect.objectContaining({
      '@electric-sql/pglite': '0.5.4',
    }))
    const exportKeys = Object.keys(manifest.exports)
    expect(exportKeys.filter((key) => !key.startsWith('./testing/')).sort()).toEqual([
      '.',
      './capture',
      './capture-edge-contract',
      './company',
      './connector-edge-contract',
      './connectors',
      './database',
      './http-server',
      './isolated-validation',
      './job',
      './job-edge-contract',
      './lifecycle',
      './local-client',
      './migration-recovery',
      './pglite',
      './policy',
      './profile',
      './profile-files',
      './protected-secrets',
      './runtime',
      './runtime-settings',
      './scheduling',
      './secrets',
      './workspace-files',
      './workspace-runtime',
    ])
    expect(exportKeys).not.toContain('./backend/*')
    expect(exportKeys.every((key) => !key.includes('*'))).toBe(true)
    expect(architecture.constraints.normalExportSurfacesAreExplicit).toBe(true)
  })

  it('enumerates every testing export without exposing a catch-all', () => {
    const testingEntries = Object.entries(
      manifest.exports as Record<string, { import: string, types: string }>,
    )
      .filter(([key]) => key.startsWith('./testing/'))

    expect(testingEntries.length).toBeGreaterThan(100)
    expect(architecture.constraints.testingExportSurfacesAreExplicit).toBe(true)
    for (const [key, value] of testingEntries) {
      expect(key).not.toContain('*')
      expect(value).toEqual({
        import: expect.stringMatching(/^\.\/dist\/.+\.js$/),
        types: expect.stringMatching(/^\.\/dist\/.+\.d\.ts$/),
      })
      const sourcePath = value.import
        .replace(/^\.\/dist\//, '')
        .replace(/\.js$/, '.ts')
      expect(fs.existsSync(path.join(sourceRoot, sourcePath)), key).toBe(true)
    }
  })

  it('owns the declared backend closure without importing application code', () => {
    for (const relativePath of architecture.ownedSource) {
      expect(fs.existsSync(path.join(sourceRoot, relativePath)), relativePath).toBe(true)
    }

    for (const ownedRoot of architecture.ownedBackendRoots) {
      expect(fs.existsSync(path.join(packageRoot, ownedRoot)), ownedRoot).toBe(true)
    }
    for (const ownedRuntime of architecture.ownedRuntimeComposition) {
      expect(fs.existsSync(path.join(packageRoot, ownedRuntime)), ownedRuntime).toBe(true)
    }
    for (const retainedPath of architecture.retainedApplicationOwnership) {
      expect(fs.existsSync(path.join(repositoryRoot, retainedPath)), retainedPath).toBe(true)
    }

    const packageSources = listTypeScriptFiles(sourceRoot)
    expect(packageSources.length).toBeGreaterThan(200)
    for (const filePath of packageSources) {
      const source = fs.readFileSync(filePath, 'utf8')
      for (const specifier of sourceModuleSpecifiers(source)) {
        if (specifier.startsWith('.')) {
          const relativeTarget = path.relative(
            sourceRoot,
            path.resolve(path.dirname(filePath), specifier),
          )
          expect(
            relativeTarget !== '..' && !relativeTarget.startsWith(`..${path.sep}`),
            `${path.relative(sourceRoot, filePath)} imports outside the package`,
          ).toBe(true)
        }
        expect(specifier, `${path.relative(sourceRoot, filePath)} back-imports app source`)
          .not.toMatch(/^(?:@\/|src(?:\/|$))/)
        expect(specifier, `${path.relative(sourceRoot, filePath)} self-imports a package export`)
          .not.toMatch(/^@sparxie\/valedictorian-local-runtime(?:\/|$)/)
        expect(specifier, `${path.relative(sourceRoot, filePath)} imports Electron`).not.toMatch(
          /(?:^|\/)electron(?:\/|$)/i,
        )
      }
    }
  })

  it('owns schema migrations while Electron safeStorage remains injected', () => {
    expect('status' in architecture.decision).toBe(false)
    expect(architecture.constraints.forbiddenPackageImports).toEqual(['@/', 'src', 'electron'])
    expect(architecture.constraints.schemaAndMigrationOwnership).toBe('local-runtime-package')
    expect(architecture.constraints.safeStorageBoundary).toBe('injected-secret-codec-port')
    expect(architecture.constraints.safeStorageOwnership).toBe('electron/profile-secret-codec.ts')
    expect(architecture.ownedMigrationAssets).toBe('drizzle')
    expect(fs.existsSync(path.join(packageRoot, architecture.ownedMigrationAssets, '0000_pglite_operational_baseline.sql'))).toBe(true)
    expect(fs.existsSync(path.join(repositoryRoot, 'electron/profile-secret-codec.ts'))).toBe(true)
  })
})
