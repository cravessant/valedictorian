import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import {
  findPackagedAppExecutable,
  packagedAppLaunch,
  packagedPgliteSmokeEnvironment,
  runPackagedPgliteRestartSmoke,
} from './run-packaged-pglite-smoke.mjs'

it('finds macOS and Windows packaged application executables', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-smoke-locator-'))
  try {
    const macExecutable = path.join(root, 'mac-arm64', 'Valedictorian.app', 'Contents', 'MacOS', 'Valedictorian')
    const windowsExecutable = path.join(root, 'win-unpacked', 'Valedictorian.exe')
    fs.mkdirSync(path.dirname(macExecutable), { recursive: true })
    fs.mkdirSync(path.dirname(windowsExecutable), { recursive: true })
    fs.writeFileSync(macExecutable, '')
    fs.writeFileSync(windowsExecutable, '')

    expect(findPackagedAppExecutable(root, 'darwin')).toBe(macExecutable)
    expect(findPackagedAppExecutable(root, 'win32')).toBe(windowsExecutable)
  } finally {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

it('creates an isolated packaged smoke environment without inheriting Electron run-as-node', () => {
  const resultDirectory = '/tmp/packaged-pglite-smoke-result'
  const environment = packagedPgliteSmokeEnvironment(
    { ELECTRON_RUN_AS_NODE: '1', EXISTING: 'kept' },
    resultDirectory,
    'write',
  )

  expect(environment.EXISTING).toBe('kept')
  expect(environment.VALEDICTORIAN_PGLITE_PACKAGE_SMOKE_PATH).toBe(resultDirectory)
  expect(environment.VALEDICTORIAN_PGLITE_PACKAGE_SMOKE_PHASE).toBe('write')
  expect(environment.ELECTRON_RUN_AS_NODE).toBeUndefined()
})

it('launches a Windows package through Wine when cross-platform verification requests it', () => {
  expect(packagedAppLaunch('/project/release/win-unpacked/Valedictorian.exe', 'wine')).toEqual({
    args: ['/project/release/win-unpacked/Valedictorian.exe'],
    command: 'wine',
  })
  expect(packagedAppLaunch('/Applications/Valedictorian')).toEqual({
    args: [],
    command: '/Applications/Valedictorian',
  })
})

it('launches separate packaged processes to write and then verify persisted data', async () => {
  const resultDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-smoke-restart-'))
  const phases = []
  try {
    const spawnPackagedApp = async (_executablePath, environment) => {
      const phase = environment.VALEDICTORIAN_PGLITE_PACKAGE_SMOKE_PHASE
      phases.push(phase)
      fs.writeFileSync(
        path.join(resultDirectory, `${phase}.json`),
        `${JSON.stringify(phase === 'write'
          ? { phase: 'write' }
          : {
              companyName: 'Packaged PGlite Smoke',
              persistedApplications: 1,
              phase: 'verify',
            })}\n`,
      )
    }

    await expect(runPackagedPgliteRestartSmoke({
      environment: { EXISTING: 'kept' },
      executablePath: '/Applications/Valedictorian',
      resultDirectory,
      spawnPackagedApp,
      timeoutMs: 1_000,
    })).resolves.toEqual({
      companyName: 'Packaged PGlite Smoke',
      persistedApplications: 1,
      phase: 'verify',
    })
    expect(phases).toEqual(['write', 'verify'])
  } finally {
    fs.rmSync(resultDirectory, { force: true, recursive: true })
  }
})
