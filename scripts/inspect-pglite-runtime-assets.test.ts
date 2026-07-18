import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PGLITE_RUNTIME_BINARY_ASSETS,
  PGLITE_RUNTIME_DIRECTORY_NAME,
  inspectPgliteRuntimeArtifactLayout,
  inspectPgliteRuntimeAssets,
  inspectPgliteRuntimeBuilderConfig,
} from './inspect-pglite-runtime-assets.mjs'
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

describe('inspect-pglite-runtime-assets', () => {
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
    fs.mkdirSync(path.join(root, 'dist-electron'), { recursive: true })
    fs.writeFileSync(path.join(root, 'dist-electron', 'main.js'), 'export {}\n')

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
      'missing PGlite JavaScript contract (expected @electric-sql/pglite package files or dist-electron/*.js)',
    ])
  })

  it('rejects builder config that still ships better-sqlite3 packaging rules', () => {
    expect(
      inspectPgliteRuntimeBuilderConfig({
        files: [
          'drizzle/**/*',
          'dist',
          'dist-electron',
          'node_modules/better-sqlite3/**/*',
        ],
        asarUnpack: ['**/node_modules/better-sqlite3/**'],
        extraResources: [],
      }),
    ).toEqual(
      expect.arrayContaining([
        'electron-builder files must include node_modules/@electric-sql/pglite/**/*',
        'electron-builder files must not include better-sqlite3/native helper packages',
        'electron-builder asarUnpack must not include better-sqlite3',
        `electron-builder extraResources must copy assets to ${PGLITE_RUNTIME_DIRECTORY_NAME}`,
      ]),
    )
  })

  it('accepts the repository electron-builder and package-local asset contracts', () => {
    expect(inspectPgliteRuntimeAssets()).toEqual([])
  })
})
