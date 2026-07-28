import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const maintainedCodePathPattern = /\.(?:[cm]?[jt]s|[jt]sx)$/

/** @typedef {{ path: string, source: string }} PolicyFile */

const concreteAdapterBasenamePattern =
  /(?:^|\/)(secret\.pglite\.store|app-secret\.store|profile\.json\.(?:store|document|atomic|lock|watch|paths))(?:\.[cm]?[jt]sx?)?$/

const secretOrAppSecretBasenamePattern =
  /(?:^|\/)(secret\.pglite\.store|app-secret\.store)(?:\.[cm]?[jt]sx?)?$/

const concreteAdapterFactoryImportPattern =
  /(?:^|[;\n])\s*(?:import|export)\s+(?:type\s+)?\{[^}]*\b(?:createPgliteSecretStore|createFileAppSecretStore|createJsonProfileStore)\b[^}]*\}\s+from\s+['"][^'"]+['"]/s

const secretAdapterSubjectPattern =
  /(?:^|\/)((?:secret\.pglite\.store|app-secret\.store))\.test\.(?:[cm]?[jt]s|[jt]sx)$/

const jsonSubjectPattern =
  /(?:^|\/)((?:profile\.json\.(?:store|document|atomic|lock|watch|paths)))\.test\.(?:[cm]?[jt]s|[jt]sx)$/

const jsonConcreteModulePattern =
  /(?:^|\/)profile\.json\.(?:store|document|atomic|lock|watch|paths)\.(?:[cm]?[jt]s|[jt]sx)$/

/**
 * @param {string} filePath
 * @returns {string | null}
 */
function subjectAdapterModuleBasename(filePath) {
  const normalized = filePath.replaceAll('\\', '/')
  const secretMatch = normalized.match(secretAdapterSubjectPattern)
  if (secretMatch?.[1]) return secretMatch[1]
  const jsonMatch = normalized.match(jsonSubjectPattern)
  return jsonMatch?.[1] ?? null
}

/**
 * Extract static/dynamic import and re-export module specifiers, including
 * Prettier-style multiline import forms and optional .js extensions.
 * @param {string} source
 * @returns {string[]}
 */
function extractModuleSpecifiers(source) {
  /** @type {string[]} */
  const specifiers = []
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?(?:\*|\{\s*[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.push(match[1])
    }
  }
  return specifiers
}

/**
 * @param {string} specifier
 * @returns {string}
 */
function moduleBasename(specifier) {
  const withoutQuery = specifier.split('?')[0] ?? specifier
  return withoutQuery.split('/').pop() ?? ''
}

/**
 * @param {string} specifier
 * @returns {boolean}
 */
function isConcreteAdapterSpecifier(specifier) {
  return concreteAdapterBasenamePattern.test(moduleBasename(specifier))
}

/**
 * @param {string} specifier
 * @returns {boolean}
 */
function isSecretOrAppSecretSpecifier(specifier) {
  return secretOrAppSecretBasenamePattern.test(moduleBasename(specifier))
}

/**
 * @param {string} filePath
 * @param {string} source
 * @returns {boolean}
 */
function importsOnlySubjectAdapter(filePath, source) {
  const subject = subjectAdapterModuleBasename(filePath)
  if (!subject) return false

  const importedModules = extractModuleSpecifiers(source)
    .filter(isConcreteAdapterSpecifier)
    .map(moduleBasename)
    .map((name) => name.replace(/\.[cm]?[jt]sx?$/, ''))

  if (importedModules.length === 0) {
    return !concreteAdapterFactoryImportPattern.test(source)
  }

  if (subject.startsWith('profile.json.')) {
    return importedModules.every(
      (moduleName) =>
        moduleName === subject || moduleName.startsWith('profile.json.'),
    )
  }

  return importedModules.every((moduleName) => moduleName === subject)
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function importsSecretOrAppSecretConcrete(source) {
  if (extractModuleSpecifiers(source).some(isSecretOrAppSecretSpecifier)) return true
  return /(?:^|[;\n])\s*(?:import|export)\s+(?:type\s+)?\{[^}]*\b(?:createPgliteSecretStore|createFileAppSecretStore)\b[^}]*\}\s+from\s+['"][^'"]+['"]/s.test(
    source,
  )
}

/**
 * JSON concrete modules may import sibling JSON helpers/ports, but never concrete
 * workspace-secret or application-secret adapters.
 * @param {string} source
 * @returns {boolean}
 */
function jsonConcreteModuleImportsAreAllowed(source) {
  return !importsSecretOrAppSecretConcrete(source)
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
    normalized === 'src/modules/profile/profile.composition.test.ts' ||
    normalized === 'src/modules/secrets/secret.composition.ts' ||
    normalized === 'src/settings/app-secret.composition.ts'
  ) {
    return true
  }

  if (jsonConcreteModulePattern.test(normalized)) {
    return jsonConcreteModuleImportsAreAllowed(source)
  }

  if (subjectAdapterModuleBasename(normalized)) {
    return importsOnlySubjectAdapter(normalized, source)
  }

  return false
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function importsConcreteAdapter(source) {
  if (extractModuleSpecifiers(source).some(isConcreteAdapterSpecifier)) return true
  return concreteAdapterFactoryImportPattern.test(source)
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

/**
 * Paths the commit adds or modifies. `-z` keeps unusual filenames intact, and
 * excluding deletions drops paths that are no longer readable from the index.
 * @returns {string[]}
 */
export function listStagedPolicyPaths() {
  return listGitFiles([
    'diff',
    '--cached',
    '--name-only',
    '--diff-filter=d',
    '-z',
  ]).filter(isPolicyFile)
}

/**
 * @param {string} filePath
 * @returns {PolicyFile[]}
 */
function readIndexPolicyFile(filePath) {
  const result = spawnSync('git', ['show', `:${filePath}`], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) return []
  return [{ path: filePath, source: result.stdout }]
}

/**
 * Reads staged content for the commit's own paths only. This policy is
 * per-file, so reading the whole index would cost one subprocess per tracked
 * file on every commit without inspecting anything new.
 * @returns {PolicyFile[]}
 */
export function readStagedPolicyFiles() {
  return listStagedPolicyPaths().flatMap(readIndexPolicyFile)
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
    if (!importsConcreteAdapter(file.source)) return []
    return [
      `${file.path}: concrete profile/secret adapters may only be imported from approved composition modules`,
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
