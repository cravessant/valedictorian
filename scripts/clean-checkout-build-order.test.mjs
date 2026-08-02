import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const fixtureRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'valedictorian-clean-checkout-build-'),
)
const temporaryRoot = path.join(fixtureRoot, 'checkout')
const pnpmStoreRoot = path.join(fixtureRoot, 'pnpm-store')

fs.mkdirSync(temporaryRoot)

function run(command, args, cwd = temporaryRoot) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
      stdio: 'pipe',
    })
  } catch (error) {
    const failure = /** @type {{ stderr?: string; stdout?: string }} */ (error)
    throw new Error([
      `${command} ${args.join(' ')} failed`,
      failure.stdout,
      failure.stderr,
    ].filter(Boolean).join('\n'))
  }
}

beforeAll(() => {
  // The index tree is the exact candidate checkout under test. In CI it is HEAD;
  // locally it also permits a fully staged candidate to prove itself before commit.
  const tree = run('git', ['write-tree'], repositoryRoot).trim()
  const archive = execFileSync('git', ['archive', '--format=tar', tree], {
    cwd: repositoryRoot,
    maxBuffer: 64 * 1024 * 1024,
  })
  execFileSync('tar', ['-xf', '-', '-C', temporaryRoot], { input: archive })
  // P12 proves a clean tracked-source build, not an air-gapped dependency
  // closure. The fixture-owned store starts empty and cannot race another test.
  run('pnpm', [
    'install',
    '--frozen-lockfile',
    '--prefer-offline',
    '--ignore-scripts',
    '--store-dir',
    pnpmStoreRoot,
  ])
}, 120_000)

afterAll(() => {
  fs.rmSync(fixtureRoot, { force: true, recursive: true })
})

describe('source-only clean checkout package build order', () => {
  it('prepares tracked sources for direct Vitest and Vite entrypoints', () => {
    const connectorCoreDist = path.join(temporaryRoot, 'packages/connector-api/dist')
    const workspaceDist = path.join(temporaryRoot, 'packages/workspace/server/dist')
    const localRuntimeDist = path.join(temporaryRoot, 'packages/local-runtime/dist')
    const rootDrizzle = path.join(temporaryRoot, 'drizzle')

    expect(fs.existsSync(connectorCoreDist)).toBe(false)
    expect(fs.existsSync(workspaceDist)).toBe(false)
    expect(fs.existsSync(localRuntimeDist)).toBe(false)
    expect(fs.existsSync(rootDrizzle)).toBe(false)

    run('pnpm', ['run', 'build:dependency-packages'])

    expect(fs.existsSync(path.join(connectorCoreDist, 'index.d.ts'))).toBe(true)
    expect(fs.existsSync(path.join(workspaceDist, 'index.d.ts'))).toBe(true)
    expect(fs.existsSync(path.join(localRuntimeDist, 'index.d.ts'))).toBe(true)

    run('pnpm', ['exec', 'vite', 'build'])

    expect(fs.existsSync(path.join(temporaryRoot, 'dist/index.html'))).toBe(true)
    expect(fs.existsSync(path.join(temporaryRoot, 'dist-electron/main.js'))).toBe(true)
    expect(fs.existsSync(path.join(temporaryRoot, 'dist-electron/preload.mjs'))).toBe(true)
  }, 120_000)
})
