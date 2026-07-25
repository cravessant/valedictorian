import { and, eq } from 'drizzle-orm'
import { createPgliteClient, migratePgliteDatabase } from '../db/pglite'
import type { PgliteDatabase } from '../db/pglite'
import { createPgliteCaptureService } from '../modules/capture/capture.service'
import {
  captureResolutionGenerations,
  captureResolutionStageResults,
} from '../modules/capture/capture.schema'
import { createLocalValedictorianClient } from './local-valedictorian-client'
export { isolatedValidationFixture } from './isolated-validation.fixture-contract'
import {
  captureCompletionLongContentFixture,
  isolatedValidationFixture,
} from './isolated-validation.fixture-contract'

const fixtureIds = [
  isolatedValidationFixture.captureId,
  '01986e01-4030-7000-8000-000000000002',
  isolatedValidationFixture.companyId,
  '01986e01-4030-7000-8000-000000000004',
  '01986e01-4030-7000-8000-000000000005',
  '01986e01-4030-7000-8000-000000000006',
] as const

const longContentFixtureIds = [
  isolatedValidationFixture.captureId,
  '01986e01-4030-7000-8000-000000000002',
  '01986e01-4030-7000-8000-000000000007',
  '01986e01-4030-7000-8000-000000000008',
  isolatedValidationFixture.companyId,
  '01986e01-4030-7000-8000-000000000004',
  '01986e01-4030-7000-8000-000000000005',
  '01986e01-4030-7000-8000-000000000006',
] as const

export async function seedIsolatedValidationFixture({
  captureCompletionLongContent = false,
  pgliteDataPath,
  profilePath,
  workspaceId,
}: {
  readonly captureCompletionLongContent?: boolean
  readonly pgliteDataPath: string
  readonly profilePath: string
  readonly workspaceId: string
}) {
  const pglite = await createPgliteClient({ dataDir: pgliteDataPath })
  try {
    const database = await migratePgliteDatabase(pglite)
    const newId = fixtureIdGenerator(captureCompletionLongContent)
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
      evidence: captureCompletionLongContent ? [
        { kind: 'title', label: 'Role title', value: 'Validation Engineer' },
        {
          kind: 'provider_identifier',
          label: 'External posting identifier',
          value: captureCompletionLongContentFixture.identifier,
        },
        {
          kind: 'provider_payload',
          label: 'Provider JSON payload',
          value: captureCompletionLongContentFixture.jsonEvidence,
        },
      ] : [{ kind: 'title', label: 'Role title', value: 'Validation Engineer' }],
      evidenceMode: 'reported',
      payload: { companyName: 'Validation Company', roleTitle: 'Validation Engineer' },
      provenance: {
        adapterId: captureCompletionLongContent
          ? captureCompletionLongContentFixture.sourceAdapterId
          : 'isolated-validation',
        adapterKind: 'cli',
        adapterVersion: '1.0.0',
        observedAt: isolatedValidationFixture.timestamp,
        providerRecordId: captureCompletionLongContent
          ? captureCompletionLongContentFixture.identifier
          : 'isolated-validation-capture',
        providerSchema: 'isolated-validation@1',
      },
      workspaceId,
    })
    if (!capture.ok || capture.capture.id !== isolatedValidationFixture.captureId) {
      throw new Error('Could not create the fixed isolated validation Capture.')
    }
    if (captureCompletionLongContent) {
      await client.captureResolution.get(capture.capture.id)
      await resolveLongContentDestination({
        captureId: capture.capture.id,
        database,
        workspaceId,
      })
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
    if (captureCompletionLongContent) {
      const updated = await client.companies.update({
        actor: { id: 'isolated-validation', type: 'system' },
        companyId: company.companyId,
        displayName: captureCompletionLongContentFixture.companyDisplayName,
        expectedCompanyRevision: company.company.revision,
        idempotencyKey: 'isolated-validation-long-content-company',
        rationale: 'Use a deterministic long Company display value for the layout proof.',
        workspaceId,
      })
      if (updated.status !== 'updated') {
        throw new Error('Could not update the isolated validation Company with the long layout fixture.')
      }
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

async function resolveLongContentDestination({
  captureId,
  database,
  workspaceId,
}: {
  readonly captureId: string
  readonly database: PgliteDatabase
  readonly workspaceId: string
}) {
  const [generation] = await database
    .select({ id: captureResolutionGenerations.id })
    .from(captureResolutionGenerations)
    .where(and(
      eq(captureResolutionGenerations.captureId, captureId),
      eq(captureResolutionGenerations.workspaceId, workspaceId),
      eq(captureResolutionGenerations.status, 'active'),
    ))
    .limit(1)
  if (!generation) {
    throw new Error('Could not find the active Capture resolution generation for the long-content fixture.')
  }
  await database.update(captureResolutionStageResults).set({
    issueJson: null,
    nextAttemptAt: null,
    resultJson: JSON.stringify({ url: captureCompletionLongContentFixture.destinationUrl }),
    status: 'resolved',
    updatedAt: isolatedValidationFixture.timestamp,
  }).where(and(
    eq(captureResolutionStageResults.generationId, generation.id),
    eq(captureResolutionStageResults.stage, 'destination'),
  ))
}

function fixtureIdGenerator(longContent = false) {
  const ids = longContent ? longContentFixtureIds : fixtureIds
  let index = 0
  return () => {
    const id = ids[index]
    index += 1
    if (!id) throw new Error('The isolated validation fixture exhausted its fixed IDs.')
    return id
  }
}
