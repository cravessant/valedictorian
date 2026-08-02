import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearPgliteRuntimeAssetCache } from '@sparxie/valedictorian-local-runtime/pglite'
import { createPgliteClient, resolvePgliteMigrationsFolder } from '@sparxie/valedictorian-local-runtime/database'
import { resolveElectronPgliteMigrationsFolder } from '../../electron/pglite-migrations'

const tempRoots: string[] = []

afterEach(() => {
  clearPgliteRuntimeAssetCache()
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function tempRoot(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

describe('PGlite client construction with packaged runtime assets', () => {
  it('initializes using explicitly loaded local runtime assets', async () => {
    const client = await createPgliteClient()
    try {
      const result = await client.query<{ n: number }>('select 1::int as n')
      expect(result.rows[0]?.n).toBe(1)
    } finally {
      await client.close()
    }
  })

  it('resolves the repository drizzle folder from the src/db layout', () => {
    const folder = resolvePgliteMigrationsFolder()
    expect(fs.existsSync(path.join(folder, '0000_pglite_operational_baseline.sql'))).toBe(true)
    expect(folder.replaceAll('\\', '/')).toMatch(/\/drizzle$/)
  })

  it('resolves package-owned migrations for an unpackaged main bundle', () => {
    const appRoot = tempRoot('pglite-dist-electron-layout-')
    const distElectron = path.join(appRoot, 'dist-electron')
    const drizzleFolder = path.join(appRoot, 'packages/local-runtime/drizzle')
    fs.mkdirSync(distElectron, { recursive: true })
    fs.mkdirSync(drizzleFolder, { recursive: true })
    fs.writeFileSync(path.join(drizzleFolder, '0000_pglite_operational_baseline.sql'), '-- fixture')

    expect(fs.existsSync(path.join(appRoot, 'drizzle'))).toBe(false)
    const injectedFolder = resolveElectronPgliteMigrationsFolder({
      appPath: appRoot,
      isPackaged: false,
      resourcesPath: path.join(appRoot, 'ignored-resources'),
    })
    expect(resolvePgliteMigrationsFolder(injectedFolder, { moduleDirectory: distElectron })).toBe(
      drizzleFolder,
    )
  })

  it('ignores an empty dist-electron sibling instead of masking missing migrations', () => {
    const appRoot = tempRoot('pglite-empty-sibling-layout-')
    const distElectron = path.join(appRoot, 'dist-electron')
    fs.mkdirSync(distElectron, { recursive: true })
    fs.mkdirSync(path.join(appRoot, 'drizzle'), { recursive: true })

    expect(() => resolvePgliteMigrationsFolder(undefined, {
      moduleDirectory: distElectron,
      resourcesPath: path.join(appRoot, 'missing-resources'),
    })).toThrow('Unable to resolve the bundled PGlite migrations folder')
  })

  it('resolves packaged migrations from Electron resources', () => {
    const resourcesRoot = tempRoot('pglite-resources-layout-')
    const drizzleFolder = path.join(resourcesRoot, 'drizzle')
    fs.mkdirSync(drizzleFolder, { recursive: true })
    fs.writeFileSync(path.join(drizzleFolder, '0000_pglite_operational_baseline.sql'), '-- fixture')

    expect(resolvePgliteMigrationsFolder(undefined, { resourcesPath: resourcesRoot })).toBe(
      drizzleFolder,
    )
    expect(resolveElectronPgliteMigrationsFolder({
      appPath: path.join(resourcesRoot, 'app.asar'),
      isPackaged: true,
      resourcesPath: resourcesRoot,
    })).toBe(drizzleFolder)
  })
})
