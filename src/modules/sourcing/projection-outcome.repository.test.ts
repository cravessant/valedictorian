import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  captureEvidenceVersions,
  captureLineages,
  jobFactVersions,
  jobs,
  normalizationRuns,
  opportunities,
  sources,
  workflowRuns,
} from '../../db/schema'
import {
  createPgliteClient,
  createPgliteDatabase,
  migratePgliteDatabase,
  type PgliteClient,
  type PgliteDatabase,
} from '../../db/pglite'
import { createPgliteTestOwner } from '../../test/pglite-test-owner'
import { createPgliteProjectionOutcomeRepository } from './projection-outcome.repository'

describe('projection outcome repository', () => {
  const clients = new Set<PgliteClient>()

  afterEach(async () => {
    await Promise.all([...clients].map((client) => client.close()))
    clients.clear()
  })

  it('stages one pending outcome idempotently', async () => {
    const { database, repository } = await createTestContext(clients)
    const lineage = await seedLineage(database, 'idempotent')
    const candidateId = await seedCandidate(database, lineage, 'candidate-idempotent')

    await database.transaction(async (transaction) => {
      const input = {
        rawRecordId: lineage.rawRecordId,
        rawRevisionId: lineage.rawRevisionId,
        canonicalCandidateId: candidateId,
        now: '2026-07-18T10:00:00.000Z',
      }
      await repository.stagePending(transaction, input)
      await repository.stagePending(transaction, input)
    })

    await expect(repository.get(lineage.rawRevisionId)).resolves.toEqual({
      status: 'pending',
      rawRecordId: lineage.rawRecordId,
      rawRevisionId: lineage.rawRevisionId,
      normalizationStatus: 'completed',
      gateStatus: 'passed',
      canonicalCandidateId: candidateId,
      updatedAt: '2026-07-18T10:00:00.000Z',
    })
  })

  it('marks a pending outcome projected with its finding reference', async () => {
    const { database, repository } = await createTestContext(clients)
    const lineage = await seedLineage(database, 'projected')
    const candidateId = await seedCandidate(database, lineage, 'candidate-projected')
    const findingId = await seedFinding(database, lineage, candidateId, 'finding-projected')

    await database.transaction(async (transaction) => {
      await repository.stagePending(transaction, {
        rawRecordId: lineage.rawRecordId,
        rawRevisionId: lineage.rawRevisionId,
        canonicalCandidateId: candidateId,
        now: '2026-07-18T10:00:00.000Z',
      })
      await repository.markProjected(
        transaction,
        candidateId,
        findingId,
        '2026-07-18T10:05:00.000Z',
      )
    })

    await expect(repository.get(lineage.rawRevisionId)).resolves.toEqual({
      status: 'projected',
      rawRecordId: lineage.rawRecordId,
      rawRevisionId: lineage.rawRevisionId,
      normalizationStatus: 'completed',
      gateStatus: 'passed',
      canonicalCandidateId: candidateId,
      projectedAt: '2026-07-18T10:05:00.000Z',
      updatedAt: '2026-07-18T10:05:00.000Z',
      finding: {
        id: findingId,
        mergeStatus: 'new',
        mergedApplicationId: null,
      },
    })
  })

  it('reports failed projection and blocked normalization transitions', async () => {
    const { database, repository } = await createTestContext(clients)
    const failed = await seedLineage(database, 'failed')
    const failedCandidateId = await seedCandidate(database, failed, 'candidate-failed')
    await database.transaction(async (transaction) => {
      await repository.stagePending(transaction, {
        rawRecordId: failed.rawRecordId,
        rawRevisionId: failed.rawRevisionId,
        canonicalCandidateId: failedCandidateId,
        now: '2026-07-18T10:00:00.000Z',
      })
    })
    await repository.markFailed(failedCandidateId, '2026-07-18T10:06:00.000Z')

    await expect(repository.get(failed.rawRevisionId)).resolves.toMatchObject({
      status: 'failed',
      failedAt: '2026-07-18T10:06:00.000Z',
      failure: { code: 'projection_failed', retryable: false },
    })

    const blocked = await seedLineage(database, 'blocked')
    await seedNormalization(database, blocked, {
      id: 'normalization-blocked',
      status: 'blocked',
      createdAt: '2026-07-18T11:00:00.000Z',
      updatedAt: '2026-07-18T11:00:00.000Z',
    })
    await expect(repository.get(blocked.rawRevisionId)).resolves.toEqual({
      status: 'not_eligible',
      rawRecordId: blocked.rawRecordId,
      rawRevisionId: blocked.rawRevisionId,
      normalizationStatus: 'blocked',
      canonicalCandidateId: null,
      gateStatus: null,
      updatedAt: '2026-07-18T11:00:00.000Z',
    })
  })

  it('selects latest normalization and projection outcomes deterministically', async () => {
    const { database, repository } = await createTestContext(clients)
    const normalized = await seedLineage(database, 'latest-normalization')
    await seedNormalization(database, normalized, {
      id: 'normalization-a',
      status: 'pending',
      createdAt: '2026-07-18T11:00:00.000Z',
      updatedAt: '2026-07-18T12:00:00.000Z',
    })
    await seedNormalization(database, normalized, {
      id: 'normalization-z',
      status: 'blocked',
      createdAt: '2026-07-18T11:00:00.000Z',
      updatedAt: '2026-07-18T12:00:00.000Z',
    })
    await expect(repository.get(normalized.rawRevisionId)).resolves.toMatchObject({
      normalizationStatus: 'blocked',
      updatedAt: '2026-07-18T12:00:00.000Z',
    })

    const projected = await seedLineage(database, 'latest-projection')
    const firstCandidate = await seedCandidate(database, projected, 'candidate-first', {
      normalizationId: 'normalization-first',
    })
    const secondCandidate = await seedCandidate(database, projected, 'candidate-second', {
      normalizationId: 'normalization-second',
    })
    await database.transaction(async (transaction) => {
      await repository.stagePending(transaction, {
        rawRecordId: projected.rawRecordId,
        rawRevisionId: projected.rawRevisionId,
        canonicalCandidateId: firstCandidate,
        now: '2026-07-18T13:00:00.000Z',
      })
      await repository.stagePending(transaction, {
        rawRecordId: projected.rawRecordId,
        rawRevisionId: projected.rawRevisionId,
        canonicalCandidateId: secondCandidate,
        now: '2026-07-18T14:00:00.000Z',
      })
    })
    await expect(repository.get(projected.rawRevisionId)).resolves.toMatchObject({
      status: 'pending',
      canonicalCandidateId: secondCandidate,
      updatedAt: '2026-07-18T14:00:00.000Z',
    })
  })

  it('preserves missing raw revision and pending outcome errors', async () => {
    const { database, repository } = await createTestContext(clients)
    await expect(repository.get('missing-revision')).resolves.toBeNull()
    const lineage = await seedLineage(database, 'missing-outcome')
    await expect(repository.get(lineage.rawRevisionId)).resolves.toEqual({
      status: 'not_eligible',
      rawRecordId: lineage.rawRecordId,
      rawRevisionId: lineage.rawRevisionId,
      normalizationStatus: null,
      canonicalCandidateId: null,
      gateStatus: null,
      updatedAt: lineage.createdAt,
    })

    await expect(database.transaction(async (transaction) =>
      repository.markProjected(
        transaction,
        'missing-candidate',
        'missing-finding',
        '2026-07-18T10:00:00.000Z',
      ))).rejects.toThrow('Pending projection outcome was not found')
    await expect(repository.markFailed(
      'missing-candidate',
      '2026-07-18T10:00:00.000Z',
    )).rejects.toThrow('Pending projection outcome was not found')
  })

  it('converges concurrent duplicate staging on one durable pending outcome', async () => {
    const { database, repository } = await createTestContext(clients)
    const lineage = await seedLineage(database, 'concurrent')
    const candidateId = await seedCandidate(database, lineage, 'candidate-concurrent')
    const input = {
      rawRecordId: lineage.rawRecordId,
      rawRevisionId: lineage.rawRevisionId,
      canonicalCandidateId: candidateId,
      now: '2026-07-18T10:00:00.000Z',
    }

    await Promise.all([
      database.transaction(async (transaction) => repository.stagePending(transaction, input)),
      database.transaction(async (transaction) => repository.stagePending(transaction, input)),
    ])

    await expect(repository.get(lineage.rawRevisionId)).resolves.toMatchObject({
      status: 'pending',
      canonicalCandidateId: candidateId,
    })
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

  it('keeps pending outcomes visible after an on-disk PGlite restart', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'projection-outcome-pglite-'))
    const dataDir = path.join(temporaryRoot, 'pglite')
    const closed = new Set<PgliteClient>()
    let firstClient: PgliteClient | null = null
    let secondClient: PgliteClient | null = null

    try {
      firstClient = await createPgliteClient({ dataDir })
      const firstDatabase = await migratePgliteDatabase(firstClient)
      const lineage = await seedLineage(firstDatabase, 'restart')
      const candidateId = await seedCandidate(firstDatabase, lineage, 'candidate-restart')
      const firstRepository = createPgliteProjectionOutcomeRepository(firstDatabase)
      await firstDatabase.transaction(async (transaction) => {
        await firstRepository.stagePending(transaction, {
          rawRecordId: lineage.rawRecordId,
          rawRevisionId: lineage.rawRevisionId,
          canonicalCandidateId: candidateId,
          now: '2026-07-18T10:00:00.000Z',
        })
      })
      await closeOnce(firstClient, closed)

      secondClient = await createPgliteClient({ dataDir })
      const secondRepository = createPgliteProjectionOutcomeRepository(
        createPgliteDatabase(secondClient),
      )
      await expect(secondRepository.get(lineage.rawRevisionId)).resolves.toMatchObject({
        status: 'pending',
        canonicalCandidateId: candidateId,
      })
    } finally {
      await closeOnce(secondClient, closed)
      await closeOnce(firstClient, closed)
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true })
    }

    expect(closed.size).toBe(2)
    expect(fs.existsSync(temporaryRoot)).toBe(false)
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

async function seedCandidate(
  database: PgliteDatabase,
  lineage: SeedLineage,
  candidateId: string,
  options: { normalizationId?: string } = {},
) {
  const normalizationId = options.normalizationId ?? `normalization-${candidateId}`
  await seedNormalization(database, lineage, {
    id: normalizationId,
    status: 'completed',
    createdAt: '2026-07-18T09:30:00.000Z',
    updatedAt: '2026-07-18T09:30:00.000Z',
  })
  await seedCandidateRow(database, lineage, normalizationId, candidateId)
  return candidateId
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

async function seedFinding(
  database: PgliteDatabase,
  lineage: SeedLineage,
  candidateId: string,
  findingId: string,
) {
  const createdAt = '2026-07-18T09:45:00.000Z'
  const sourceId = `source-${findingId}`
  const workflowRunId = `workflow-${findingId}`
  await database.insert(sources).values({
    id: sourceId,
    name: 'Fixture Source',
    createdAt,
    updatedAt: createdAt,
  })
  await database.insert(workflowRuns).values({
    id: workflowRunId,
    runType: 'sourcing',
    status: 'completed',
    actorType: 'agent',
    sourceId,
    startedAt: createdAt,
    inputJson: '{}',
    metadataJson: '{}',
    createdAt,
    updatedAt: createdAt,
  })
  await database.insert(opportunities).values({
    id: findingId,
    projectionIdentityKey: `projection:${findingId}`,
    jobId: lineage.jobId,
    jobFactVersionId: candidateId,
    captureEvidenceVersionId: lineage.rawRevisionId,
    adapterId: 'fixture.cli',
    adapterKind: 'cli',
    adapterVersion: '1.0.0',
    workflowRunId,
    sourceId,
    companyName: 'Fixture Robotics',
    roleTitle: 'Engineer',
    roleKind: 'full_time',
    workMode: 'remote',
    mergeStatus: 'new',
    discoveredAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  })
  return findingId
}

async function closeOnce(client: PgliteClient | null, closed: Set<PgliteClient>) {
  if (client && !closed.has(client)) {
    closed.add(client)
    await client.close()
  }
}
