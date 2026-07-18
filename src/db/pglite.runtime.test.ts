import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPgliteClient, resolvePgliteMigrationsFolder } from './pglite'
import { clearPgliteRuntimeAssetCache } from './pglite-runtime-assets'

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

  it('resolves drizzle from a dist-electron-style sibling layout', () => {
    const appRoot = tempRoot('pglite-dist-electron-layout-')
    const distElectron = path.join(appRoot, 'dist-electron')
    const drizzleFolder = path.join(appRoot, 'drizzle')
    fs.mkdirSync(distElectron, { recursive: true })
    fs.mkdirSync(drizzleFolder, { recursive: true })
    fs.writeFileSync(path.join(drizzleFolder, '0000_pglite_operational_baseline.sql'), '-- fixture')

    expect(resolvePgliteMigrationsFolder(undefined, { moduleDirectory: distElectron })).toBe(
      drizzleFolder,
    )
  })
})
