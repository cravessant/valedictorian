import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isolatedValidationFixture } from './isolated-validation.fixture-contract'
import { seedIsolatedValidationFixture } from './isolated-validation.fixture'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true })
  }
})

describe('isolated validation fixture', () => {
  it('creates fixed Capture and Company observables through the local runtime contract', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-isolated-fixture-'))
    temporaryDirectories.push(root)
    await expect(seedIsolatedValidationFixture({
      pgliteDataPath: path.join(root, 'pglite'),
      profilePath: path.join(root, 'profile.json'),
      workspaceId: 'isolated-validation-test-workspace',
    })).resolves.toEqual({
      captureId: isolatedValidationFixture.captureId,
      companyCount: 1,
      companyId: isolatedValidationFixture.companyId,
      unresolvedCaptureCount: 1,
    })
  })
})
