import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const maintainedCodePathPattern = /\.(?:[cm]?[jt]s|[jt]sx)$/

/** @typedef {{ path: string, source: string }} PolicyFile */

const concreteAdapterModuleSpecifier =
  '[^\'"]*(?:profile\\.sqlite\\.(?:sensitive-)?store|secret\\.sqlite\\.store)'

const concreteAdapterModuleImportPattern = new RegExp(
  [
    String.raw`(?:^|[;\n])\s*import\s+(?:type\s+)?(?:[^'"\n]+from\s+)?['"]${concreteAdapterModuleSpecifier}['"]`,
    String.raw`(?:^|[;\n])\s*export\s+(?:type\s+)?(?:\*|\{\s*[^}]*\})\s+from\s+['"]${concreteAdapterModuleSpecifier}['"]`,
    String.raw`(?:^|[;\n=(\s])import\s*\(\s*['"]${concreteAdapterModuleSpecifier}['"]\s*\)`,
  ].join('|'),
)

const concreteAdapterFactoryImportPattern =
  /(?:^|[;\n])\s*(?:import|export)\s+(?:type\s+)?\{[^}]*\bcreateSqlite(?:Profile|SensitiveProfile|Secret)Store\b[^}]*\}\s+from\s+['"][^'"]+['"]/

/**
 * @param {string} filePath
 * @returns {string | null}
 */
function subjectAdapterModuleBasename(filePath) {
  const normalized = filePath.replaceAll('\\', '/')
  const match = normalized.match(
    /(?:^|\/)((?:profile\.sqlite\.(?:sensitive-)?store|secret\.sqlite\.store))\.test\.(?:[cm]?[jt]s|[jt]sx)$/,
  )
  return match?.[1] ?? null
}

/**
 * @param {string} filePath
 * @param {string} source
 * @returns {boolean}
 */
function importsOnlySubjectAdapter(filePath, source) {
  const subject = subjectAdapterModuleBasename(filePath)
  if (!subject) return false

  const importSpecifierPattern = new RegExp(
    String.raw`['"]([^'"]*(?:profile\.sqlite\.(?:sensitive-)?store|secret\.sqlite\.store))['"]`,
    'g',
  )
  /** @type {string[]} */
  const importedModules = []
  for (const match of source.matchAll(importSpecifierPattern)) {
    const specifier = match[1] ?? ''
    importedModules.push(specifier.split('/').pop() ?? '')
  }

  if (importedModules.length === 0) {
    return !concreteAdapterFactoryImportPattern.test(source)
  }

  return importedModules.every((moduleName) => moduleName === subject)
}

/**
 * @param {string} filePath
 * @param {string} source
 * @returns {boolean}
 */
function isApprovedImporter(filePath, source) {
  const normalized = filePath.replaceAll('\\', '/')
  if (
    normalized === 'src/modules/profile/profile.composition.ts' ||
    normalized === 'src/modules/secrets/secret.composition.ts'
  ) {
    return true
  }

  if (subjectAdapterModuleBasename(normalized)) {
    return importsOnlySubjectAdapter(normalized, source)
  }

  return false
}

/**
 * @param {string[]} args
 * @returns {string[]}
 */
function listGitFiles(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isPolicyFile(filePath) {
  return maintainedCodePathPattern.test(filePath)
}

/** @returns {PolicyFile[]} */
export function readWorkingTreePolicyFiles() {
  return listGitFiles(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .filter(isPolicyFile)
    .flatMap((filePath) => {
      const absolutePath = path.resolve(filePath)
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return []
      return [{ path: filePath, source: fs.readFileSync(absolutePath, 'utf8') }]
    })
}

/** @returns {PolicyFile[]} */
export function readStagedPolicyFiles() {
  return listGitFiles(['ls-files', '--cached', '-z'])
    .filter(isPolicyFile)
    .map((filePath) => ({
      path: filePath,
      source: execFileSync('git', ['show', `:${filePath}`], { encoding: 'utf8' }),
    }))
}

/**
 * @param {PolicyFile[]} files
 * @returns {string[]}
 */
export function findProfileSecretImportPolicyViolations(files) {
  return files.flatMap((file) => {
    const normalized = file.path.replaceAll('\\', '/')
    if (!normalized.startsWith('src/') && !normalized.startsWith('electron/')) return []
    if (isApprovedImporter(normalized, file.source)) return []
    if (
      !concreteAdapterModuleImportPattern.test(file.source) &&
      !concreteAdapterFactoryImportPattern.test(file.source)
    ) {
      return []
    }
    return [
      `${file.path}: concrete profile/secret SQLite adapters may only be imported from approved composition modules`,
    ]
  })
}

/** @returns {void} */
function run() {
  const files = process.argv.includes('--staged')
    ? readStagedPolicyFiles()
    : readWorkingTreePolicyFiles()
  const violations = findProfileSecretImportPolicyViolations(files)

  if (violations.length === 0) return
  for (const violation of violations) process.stderr.write(`${violation}\n`)
  process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) run()
