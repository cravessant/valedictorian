import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  discoverMaintainedTests,
  findUncoveredMaintainedTests,
  formatCoverageFailure,
  listProgramFiles,
  maintainedTestRoots,
  testsProjectPath,
} from './maintained-test-typecheck-coverage'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function writeFile(root: string, relativePath: string, contents = '') {
  const absolutePath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(absolutePath, contents)
}

function initializeRepository(files: readonly string[]) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'maintained-test-coverage-')))
  temporaryRoots.push(root)
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  for (const file of files) writeFile(root, file)
  return root
}

describe('maintained test type-check coverage', () => {
  it('discovers every maintained test under the maintained roots', () => {
    const root = initializeRepository([
      'electron/main.test.ts',
      'electron/windows/window.test.tsx',
      'packages/connector-api/src/contract.test.ts',
      'packages/connector-testkit/src/host.test.ts',
      'packages/cli/src/standalone.test.ts',
      'scripts/policy.test.ts',
      'src/app/App.test.tsx',
      'src/app/App.tsx',
      'src/app/App.helpers.ts',
      'scripts/policy.test.mjs',
      'docs/notes.test.ts',
    ])

    expect(discoverMaintainedTests(root)).toEqual([
      'electron/main.test.ts',
      'electron/windows/window.test.tsx',
      'packages/connector-api/src/contract.test.ts',
      'packages/connector-testkit/src/host.test.ts',
      'scripts/policy.test.ts',
      'src/app/App.test.tsx',
    ])
  })

  it('discovers untracked maintained tests alongside tracked ones', () => {
    const root = initializeRepository(['src/app/App.test.ts'])
    execFileSync('git', ['add', 'src/app/App.test.ts'], { cwd: root })
    writeFile(root, 'src/app/Unstaged.test.ts')

    expect(discoverMaintainedTests(root)).toEqual([
      'src/app/App.test.ts',
      'src/app/Unstaged.test.ts',
    ])
  })

  it('discovers maintained tests with paths git would quote without -z', () => {
    const root = initializeRepository([
      'src/app/App.test.ts',
      'src/odd name/Spaced "quoted".test.ts',
    ])

    expect(discoverMaintainedTests(root)).toEqual([
      'src/app/App.test.ts',
      'src/odd name/Spaced "quoted".test.ts',
    ])
  })

  it('discovers maintained tests hidden by root and nested .gitignore rules', () => {
    const root = initializeRepository(['src/app/App.test.ts'])
    writeFile(root, '.gitignore', 'dist/\n*.generated.test.ts\n')
    writeFile(root, 'src/app/.gitignore', 'Nested.test.ts\n')
    writeFile(root, 'src/dist/Ignored.test.ts')
    writeFile(root, 'src/app/Generated.generated.test.ts')
    writeFile(root, 'src/app/Nested.test.ts')

    expect(discoverMaintainedTests(root)).toEqual([
      'src/app/App.test.ts',
      'src/app/Generated.generated.test.ts',
      'src/app/Nested.test.ts',
      'src/dist/Ignored.test.ts',
    ])
  })

  it('discovers maintained tests hidden by repository-local excludes', () => {
    const root = initializeRepository(['src/app/App.test.ts'])
    writeFile(root, '.git/info/exclude', 'hidden.test.ts\n')
    writeFile(root, 'src/hidden.test.ts')

    expect(discoverMaintainedTests(root)).toEqual(['src/app/App.test.ts', 'src/hidden.test.ts'])
  })

  it('discovers maintained tests hidden by global git excludes', () => {
    const root = initializeRepository(['src/app/App.test.ts'])
    writeFile(root, 'global-excludes', 'hidden.test.ts\n')
    execFileSync('git', ['config', 'core.excludesFile', path.join(root, 'global-excludes')], {
      cwd: root,
    })
    writeFile(root, 'src/hidden.test.ts')

    expect(discoverMaintainedTests(root)).toEqual(['src/app/App.test.ts', 'src/hidden.test.ts'])
  })

  it('reports no gap when the compiler program contains every discovered test', () => {
    const discovered = ['src/a.test.ts', 'src/b.test.tsx']

    expect(findUncoveredMaintainedTests(discovered, [...discovered, 'src/a.ts'])).toEqual([])
  })

  it('rejects a program that omits a discovered maintained test', () => {
    const discovered = ['src/a.test.ts', 'src/b.test.tsx', 'src/c.test.ts']
    const programFiles = ['src/a.test.ts', 'src/c.test.ts']

    const uncovered = findUncoveredMaintainedTests(discovered, programFiles)

    expect(uncovered).toEqual(['src/b.test.tsx'])

    const failure = formatCoverageFailure(uncovered, discovered.length)
    expect(failure).toContain(`${testsProjectPath} omits 1 of 3 maintained tests.`)
    expect(failure).toContain('  missing: src/b.test.tsx')
  })

  it('type-checks every maintained test in this repository', () => {
    const discovered = discoverMaintainedTests()

    expect(discovered.length).toBeGreaterThan(0)
    expect(maintainedTestRoots).toEqual([
      'electron',
      'packages/connector-api',
      'packages/connector-testkit',
      'packages/workspace',
      'scripts',
      'src',
    ])
    expect(discovered).toEqual(
      expect.not.arrayContaining(['packages/cli/src/standalone.test.ts']),
    )
    expect(findUncoveredMaintainedTests(discovered, listProgramFiles())).toEqual([])
  }, 120_000)
})
