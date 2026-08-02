import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { loadPgliteRuntimeAssets } from './pglite-runtime-assets.js'

export type PgliteClient = PGlite

export interface CreatePgliteClientOptions {
  /** Caller-owned on-disk data directory. Omit for an in-memory database. */
  dataDir?: string
}

export async function createPgliteClient(options: CreatePgliteClientOptions = {}) {
  const runtimeAssets = await loadPgliteRuntimeAssets()
  const pgliteOptions = {
    pgliteWasmModule: runtimeAssets.pgliteWasmModule,
    initdbWasmModule: runtimeAssets.initdbWasmModule,
    fsBundle: runtimeAssets.fsBundle,
  }

  if (options.dataDir) {
    fs.mkdirSync(options.dataDir, { recursive: true })
    return new PGlite(options.dataDir, pgliteOptions)
  }
  return new PGlite(pgliteOptions)
}

export {
  PGLITE_PACKAGE_NAME,
  PGLITE_PACKAGE_VERSION,
  PGLITE_RUNTIME_BINARY_ASSETS,
  PGLITE_RUNTIME_DIRECTORY_NAME,
  assertPgliteRuntimeAssetsPresent,
  clearPgliteRuntimeAssetCache,
  loadPgliteRuntimeAssets,
  resolvePackageLocalPgliteRuntimeDirectory,
  resolvePgliteRuntimeAssetPaths,
  resolvePgliteRuntimeDirectory,
} from './pglite-runtime-assets.js'
export type {
  LoadPgliteRuntimeAssetsOptions,
  PgliteRuntimeAssetPaths,
  PgliteRuntimeAssets,
  PgliteRuntimeBinaryAsset,
  ResolvePgliteRuntimeDirectoryOptions,
} from './pglite-runtime-assets.js'
