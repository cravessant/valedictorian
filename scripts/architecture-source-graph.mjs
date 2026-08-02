import fs from 'node:fs'
import path from 'node:path'
import { init, parse } from 'es-module-lexer'

import { COMPUTED_SPECIFIER, readModuleSyntax } from './architecture-module-syntax.mjs'

await init

const codePathPattern = /\.(?:[cm]?[jt]s|[jt]sx)$/
const resolutionExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
const testPathPattern = /\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/
const localRuntimePackageName = '@sparxie/valedictorian-local-runtime'
const localRuntimeSourceRoot = 'packages/local-runtime/src'

/**
 * @typedef {object} ModuleRecord
 * @property {boolean} computedDynamicImport
 * @property {string | null} failure Set when the file could not be read whole.
 * @property {import('./architecture-module-syntax.mjs').ModuleSyntax} syntax
 * @property {string[]} specifiers Lexed module specifiers, in source order.
 */

/**
 * Reads a file's module record.
 *
 * `oxc-parser` normalises TypeScript and TSX down to its module declarations
 * without touching a specifier, and `es-module-lexer` is then the authoritative
 * inventory of what those declarations import and re-export. The two are
 * cross-checked: every module request the parser found must appear in the lexed
 * inventory and vice versa, so the normalisation cannot quietly lose or invent a
 * declaration. Any parse failure, lex failure, or disagreement yields no imports
 * and a failure reason, which `unlexable-module-source` turns into a hard failure.
 *
 * @param {string} source
 * @param {string} filePath
 * @returns {ModuleRecord}
 */
export function readModuleRecord(source, filePath) {
  const syntax = readModuleSyntax(source, filePath)
  if (syntax.parseFailure !== null) {
    return { computedDynamicImport: false, failure: syntax.parseFailure, specifiers: [], syntax }
  }

  /** @type {readonly import('es-module-lexer').ImportSpecifier[]} */
  let lexed
  try {
    lexed = parse(syntax.normalised, filePath)[0]
  } catch (error) {
    return {
      computedDynamicImport: false,
      failure: `normalised module text did not lex: ${/** @type {Error} */ (error).message}`,
      specifiers: [],
      syntax,
    }
  }

  const specifiers = lexed.flatMap((entry) => typeof entry.n === 'string' ? [entry.n] : [])
  const lexedLiterals = specifiers.filter((specifier) => specifier !== COMPUTED_SPECIFIER)
  const computed = specifiers.length - lexedLiterals.length
  const parsedLiterals = [...syntax.specifiers].sort()
  if (
    lexedLiterals.length !== specifiers.length - computed
    || JSON.stringify([...lexedLiterals].sort()) !== JSON.stringify(parsedLiterals)
  ) {
    return {
      computedDynamicImport: syntax.computedDynamicImport,
      failure: 'parsed and lexed module inventories disagree',
      specifiers: [],
      syntax,
    }
  }

  return {
    computedDynamicImport: syntax.computedDynamicImport,
    failure: null,
    specifiers: lexedLiterals,
    syntax,
  }
}

/**
 * @param {string} directory
 * @returns {string[]}
 */
export function listCodeFiles(directory) {
  if (!fs.existsSync(directory)) return []

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return listCodeFiles(entryPath)
    return entry.isFile() && codePathPattern.test(entry.name) ? [entryPath] : []
  }).sort()
}

/**
 * Every maintained code file under `src`. State ownership is checked across all of
 * them — there is no test, fixture, helper, or harness exemption, because a
 * filename convention is not proof that a file cannot ship.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function listMaintainedCodeFiles(root) {
  return [
    ...listCodeFiles(path.join(root, 'src')),
    ...listCodeFiles(path.join(root, localRuntimeSourceRoot)),
  ].sort()
}

/**
 * @param {string} root
 * @param {string} filePath
 * @returns {string}
 */
export function toRepositoryPath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/')
}

/**
 * A maintained test. Test source describes a scenario rather than the shipped
 * dependency direction, so the rules that model shipped structure skip it.
 *
 * @param {string} repositoryPath
 * @returns {boolean}
 */
export function isTestPath(repositoryPath) {
  return testPathPattern.test(repositoryPath)
}

