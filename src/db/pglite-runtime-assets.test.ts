import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PGLITE_RUNTIME_BINARY_ASSETS,
  PGLITE_RUNTIME_DIRECTORY_NAME,
  clearPgliteRuntimeAssetCache,
  loadPgliteRuntimeAssets,
  resolvePackageLocalPgliteRuntimeDirectory,
  resolvePgliteRuntimeAssetPaths,
  resolvePgliteRuntimeDirectory,
} from './pglite-runtime-assets'

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

function stageRuntimeAssets(directory: string, assets = PGLITE_RUNTIME_BINARY_ASSETS) {
  fs.mkdirSync(directory, { recursive: true })
  for (const asset of assets) {
    fs.writeFileSync(path.join(directory, asset), `fixture:${asset}`)
  }
}

describe('PGlite runtime asset locator', () => {
  it('resolves package-local @electric-sql/pglite 0.5.4 dist assets without network URLs', () => {
    const directory = resolvePackageLocalPgliteRuntimeDirectory()
    const paths = resolvePgliteRuntimeAssetPaths(directory)

    expect(directory.replaceAll('\\', '/')).toMatch(
      /@electric-sql\/pglite\/dist$|@electric-sql\+pglite@0\.5\.4\/.*\/dist$/,
    )
    expect(fs.existsSync(path.join(directory, '..', 'package.json'))).toBe(true)
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(directory, '..', 'package.json'), 'utf8'),
    ) as { name: string; version: string }
    expect(packageJson).toMatchObject({
      name: '@electric-sql/pglite',
      version: '0.5.4',
    })

    for (const asset of PGLITE_RUNTIME_BINARY_ASSETS) {
      expect(fs.existsSync(paths[asset])).toBe(true)
      expect(paths[asset]).toBe(path.join(directory, asset))
    }

    expect(directory).not.toMatch(/https?:\/\//)
    expect(Object.values(paths).join('\n')).not.toMatch(/cdn|jsdelivr|unpkg|http/i)
  })

  it('prefers process.resourcesPath/pglite-runtime when the packaged layout is present', () => {
    const resourcesPath = tempRoot('pglite-resources-')
    const packagedDirectory = path.join(resourcesPath, PGLITE_RUNTIME_DIRECTORY_NAME)
    stageRuntimeAssets(packagedDirectory)

    const directory = resolvePgliteRuntimeDirectory({ resourcesPath })
    expect(directory).toBe(packagedDirectory)
    expect(resolvePgliteRuntimeAssetPaths(directory)).toEqual({
      'pglite.wasm': path.join(packagedDirectory, 'pglite.wasm'),
      'initdb.wasm': path.join(packagedDirectory, 'initdb.wasm'),
      'pglite.data': path.join(packagedDirectory, 'pglite.data'),
    })
  })

  it('falls back to package-local assets when packaged resources are absent', () => {
    const resourcesPath = tempRoot('pglite-empty-resources-')
    const directory = resolvePgliteRuntimeDirectory({ resourcesPath })
    expect(directory).toBe(resolvePackageLocalPgliteRuntimeDirectory())
  })

  it('rejects a packaged layout that is missing required binary assets', () => {
    const resourcesPath = tempRoot('pglite-incomplete-')
    const packagedDirectory = path.join(resourcesPath, PGLITE_RUNTIME_DIRECTORY_NAME)
    stageRuntimeAssets(packagedDirectory, ['pglite.wasm', 'initdb.wasm'])

    expect(() => resolvePgliteRuntimeDirectory({ resourcesPath })).toThrow(
      /missing required PGlite runtime asset/i,
    )
  })

  it('loads wasm modules and fsBundle from local files and caches the result', async () => {
    const first = await loadPgliteRuntimeAssets()
    const second = await loadPgliteRuntimeAssets()

    expect(first.pgliteWasmModule).toBeInstanceOf(WebAssembly.Module)
    expect(first.initdbWasmModule).toBeInstanceOf(WebAssembly.Module)
    expect(first.fsBundle).toBeInstanceOf(Blob)
    expect(first.fsBundle.size).toBeGreaterThan(0)
    expect(second).toBe(first)
    expect(second.pgliteWasmModule).toBe(first.pgliteWasmModule)
  })

  it('fails clearly when an overridden runtime directory is missing assets', async () => {
    const emptyDirectory = tempRoot('pglite-missing-assets-')

    await expect(loadPgliteRuntimeAssets({ runtimeDirectory: emptyDirectory })).rejects.toThrow(
      /missing required PGlite runtime asset/i,
    )
  })
})
