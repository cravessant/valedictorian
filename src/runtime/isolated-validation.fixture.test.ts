import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPgliteClient, migratePgliteDatabase } from '../db/pglite'
import { createCaptureMaterializationService } from '../modules/capture/capture.materialization'
import { createCaptureResolutionService } from '../modules/capture/capture.resolution'
import { validateDestinationUrl } from '../modules/capture/destination-url-safety'
import {
  captureCompletionLongContentFixture,
  isolatedValidationFixture,
} from './isolated-validation.fixture-contract'
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

  it('seeds the bounded long-content Capture completion fixture for Electron layout proofing', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-isolated-fixture-long-content-'))
    temporaryDirectories.push(root)
    const pgliteDataPath = path.join(root, 'pglite')
    const workspaceId = 'isolated-validation-long-content-workspace'

    await expect(seedIsolatedValidationFixture({
      captureCompletionLongContent: true,
      pgliteDataPath,
      profilePath: path.join(root, 'profile.json'),
      workspaceId,
    })).resolves.toEqual({
      captureId: isolatedValidationFixture.captureId,
      companyCount: 1,
      companyId: isolatedValidationFixture.companyId,
      unresolvedCaptureCount: 1,
    })

    const pglite = await createPgliteClient({ dataDir: pgliteDataPath })
    try {
      const database = await migratePgliteDatabase(pglite)
      const materialization = createCaptureMaterializationService(database)
      const detail = await createCaptureResolutionService(database, {
        materialization,
        workspaceId,
      }).get(isolatedValidationFixture.captureId)

      expect(detail.destination).toEqual({
        status: 'resolved',
        url: captureCompletionLongContentFixture.destinationUrl,
      })
      expect(detail.provenance).toContainEqual({
        kind: 'destination',
        label: 'validation-fixture.acme.com',
        url: captureCompletionLongContentFixture.destinationUrl,
      })
    } finally {
      await pglite.close()
    }
  })

  it('keeps the long-content validation URL rejected with the message completion renders', () => {
    const seeded = validateDestinationUrl(captureCompletionLongContentFixture.destinationUrl)
    const rejected = validateDestinationUrl(captureCompletionLongContentFixture.validationUrl)

    expect(seeded.ok).toBe(true)
    expect(rejected).toMatchObject({
      code: 'sensitive_query',
      message: captureCompletionLongContentFixture.validationMessage,
      ok: false,
    })
  })
})
