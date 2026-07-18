import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import {
  findPackagedAppExecutable,
  packagedPgliteSmokeEnvironment,
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
  )

  expect(environment.EXISTING).toBe('kept')
  expect(environment.VALEDICTORIAN_PGLITE_PACKAGE_SMOKE_PATH).toBe(resultDirectory)
  expect(environment.ELECTRON_RUN_AS_NODE).toBeUndefined()
})
