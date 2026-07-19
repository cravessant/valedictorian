import { afterEach, describe, expect, it } from 'vitest'
import {
  captureEvidenceVersions,
  captureLineages,
  jobFactVersions,
  jobs,
  normalizationRuns,
} from '../../db/schema'
import {
  type PgliteClient,
  type PgliteDatabase,
} from '../../db/pglite'
import { createPgliteTestOwner } from '../../test/pglite-test-owner'
import { createPgliteProjectionOutcomeRepository } from './projection-outcome.repository'

describe('projection outcome repository schema failures', () => {
  const clients = new Set<PgliteClient>()

  afterEach(async () => {
    await Promise.all([...clients].map((client) => client.close()))
    clients.clear()
  })

  it('rolls back staged pending state when an injected trigger aborts the outer transaction', async () => {
    const { client, database, repository } = await createTestContext(clients)
    const lineage = await seedLineage(database, 'rollback')
    const normalizationId = await seedNormalization(database, lineage, {
      id: 'normalization-rollback',
      status: 'blocked',
      createdAt: '2026-07-18T10:00:00.000Z',
      updatedAt: '2026-07-18T10:00:00.000Z',
    })
    const candidateId = await seedCandidateRow(
      database,
      lineage,
      normalizationId,
      'candidate-rollback',
    )
    await client.exec(`
      create function reject_projection_outcome() returns trigger as $$
      begin
        raise exception 'injected projection failure';
      end;
      $$ language plpgsql;
      create trigger reject_projection_outcome_insert
      before insert on sourcing_projection_outcomes
      for each row execute function reject_projection_outcome();
    `)

    await expect(database.transaction(async (transaction) => {
      await repository.stagePending(transaction, {
        rawRecordId: lineage.rawRecordId,
        rawRevisionId: lineage.rawRevisionId,
        canonicalCandidateId: candidateId,
        now: '2026-07-18T10:01:00.000Z',
      })
    })).rejects.toThrow(/injected projection failure|failed query/i)
    await expect(repository.get(lineage.rawRevisionId)).resolves.toMatchObject({
      status: 'not_eligible',
      normalizationStatus: 'blocked',
    })
  })
})

async function createTestContext(clients: Set<PgliteClient>) {
  const { client, database } = await createPgliteTestOwner()
  clients.add(client)
  return {
    client,
    database,
    repository: createPgliteProjectionOutcomeRepository(database),
  }
}

interface SeedLineage {
  jobId: string
  rawRecordId: string
  rawRevisionId: string
  createdAt: string
}

async function seedLineage(database: PgliteDatabase, suffix: string): Promise<SeedLineage> {
  const createdAt = '2026-07-18T09:00:00.000Z'
  const jobId = `job-${suffix}`
  const rawRecordId = `raw-${suffix}`
  const rawRevisionId = `revision-${suffix}`
  await database.insert(jobs).values({
    id: jobId,
    identityKind: 'provider_job',
    identityNamespace: `fixture:${suffix}`,
    identityValue: suffix,
    createdAt,
  })
  await database.insert(captureLineages).values({
    id: rawRecordId,
    jobId,
    createdAt,
  })
  await database.insert(captureEvidenceVersions).values({
    id: rawRevisionId,
    captureLineageId: rawRecordId,
    revision: 1,
    contentHash: `sha256:${suffix}`,
    adapterId: 'fixture.cli',
    adapterKind: 'cli',
    adapterVersion: '1.0.0',
    observedAt: createdAt,
    evidenceJson: '[]',
    createdAt,
  })
  return { jobId, rawRecordId, rawRevisionId, createdAt }
}

async function seedNormalization(
  database: PgliteDatabase,
  lineage: SeedLineage,
  input: {
    id: string
    status: 'pending' | 'blocked' | 'completed'
    createdAt: string
    updatedAt: string
  },
) {
  await database.insert(normalizationRuns).values({
    id: input.id,
    captureLineageId: lineage.rawRecordId,
    captureEvidenceVersionId: lineage.rawRevisionId,
    inputHash: `sha256:${input.id}`,
    resolverSetHash: 'sha256:resolver-set',
    canonicalSchemaVersion: 'candidate/v1',
    gatePolicyVersion: 'gate/v1',
    triggerKind: 'intake',
    status: input.status,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  })
  return input.id
}

async function seedCandidateRow(
  database: PgliteDatabase,
  lineage: SeedLineage,
  normalizationId: string,
  candidateId: string,
) {
  await database.insert(jobFactVersions).values({
    id: candidateId,
    runId: normalizationId,
    jobId: lineage.jobId,
    captureLineageId: lineage.rawRecordId,
    captureEvidenceVersionId: lineage.rawRevisionId,
    schemaVersion: 'candidate/v1',
    jobFactVersionJson: '{}',
    createdAt: '2026-07-18T09:30:00.000Z',
  })
  return candidateId
}
