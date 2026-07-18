import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

export const PGLITE_PACKAGE_NAME = '@electric-sql/pglite'
export const PGLITE_PACKAGE_VERSION = '0.5.4'
export const PGLITE_RUNTIME_DIRECTORY_NAME = 'pglite-runtime'

export const PGLITE_RUNTIME_BINARY_ASSETS = [
  'pglite.wasm',
  'initdb.wasm',
  'pglite.data',
] as const

export type PgliteRuntimeBinaryAsset = (typeof PGLITE_RUNTIME_BINARY_ASSETS)[number]

export type PgliteRuntimeAssetPaths = Record<PgliteRuntimeBinaryAsset, string>

export interface PgliteRuntimeAssets {
  pgliteWasmModule: WebAssembly.Module
  initdbWasmModule: WebAssembly.Module
  fsBundle: Blob
}

export interface ResolvePgliteRuntimeDirectoryOptions {
  resourcesPath?: string
  runtimeDirectory?: string
}

export interface LoadPgliteRuntimeAssetsOptions extends ResolvePgliteRuntimeDirectoryOptions {}

const require = createRequire(import.meta.url)

let cachedAssets: PgliteRuntimeAssets | undefined
let cachedAssetsPromise: Promise<PgliteRuntimeAssets> | undefined

export function resolvePackageLocalPgliteRuntimeDirectory() {
  const entryPath = require.resolve(PGLITE_PACKAGE_NAME)
  return path.dirname(entryPath)
}

export function resolvePgliteRuntimeAssetPaths(runtimeDirectory: string): PgliteRuntimeAssetPaths {
  return {
    'pglite.wasm': path.join(runtimeDirectory, 'pglite.wasm'),
    'initdb.wasm': path.join(runtimeDirectory, 'initdb.wasm'),
    'pglite.data': path.join(runtimeDirectory, 'pglite.data'),
  }
}

export function assertPgliteRuntimeAssetsPresent(runtimeDirectory: string) {
  const paths = resolvePgliteRuntimeAssetPaths(runtimeDirectory)
  const missing = PGLITE_RUNTIME_BINARY_ASSETS.filter((asset) => !fs.existsSync(paths[asset]))
  if (missing.length === 0) return paths

  throw new Error(
    `Missing required PGlite runtime asset(s): ${missing.join(', ')} under ${path.basename(runtimeDirectory)}`,
  )
}

function packagedRuntimeDirectory(resourcesPath: string) {
  return path.join(resourcesPath, PGLITE_RUNTIME_DIRECTORY_NAME)
}

export function resolvePgliteRuntimeDirectory(
  options: ResolvePgliteRuntimeDirectoryOptions = {},
) {
  if (options.runtimeDirectory) {
    assertPgliteRuntimeAssetsPresent(options.runtimeDirectory)
    return options.runtimeDirectory
  }

  const resourcesPath = options.resourcesPath ?? readProcessResourcesPath()
  if (resourcesPath) {
    const packagedDirectory = packagedRuntimeDirectory(resourcesPath)
    if (fs.existsSync(packagedDirectory)) {
      assertPgliteRuntimeAssetsPresent(packagedDirectory)
      return packagedDirectory
    }
  }

  return resolvePackageLocalPgliteRuntimeDirectory()
}

function readProcessResourcesPath() {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  return typeof resourcesPath === 'string' && resourcesPath.length > 0 ? resourcesPath : undefined
}

export async function loadPgliteRuntimeAssets(
  options: LoadPgliteRuntimeAssetsOptions = {},
): Promise<PgliteRuntimeAssets> {
  if (options.runtimeDirectory || options.resourcesPath) {
    return loadPgliteRuntimeAssetsFromDirectory(resolvePgliteRuntimeDirectory(options))
  }

  if (cachedAssets) return cachedAssets
  if (cachedAssetsPromise) return cachedAssetsPromise

  cachedAssetsPromise = loadPgliteRuntimeAssetsFromDirectory(resolvePgliteRuntimeDirectory())
    .then((assets) => {
      cachedAssets = assets
      return assets
    })
    .catch((error) => {
      cachedAssetsPromise = undefined
      throw error
    })

  return cachedAssetsPromise
}

async function loadPgliteRuntimeAssetsFromDirectory(runtimeDirectory: string) {
  const paths = assertPgliteRuntimeAssetsPresent(runtimeDirectory)
  const [pgliteWasmModule, initdbWasmModule, dataBytes] = await Promise.all([
    WebAssembly.compile(fs.readFileSync(paths['pglite.wasm'])),
    WebAssembly.compile(fs.readFileSync(paths['initdb.wasm'])),
    Promise.resolve(fs.readFileSync(paths['pglite.data'])),
  ])

  return {
    pgliteWasmModule,
    initdbWasmModule,
    fsBundle: new Blob([dataBytes]),
  }
}

export function clearPgliteRuntimeAssetCache() {
  cachedAssets = undefined
  cachedAssetsPromise = undefined
}
