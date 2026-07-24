import { createPgliteClient, migratePgliteDatabase } from '../db/pglite'
import { createPgliteCaptureService } from '../modules/capture/capture.service'
import { createLocalValedictorianClient } from './local-valedictorian-client'
export { isolatedValidationFixture } from './isolated-validation.fixture-contract'
import { isolatedValidationFixture } from './isolated-validation.fixture-contract'

const fixtureIds = [
  isolatedValidationFixture.captureId,
  '01986e01-4030-7000-8000-000000000002',
  isolatedValidationFixture.companyId,
  '01986e01-4030-7000-8000-000000000004',
] as const

export async function seedIsolatedValidationFixture({
  pgliteDataPath,
  profilePath,
  workspaceId,
}: {
  readonly pgliteDataPath: string
  readonly profilePath: string
  readonly workspaceId: string
}) {
  const pglite = await createPgliteClient({ dataDir: pgliteDataPath })
  try {
    const database = await migratePgliteDatabase(pglite)
    const newId = fixtureIdGenerator()
    const client = await createLocalValedictorianClient({
      database,
      newId,
      now: () => new Date(isolatedValidationFixture.timestamp),
      pgliteDataPath,
      profilePath,
      workspaceId,
    })
    const capture = await createPgliteCaptureService(database, {
      newId,
      now: () => new Date(isolatedValidationFixture.timestamp),
    }).accept({
      actor: { id: 'isolated-validation', type: 'system' },
      evidence: [{ kind: 'title', label: 'Role title', value: 'Validation Engineer' }],
      evidenceMode: 'reported',
      payload: { companyName: 'Validation Company', roleTitle: 'Validation Engineer' },
      provenance: {
        adapterId: 'isolated-validation',
        adapterKind: 'cli',
        adapterVersion: '1.0.0',
        observedAt: isolatedValidationFixture.timestamp,
        providerRecordId: 'isolated-validation-capture',
        providerSchema: 'isolated-validation@1',
      },
      workspaceId,
    })
    if (!capture.ok || capture.capture.id !== isolatedValidationFixture.captureId) {
      throw new Error('Could not create the fixed isolated validation Capture.')
    }
    const company = await client.companies.create({
      actor: { id: 'isolated-validation', type: 'system' },
      displayName: 'Validation Company',
      idempotencyKey: 'isolated-validation-company',
      notes: 'Fixed isolated validation fixture.',
      rationale: 'Create the deterministic isolated validation Company.',
      websiteUrl: 'https://validation.example',
      workspaceId,
    })
    if (company.status !== 'created' || company.companyId !== isolatedValidationFixture.companyId) {
      throw new Error('Could not create the fixed isolated validation Company.')
    }
    const captures = await client.captures.list()
    const companies = await client.companies.directory.list({
      filter: 'all', limit: 10, sort: 'display_name_asc',
    })
    if (captures.items.length !== 1 || companies.totalCount !== 1) {
      throw new Error('Isolated validation fixture observables are incomplete.')
    }
    return {
      captureId: capture.capture.id,
      companyId: company.companyId,
      unresolvedCaptureCount: captures.items.length,
      companyCount: companies.totalCount,
    }
  } finally {
    await pglite.close()
  }
}

function fixtureIdGenerator() {
  let index = 0
  return () => {
    const id = fixtureIds[index]
    index += 1
    if (!id) throw new Error('The isolated validation fixture exhausted its fixed IDs.')
    return id
  }
}
