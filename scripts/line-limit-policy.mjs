import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const commentPattern = /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g
const maxLinesDisablePattern = /\b(?:eslint|oxlint)-disable(?:-line|-next-line)?\b[^\r\n]*\b(?:eslint\/)?max-lines\b/
const rootConfigPath = '.oxlintrc.json'
const lintConfigPathPattern =
  /(?:^|\/)(?:\.oxlintrc(?:\.(?:json|jsonc|js|cjs|mjs|ts|cts|mts))?|eslint\.config\.(?:js|cjs|mjs|ts|cts|mts))$/
const maintainedCodePathPattern = /\.(?:[cm]?[jt]s|[jt]sx)$/

/** @typedef {{ path: string, source: string }} PolicyFile */

/** @type {ReadonlySet<string>} */
export const generatedCodePaths = new Set()

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
  return maintainedCodePathPattern.test(filePath) || lintConfigPathPattern.test(filePath)
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
 * @param {unknown} value
 * @param {string} key
 * @returns {number}
 */
function countKeys(value, key) {
  if (Array.isArray(value)) {
    return value.reduce((count, entry) => count + countKeys(entry, key), 0)
  }
  if (value === null || typeof value !== 'object') return 0

  return Object.entries(value).reduce(
    (count, [entryKey, entryValue]) =>
      count + (entryKey === key ? 1 : 0) + countKeys(entryValue, key),
    0,
  )
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasRequiredGlobalRule(source) {
  try {
    const config = JSON.parse(source)
    const rule = config.rules?.['max-lines']

    return (
      countKeys(config, 'max-lines') === 1 &&
      Array.isArray(rule) &&
      rule.length === 2 &&
      rule[0] === 'error' &&
      typeof rule[1] === 'object' &&
      rule[1] !== null &&
      rule[1].max === 1000 &&
      rule[1].skipBlankLines === true &&
      rule[1].skipComments === true
    )
  } catch {
    return false
  }
}

/**
 * @param {PolicyFile[]} files
 * @param {ReadonlySet<string>} generatedPaths
 * @returns {string[]}
 */
export function findLineLimitPolicyViolations(files, generatedPaths = generatedCodePaths) {
  return files.flatMap((file) => {
    if (generatedPaths.has(file.path)) return []

    if (file.path === rootConfigPath && !hasRequiredGlobalRule(file.source)) {
      return [
        `${rootConfigPath}: max-lines must be one global 1,000-line rule without overrides`,
      ]
    }

    if (
      file.path !== rootConfigPath &&
      lintConfigPathPattern.test(file.path) &&
      /(?:eslint\/)?max-lines/.test(file.source)
    ) {
      return [`${file.path}: nested max-lines configuration is forbidden`]
    }

    const comments = file.source.match(commentPattern) ?? []
    if (!comments.some((comment) => maxLinesDisablePattern.test(comment))) return []

    return [`${file.path}: max-lines disable directives are forbidden in maintained code`]
  })
}

/**
 * @param {PolicyFile[]} files
 * @param {ReadonlySet<string>} generatedPaths
 * @returns {string[]}
 */
export function findRepositoryLineLimitPolicyViolations(files, generatedPaths = generatedCodePaths) {
  const violations = findLineLimitPolicyViolations(files, generatedPaths)
  if (files.some((file) => file.path === rootConfigPath)) return violations

  return [
    `${rootConfigPath}: required global line-limit configuration is missing`,
    ...violations,
  ]
}

/** @returns {void} */
function run() {
  const files = process.argv.includes('--staged')
    ? readStagedPolicyFiles()
    : readWorkingTreePolicyFiles()
  const violations = findRepositoryLineLimitPolicyViolations(files)

  if (violations.length === 0) return
  for (const violation of violations) process.stderr.write(`${violation}\n`)
  process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) run()
