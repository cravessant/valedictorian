import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { listPackage } from '@electron/asar'

export const PGLITE_RUNTIME_DIRECTORY_NAME = 'pglite-runtime'
export const PGLITE_PACKAGE_NAME = '@electric-sql/pglite'
export const PGLITE_REQUIRED_VERSION = '0.5.4'
export const PGLITE_RUNTIME_BINARY_ASSETS = Object.freeze([
  'pglite.wasm',
  'initdb.wasm',
  'pglite.data',
])
export const PGLITE_MIGRATIONS_DIRECTORY_NAME = 'drizzle'
export const PGLITE_BASELINE_NAME = '0000_pglite_operational_baseline.sql'

const OTHER_DATABASE_ENGINE_PACKAGES = Object.freeze([
  '@sqlite.org/sqlite-wasm',
  'better-sqlite3',
  'sql.js',
  'sqlite3',
])

/**
 * @typedef {{
 *   asarUnpack?: string[]
 *   extraResources?: Array<{ filter?: string[]; from?: string; to?: string }>
 *   files?: string[]
 * }} ElectronBuilderConfig
 */

/**
 * @param {string} root
 * @returns {string[]}
 */
export function inspectPgliteRuntimeArtifactLayout(root) {
  /** @type {string[]} */
  const problems = []
  const runtimeDirectory = path.join(root, PGLITE_RUNTIME_DIRECTORY_NAME)

  if (!fs.existsSync(runtimeDirectory)) {
    problems.push(`missing ${PGLITE_RUNTIME_DIRECTORY_NAME}/ directory`)
  } else {
    for (const asset of PGLITE_RUNTIME_BINARY_ASSETS) {
      const assetPath = path.join(runtimeDirectory, asset)
      if (!fs.existsSync(assetPath)) {
        problems.push(`missing ${PGLITE_RUNTIME_DIRECTORY_NAME}/${asset}`)
      }
    }
  }

  const packageEntryCandidates = [
    path.join(root, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js'),
    path.join(root, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.cjs'),
  ]
  let hasExternalizedPackage = packageEntryCandidates.some((candidate) => fs.existsSync(candidate))
  const asarPath = path.join(root, 'app.asar')
  if (!hasExternalizedPackage && fs.existsSync(asarPath)) {
    const entries = listPackage(asarPath, { isPack: false })
      .map((entry) => entry.replace(/^[/\\]/, '').replaceAll('\\', '/'))
    hasExternalizedPackage = entries.includes('node_modules/@electric-sql/pglite/dist/index.js')
      || entries.includes('node_modules/@electric-sql/pglite/dist/index.cjs')
  }

  if (!hasExternalizedPackage) {
    problems.push(
      `missing PGlite JavaScript contract (expected ${PGLITE_PACKAGE_NAME} package files)`,
    )
  }

  if (!fs.existsSync(path.join(root, PGLITE_MIGRATIONS_DIRECTORY_NAME, PGLITE_BASELINE_NAME))) {
    problems.push(
      `missing ${PGLITE_MIGRATIONS_DIRECTORY_NAME}/${PGLITE_BASELINE_NAME}`,
    )
  }

  return problems
}

/**
 * @param {ElectronBuilderConfig} config
 * @returns {string[]}
 */
export function inspectPgliteRuntimeBuilderConfig(config) {
  /** @type {string[]} */
  const problems = []
  const files = config.files ?? []
  const asarUnpack = config.asarUnpack ?? []
  const filesText = files.join('\n')
  const asarText = asarUnpack.join('\n')

  if (!files.includes('node_modules/@electric-sql/pglite/**/*')) {
    problems.push('electron-builder files must include node_modules/@electric-sql/pglite/**/*')
  }
  if (/better-sqlite3|bindings|file-uri-to-path/.test(filesText)) {
    problems.push('electron-builder files must not include better-sqlite3/native helper packages')
  }
  if (/better-sqlite3/.test(asarText)) {
    problems.push('electron-builder asarUnpack must not include better-sqlite3')
  }

  const runtimeResource = (config.extraResources ?? []).find(
    (entry) => entry.to === PGLITE_RUNTIME_DIRECTORY_NAME,
  )
  if (!runtimeResource) {
    problems.push(`electron-builder extraResources must copy assets to ${PGLITE_RUNTIME_DIRECTORY_NAME}`)
  } else {
    if (runtimeResource.from !== 'node_modules/@electric-sql/pglite/dist') {
      problems.push('electron-builder extraResources.from must target @electric-sql/pglite/dist')
    }
    for (const asset of PGLITE_RUNTIME_BINARY_ASSETS) {
      if (!(runtimeResource.filter ?? []).includes(asset)) {
        problems.push(`electron-builder extraResources.filter must include ${asset}`)
      }
    }
  }

  const migrationsResource = (config.extraResources ?? []).find(
    (entry) => entry.to === PGLITE_MIGRATIONS_DIRECTORY_NAME,
  )
  if (!migrationsResource) {
    problems.push(
      `electron-builder extraResources must copy migrations to ${PGLITE_MIGRATIONS_DIRECTORY_NAME}`,
    )
  } else if (migrationsResource.from !== 'packages/local-runtime/drizzle') {
    problems.push(
      'electron-builder migration resources must come from packages/local-runtime/drizzle',
    )
  }

  return problems
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {string} lockfile
 * @returns {string[]}
 */
export function inspectPgliteProjectState(manifest, lockfile) {
  /** @type {string[]} */
  const problems = []
  const dependencies = manifest.dependencies
  const runtimeDependencies = isRecord(dependencies) ? dependencies : {}

  if (runtimeDependencies[PGLITE_PACKAGE_NAME] !== PGLITE_REQUIRED_VERSION) {
    problems.push(
      `${PGLITE_PACKAGE_NAME} must be pinned exactly to ${PGLITE_REQUIRED_VERSION}`,
    )
  }

  const dependencySections = [
    runtimeDependencies,
    isRecord(manifest.devDependencies) ? manifest.devDependencies : {},
    isRecord(manifest.optionalDependencies) ? manifest.optionalDependencies : {},
  ]
  const declaredPackages = new Set(dependencySections.flatMap((section) => Object.keys(section)))
  for (const packageName of OTHER_DATABASE_ENGINE_PACKAGES) {
    if (declaredPackages.has(packageName) || lockfileResolvesPackage(lockfile, packageName)) {
      problems.push(`second database engine package is not allowed: ${packageName}`)
    }
  }

  const resolvedPgliteVersions = lockfileResolvedVersions(lockfile, PGLITE_PACKAGE_NAME)
  if (
    resolvedPgliteVersions.length !== 1
    || resolvedPgliteVersions[0] !== PGLITE_REQUIRED_VERSION
  ) {
    problems.push(
      `pnpm lockfile must resolve only ${PGLITE_PACKAGE_NAME}@${PGLITE_REQUIRED_VERSION}`,
    )
  }

  return problems
}

/**
 * @param {{ lockfilePath?: string, manifestPath?: string }} [options]
 * @returns {string[]}
 */
export function inspectPgliteProjectFiles(options = {}) {
  const manifestPath = path.resolve(options.manifestPath ?? 'package.json')
  const lockfilePath = path.resolve(options.lockfilePath ?? 'pnpm-lock.yaml')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const lockfile = fs.readFileSync(lockfilePath, 'utf8')
  return inspectPgliteProjectState(manifest, lockfile)
}

/**
 * @param {string} configPath
 * @returns {ElectronBuilderConfig}
 */
export function readElectronBuilderConfigFile(configPath) {
  const configText = fs.readFileSync(configPath, 'utf8')
  return JSON.parse(configText.replace(/^\s*\/\/.*\r?\n/, ''))
}

/**
 * @param {{ artifactRoot?: string, configPath?: string }} [options]
 * @returns {string[]}
 */
export function inspectPgliteRuntimeAssets(options = {}) {
  const configPath = path.resolve(options.configPath ?? 'electron-builder.json5')
  const projectRoot = path.dirname(configPath)
  const problems = inspectPgliteProjectFiles({
    manifestPath: path.join(projectRoot, 'package.json'),
    lockfilePath: path.join(projectRoot, 'pnpm-lock.yaml'),
  })
  problems.push(...inspectPgliteRuntimeBuilderConfig(readElectronBuilderConfigFile(configPath)))

  if (options.artifactRoot) {
    problems.push(...inspectPgliteRuntimeArtifactLayout(path.resolve(options.artifactRoot)))
  }

  return problems
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function lockfileResolvedVersions(lockfile, packageName) {
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const packages = lockfile.match(/\npackages:\n([\s\S]*?)(?:\nsnapshots:\n|$)/)?.[1] ?? ''
  const pattern = new RegExp(`^  ['"]?${escapedName}@([^'":]+)['"]?:`, 'gm')
  return [...packages.matchAll(pattern)]
    .map((match) => match[1])
    .sort((left, right) => left.localeCompare(right))
}

function lockfileResolvesPackage(lockfile, packageName) {
  return lockfileResolvedVersions(lockfile, packageName).length > 0
}

/** @returns {void} */
function run() {
  const args = process.argv.slice(2)
  const artifactRootIndex = args.indexOf('--artifact-root')
  const artifactRoot =
    artifactRootIndex >= 0 ? args[artifactRootIndex + 1] : undefined
  const configPathIndex = args.indexOf('--config')
  const configPath = configPathIndex >= 0 ? args[configPathIndex + 1] : undefined

  if (artifactRootIndex >= 0 && !artifactRoot) {
    process.stderr.write('Missing value for --artifact-root\n')
    process.exitCode = 1
    return
  }

  const problems = inspectPgliteRuntimeAssets({ artifactRoot, configPath })
  if (problems.length === 0) {
    process.stdout.write('PGlite runtime contract OK\n')
    return
  }

  for (const problem of problems) process.stderr.write(`${problem}\n`)
  process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) run()
