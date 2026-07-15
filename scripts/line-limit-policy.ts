import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export type PolicyFile = {
  path: string
  source: string
}

const commentPattern = /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g
const maxLinesDisablePattern = /\b(?:eslint|oxlint)-disable(?:-line|-next-line)?\b[^\r\n]*\bmax-lines\b/
const rootConfigPath = '.oxlintrc.json'
const lintConfigPathPattern =
  /(?:^|\/)(?:\.oxlintrc(?:\.(?:json|jsonc|js|cjs|mjs|ts|cts|mts))?|eslint\.config\.(?:js|cjs|mjs|ts|cts|mts))$/
const maintainedCodePathPattern = /\.(?:[cm]?[jt]s|[jt]sx)$/

// Add only exact paths for artifacts that a machine regenerates. Maintained code has no exemptions.
export const generatedCodePaths: ReadonlySet<string> = new Set()

function listGitFiles(args: string[]): string[] {
  return execFileSync('git', args, { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
}

function isPolicyFile(filePath: string): boolean {
  return maintainedCodePathPattern.test(filePath) || lintConfigPathPattern.test(filePath)
}

export function readWorkingTreePolicyFiles(): PolicyFile[] {
  return listGitFiles(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .filter(isPolicyFile)
    .flatMap((filePath) => {
      const absolutePath = path.resolve(filePath)
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return []
      return [{ path: filePath, source: fs.readFileSync(absolutePath, 'utf8') }]
    })
}

export function readStagedPolicyFiles(): PolicyFile[] {
  return listGitFiles(['ls-files', '--cached', '-z'])
    .filter(isPolicyFile)
    .map((filePath) => ({
      path: filePath,
      source: execFileSync('git', ['show', `:${filePath}`], { encoding: 'utf8' }),
    }))
}

function countKeys(value: unknown, key: string): number {
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

function hasRequiredGlobalRule(source: string): boolean {
  try {
    const config = JSON.parse(source) as {
      rules?: Record<string, unknown>
    }
    const rule = config.rules?.['max-lines']

    return (
      countKeys(config, 'max-lines') === 1 &&
      Array.isArray(rule) &&
      rule.length === 2 &&
      rule[0] === 'error' &&
      typeof rule[1] === 'object' &&
      rule[1] !== null &&
      (rule[1] as Record<string, unknown>).max === 1000 &&
      (rule[1] as Record<string, unknown>).skipBlankLines === true &&
      (rule[1] as Record<string, unknown>).skipComments === true
    )
  } catch {
    return false
  }
}

export function findLineLimitPolicyViolations(
  files: PolicyFile[],
  generatedPaths: ReadonlySet<string> = generatedCodePaths,
): string[] {
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
      file.source.includes('max-lines')
    ) {
      return [`${file.path}: nested max-lines configuration is forbidden`]
    }

    const comments = file.source.match(commentPattern) ?? []
    if (!comments.some((comment) => maxLinesDisablePattern.test(comment))) return []

    return [`${file.path}: max-lines disable directives are forbidden in maintained code`]
  })
}

export function findRepositoryLineLimitPolicyViolations(files: PolicyFile[]): string[] {
  const violations = findLineLimitPolicyViolations(files)
  if (files.some((file) => file.path === rootConfigPath)) return violations

  return [
    `${rootConfigPath}: required global line-limit configuration is missing`,
    ...violations,
  ]
}

function run(): void {
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
