import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const PGLITE_RUNTIME_DIRECTORY_NAME = 'pglite-runtime'
export const PGLITE_PACKAGE_NAME = '@electric-sql/pglite'
export const PGLITE_RUNTIME_BINARY_ASSETS = Object.freeze([
  'pglite.wasm',
  'initdb.wasm',
  'pglite.data',
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
  const hasExternalizedPackage = packageEntryCandidates.some((candidate) => fs.existsSync(candidate))
  const distElectronDirectory = path.join(root, 'dist-electron')
  const hasBundledMain =
    fs.existsSync(distElectronDirectory) &&
    fs.readdirSync(distElectronDirectory).some((entry) => entry.endsWith('.js'))

  if (!hasExternalizedPackage && !hasBundledMain) {
    problems.push(
      `missing PGlite JavaScript contract (expected ${PGLITE_PACKAGE_NAME} package files or dist-electron/*.js)`,
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

  return problems
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
  const problems = inspectPgliteRuntimeBuilderConfig(readElectronBuilderConfigFile(configPath))

  if (options.artifactRoot) {
    problems.push(...inspectPgliteRuntimeArtifactLayout(path.resolve(options.artifactRoot)))
  }

  return problems
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
    process.stdout.write('PGlite runtime asset contract OK\n')
    return
  }

  for (const problem of problems) process.stderr.write(`${problem}\n`)
  process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) run()
