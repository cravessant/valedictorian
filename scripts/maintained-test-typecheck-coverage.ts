import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const testsProjectPath = 'tsconfig.tests.json'
export const maintainedTestRoots = [
  'electron',
  'packages/connector-api',
  'packages/connector-testkit',
  'packages/workspace',
  'scripts',
  'src',
] as const

const maintainedTestPattern = new RegExp(
  `^(?:${maintainedTestRoots.join('|')})/(?:[^/]+/)*[^/]+\\.test\\.tsx?$`,
)
const typescriptCompilerPath = 'node_modules/typescript/bin/tsc'

function toRepositoryPath(repositoryRoot: string, filePath: string): string {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/')
}

/**
 * Discovery is bounded by the maintained roots alone: no exclude source is
 * passed to `git ls-files`, so `.gitignore`, `.git/info/exclude`, and the
 * user's global excludes file cannot hide a physical test from this check on
 * one machine only. This matches the dedicated tests project, whose `exclude`
 * is empty — a generated or ignored test must fail closed rather than silently
 * evade the proof.
 */
export function discoverMaintainedTests(repositoryRoot: string = process.cwd()): string[] {
  const listed = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '-z', '--', ...maintainedTestRoots],
    { cwd: repositoryRoot, encoding: 'utf8' },
  )

  return [...new Set(listed.split('\0').filter((entry) => maintainedTestPattern.test(entry)))].sort()
}

export function listProgramFiles(repositoryRoot: string = process.cwd()): string[] {
  const listed = execFileSync(
    process.execPath,
    [
      path.join(repositoryRoot, typescriptCompilerPath),
      '-p',
      path.join(repositoryRoot, testsProjectPath),
      '--listFilesOnly',
    ],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )

  return listed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => path.isAbsolute(line))
    .map((line) => toRepositoryPath(repositoryRoot, line))
    .sort()
}

export function findUncoveredMaintainedTests(
  discoveredTests: readonly string[],
  programFiles: readonly string[],
): string[] {
  const covered = new Set(programFiles)

  return [...discoveredTests].filter((testPath) => !covered.has(testPath)).sort()
}

export function formatCoverageFailure(
  uncoveredTests: readonly string[],
  discoveredCount: number,
): string {
  return [
    `${testsProjectPath} omits ${uncoveredTests.length} of ${discoveredCount} maintained tests.`,
    'Every maintained .test.ts and .test.tsx file must be type-checked by that project.',
    ...uncoveredTests.map((testPath) => `  missing: ${testPath}`),
  ].join('\n')
}

function run(): void {
  const repositoryRoot = process.cwd()
  const discoveredTests = discoverMaintainedTests(repositoryRoot)

  if (discoveredTests.length === 0) {
    process.stderr.write('No maintained tests were discovered; check the repository root.\n')
    process.exitCode = 1
    return
  }

  const uncoveredTests = findUncoveredMaintainedTests(
    discoveredTests,
    listProgramFiles(repositoryRoot),
  )

  if (uncoveredTests.length > 0) {
    process.stderr.write(`${formatCoverageFailure(uncoveredTests, discoveredTests.length)}\n`)
    process.exitCode = 1
    return
  }

  process.stdout.write(
    `${testsProjectPath} covers all ${discoveredTests.length} maintained tests.\n`,
  )
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) run()
