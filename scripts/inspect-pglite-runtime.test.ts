import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPackage, listPackage } from '@electron/asar'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PGLITE_RUNTIME_BINARY_ASSETS,
  PGLITE_RUNTIME_DIRECTORY_NAME,
  inspectPgliteRuntimeArtifactLayout,
  inspectPgliteRuntimeAssets,
  inspectPgliteRuntimeBuilderConfig,
  inspectPgliteProjectFiles,
} from './inspect-pglite-runtime.mjs'
import {
  PGLITE_RUNTIME_BINARY_ASSETS as sourceBinaryAssets,
  PGLITE_RUNTIME_DIRECTORY_NAME as sourceDirectoryName,
} from '../src/db/pglite-runtime-assets'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function tempRoot(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

function stageCompleteArtifact(root: string) {
  const runtimeDirectory = path.join(root, PGLITE_RUNTIME_DIRECTORY_NAME)
  fs.mkdirSync(runtimeDirectory, { recursive: true })
  for (const asset of PGLITE_RUNTIME_BINARY_ASSETS) {
    fs.writeFileSync(path.join(runtimeDirectory, asset), `fixture:${asset}`)
  }
  const packageDist = path.join(root, 'node_modules', '@electric-sql', 'pglite', 'dist')
  fs.mkdirSync(packageDist, { recursive: true })
  fs.writeFileSync(path.join(packageDist, 'index.js'), 'export {}\n')
}

describe('inspect-pglite-runtime', () => {
  it('keeps script contract constants aligned with the runtime loader', () => {
    expect([...PGLITE_RUNTIME_BINARY_ASSETS]).toEqual([...sourceBinaryAssets])
    expect(PGLITE_RUNTIME_DIRECTORY_NAME).toBe(sourceDirectoryName)
  })

  it('accepts a staged packaged layout with runtime binaries and PGlite JS', () => {
    const root = tempRoot('pglite-artifact-ok-')
    stageCompleteArtifact(root)
    expect(inspectPgliteRuntimeArtifactLayout(root)).toEqual([])
  })

  it('fails when required runtime binaries are missing', () => {
    const root = tempRoot('pglite-artifact-missing-')
    const runtimeDirectory = path.join(root, PGLITE_RUNTIME_DIRECTORY_NAME)
    fs.mkdirSync(runtimeDirectory, { recursive: true })
    fs.writeFileSync(path.join(runtimeDirectory, 'pglite.wasm'), 'wasm')
    const packageDist = path.join(root, 'node_modules', '@electric-sql', 'pglite', 'dist')
    fs.mkdirSync(packageDist, { recursive: true })
    fs.writeFileSync(path.join(packageDist, 'index.js'), 'export {}\n')

    expect(inspectPgliteRuntimeArtifactLayout(root)).toEqual([
      `missing ${PGLITE_RUNTIME_DIRECTORY_NAME}/initdb.wasm`,
      `missing ${PGLITE_RUNTIME_DIRECTORY_NAME}/pglite.data`,
    ])
  })

  it('fails when PGlite JavaScript is absent from package and dist-electron layouts', () => {
    const root = tempRoot('pglite-artifact-no-js-')
    const runtimeDirectory = path.join(root, PGLITE_RUNTIME_DIRECTORY_NAME)
    fs.mkdirSync(runtimeDirectory, { recursive: true })
    for (const asset of PGLITE_RUNTIME_BINARY_ASSETS) {
      fs.writeFileSync(path.join(runtimeDirectory, asset), `fixture:${asset}`)
    }

    expect(inspectPgliteRuntimeArtifactLayout(root)).toEqual([
      'missing PGlite JavaScript contract (expected @electric-sql/pglite package files)',
    ])
  })

  it('inspects the actual Electron resources layout and app.asar JavaScript contract', async () => {
    const sourceRoot = tempRoot('pglite-asar-source-')
    const resourcesRoot = tempRoot('pglite-packaged-resources-')
    const runtimeDirectory = path.join(resourcesRoot, PGLITE_RUNTIME_DIRECTORY_NAME)
    const packageDist = path.join(sourceRoot, 'node_modules', '@electric-sql', 'pglite', 'dist')
    fs.mkdirSync(runtimeDirectory, { recursive: true })
    fs.mkdirSync(packageDist, { recursive: true })
    fs.mkdirSync(path.join(sourceRoot, 'dist-electron'), { recursive: true })
    for (const asset of PGLITE_RUNTIME_BINARY_ASSETS) {
      fs.writeFileSync(path.join(runtimeDirectory, asset), `fixture:${asset}`)
    }
    fs.writeFileSync(path.join(packageDist, 'index.js'), 'export {}\n')
    fs.writeFileSync(path.join(sourceRoot, 'dist-electron', 'main.js'), 'export {}\n')
    await createPackage(sourceRoot, path.join(resourcesRoot, 'app.asar'))

    expect(inspectPgliteRuntimeArtifactLayout(resourcesRoot)).toEqual([])
  })

  // The artifact check normalizes listPackage output by hand, so a change in the
  // separator or leading-slash convention would silently stop matching entries.
  it('reads archive entries as root-anchored native paths', async () => {
    const sourceRoot = tempRoot('pglite-asar-entries-')
    const archiveRoot = tempRoot('pglite-asar-archive-')
    const packageDist = path.join(sourceRoot, 'node_modules', '@electric-sql', 'pglite', 'dist')
    fs.mkdirSync(packageDist, { recursive: true })
    fs.writeFileSync(path.join(packageDist, 'index.js'), 'export {}\n')
    const archivePath = path.join(archiveRoot, 'app.asar')
    await createPackage(sourceRoot, archivePath)

    const entries = listPackage(archivePath, { isPack: false })

    expect(entries.every((entry) => entry.startsWith(path.sep))).toBe(true)
    expect(entries.map((entry) => entry.replace(/^[/\\]/, '').replaceAll('\\', '/'))).toContain(
      'node_modules/@electric-sql/pglite/dist/index.js',
    )
  })

  it('reports an incomplete PGlite builder configuration', () => {
    expect(
      inspectPgliteRuntimeBuilderConfig({
        files: ['drizzle/**/*', 'dist', 'dist-electron'],
        extraResources: [],
      }),
    ).toEqual(
      expect.arrayContaining([
        'electron-builder files must include node_modules/@electric-sql/pglite/**/*',
        `electron-builder extraResources must copy assets to ${PGLITE_RUNTIME_DIRECTORY_NAME}`,
      ]),
    )
  })

  it('accepts the repository package, lockfile, and Electron runtime contracts', () => {
    expect(inspectPgliteProjectFiles()).toEqual([])
    expect(inspectPgliteRuntimeAssets()).toEqual([])
  })
})