/**
 * Every path a specifier could name, in the order the toolchain would try them:
 * the literal target, each extension spelling, then each index spelling. Shared so
 * one resolution model answers every rule.
 *
 * @param {string} root
 * @param {string} filePath
 * @param {string} specifier
 * @returns {string[]} Empty when the specifier names no path at all.
 */
export function resolutionCandidates(root, filePath, specifier) {
  const localRuntimeTarget = localRuntimeSourceTarget(root, specifier)
  const target = specifier.startsWith('.')
    ? path.resolve(path.dirname(filePath), specifier)
    : specifier.startsWith('@/')
      ? path.join(root, 'src', specifier.slice(2))
      : localRuntimeTarget
  if (target === null) return []

  const applicationSourceRoot = path.join(root, 'src')
  const localRuntimeAbsoluteRoot = path.join(root, localRuntimeSourceRoot)
  const targets = [
    target,
    ...(target.startsWith(`${applicationSourceRoot}${path.sep}`)
      ? [
        path.join(
          localRuntimeAbsoluteRoot,
          path.relative(applicationSourceRoot, target),
        ),
      ]
      : []),
    ...(target.startsWith(`${localRuntimeAbsoluteRoot}${path.sep}`)
      ? [
        path.join(
          applicationSourceRoot,
          path.relative(localRuntimeAbsoluteRoot, target),
        ),
      ]
      : []),
  ]

  return targets.flatMap((candidate) => [
    candidate,
    ...resolutionExtensions.map(
      (extension) => `${candidate.replace(/\.js$/, '')}${extension}`,
    ),
    ...resolutionExtensions.map((extension) => path.join(candidate, `index${extension}`)),
  ])
}

/**
 * Resolves a relative or `@/`-aliased specifier to the repository path it names,
 * mirroring the `@/* -> ./src/*` mapping in tsconfig.json.
 *
 * @param {string} root
 * @param {string} filePath
 * @param {string} specifier
 * @returns {string | null}
 */
export function resolveSpecifier(root, filePath, specifier) {
  const candidates = resolutionCandidates(root, filePath, specifier)
  if (candidates.length === 0) return null

  const resolved = candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  )
  return toRepositoryPath(root, resolved ?? /** @type {string} */ (candidates[0]))
}

/**
 * @param {string} repositoryPath
 * @returns {string | null}
 */
export function moduleOfPath(repositoryPath) {
  return /^(?:packages\/local-runtime\/)?src\/modules\/([^/]+)\//.exec(repositoryPath)?.[1] ?? null
}

/**
 * The zone a file belongs to: its capability module, or the top-level `src`
 * directory that holds it. A zone that is not a capability module never owns
 * state, so code there always needs an exact exception to reach a table.
 *
 * @param {string} repositoryPath
 * @returns {string}
 */
export function zoneOfPath(repositoryPath) {
  const moduleName = moduleOfPath(repositoryPath)
  if (moduleName) return moduleName
  const segments = repositoryPath.split('/')
  if (repositoryPath.startsWith(`${localRuntimeSourceRoot}/`)) {
    return segments.slice(0, 4).join('/')
  }
  return segments.length > 2 ? `${segments[0]}/${segments[1]}` : segments[0] ?? 'src'
}

function localRuntimeSourceTarget(root, specifier) {
  if (specifier !== localRuntimePackageName && !specifier.startsWith(`${localRuntimePackageName}/`)) {
    return null
  }

  const manifest = readManifest(root, 'packages/local-runtime/package.json')
  const exportKey = specifier === localRuntimePackageName
    ? '.'
    : `.${specifier.slice(localRuntimePackageName.length)}`
  const exported = manifest?.exports?.[exportKey]
  const emittedTarget = typeof exported === 'string' ? exported : exported?.import
  if (typeof emittedTarget !== 'string' || !emittedTarget.startsWith('./dist/')) return null

  return path.join(
    root,
    localRuntimeSourceRoot,
    emittedTarget.slice('./dist/'.length).replace(/\.js$/, ''),
  )
}

/**
 * @param {string} root
 * @param {string} manifestPath
 * @returns {unknown}
 */
export function readManifest(root, manifestPath) {
  const absolutePath = path.join(root, manifestPath)
  if (!fs.existsSync(absolutePath)) return null
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
}
