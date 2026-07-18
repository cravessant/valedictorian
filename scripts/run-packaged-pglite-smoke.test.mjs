import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  findPackagedAppExecutable,
  packagedPgliteSmokeEnvironment,
} from './run-packaged-pglite-smoke.mjs'

test('finds macOS and Windows packaged application executables', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-smoke-locator-'))
  try {
    const macExecutable = path.join(root, 'mac-arm64', 'Valedictorian.app', 'Contents', 'MacOS', 'Valedictorian')
    const windowsExecutable = path.join(root, 'win-unpacked', 'Valedictorian.exe')
    fs.mkdirSync(path.dirname(macExecutable), { recursive: true })
    fs.mkdirSync(path.dirname(windowsExecutable), { recursive: true })
    fs.writeFileSync(macExecutable, '')
    fs.writeFileSync(windowsExecutable, '')

    assert.equal(findPackagedAppExecutable(root, 'darwin'), macExecutable)
    assert.equal(findPackagedAppExecutable(root, 'win32'), windowsExecutable)
  } finally {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

test('creates an isolated packaged smoke environment without inheriting Electron run-as-node', () => {
  const resultDirectory = '/tmp/packaged-pglite-smoke-result'
  const environment = packagedPgliteSmokeEnvironment(
    { ELECTRON_RUN_AS_NODE: '1', EXISTING: 'kept' },
    resultDirectory,
  )

  assert.equal(environment.EXISTING, 'kept')
  assert.equal(environment.VALEDICTORIAN_PGLITE_PACKAGE_SMOKE_PATH, resultDirectory)
  assert.equal(environment.ELECTRON_RUN_AS_NODE, undefined)
})
