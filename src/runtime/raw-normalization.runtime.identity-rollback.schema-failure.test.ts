import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { PgliteDatabase } from '../db/pglite'
import { createNormalizationOrchestrator } from '../modules/sourcing/normalization.orchestrator'
import { createPgliteNormalizationRepository } from '../modules/sourcing/normalization.repository'
import { createPgliteRawSourceRepository } from '../modules/sourcing/raw-source.repository'
import type { NormalizationResolver } from '../modules/sourcing/normalization.registry'
import {
  createDefaultNormalizationResolverRegistry,
  createNormalizationResolverRegistry,
} from '../modules/sourcing/normalization.registry'
import {
  createTestLocalValedictorianClient as createLocalValedictorianClient,
  createTestPgliteDatabase,
  getTestLocalValedictorianDatabase,
} from './local-valedictorian-client.test-harness'

describe('local deterministic raw normalization schema failures', () => {

  it('rolls back reconciliation when normalization run persistence fails', async () => {
    const pgliteDataPath = tempDatabasePath()
    const setup = await createTestPgliteDatabase(pgliteDataPath)
    await installFailureTrigger(
      setup.database,
      'normalization_runs',
      'fail_normalization_run',
      'fixture normalization run failure',
    )
    await setup.close()
    const client = await createLocalValedictorianClient({ pgliteDataPath })

    await expect(client.sourcing.rawRecords.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Acme', title: 'Intern', url: 'https://jobs.lever.co/acme/atomic-role' },
    }] })).resolves.toMatchObject({ receipts: [expect.objectContaining({ sourceEntityId: null })] })
    const database = getTestLocalValedictorianDatabase(client)
    expect(await normalizationPersistenceState(database)).toEqual({
      jobs: 0,
      identities: 0,
      conflicts: 0,
      runs: 0,
      attempts: 0,
      outcomes: 0,
      candidates: 0,
      gates: 0,
    })
    expect(await rawLedgerState(database)).toEqual({ records: 1, revisions: 1, occurrences: 1 })
  })
  it('rolls back late gate failure while preserving prior normalization history', async () => {
    const fixture = await createTestPgliteDatabase()
    const { database } = fixture
    const rawRepository = createPgliteRawSourceRepository(database)
    const orchestrator = createNormalizationOrchestrator({
      repository: createPgliteNormalizationRepository(database),
      registry: createDefaultNormalizationResolverRegistry(),
    })
    const prior = await rawRepository.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T11:00:00.000Z',
      payload: { company: 'Prior', title: 'Intern', url: 'https://jobs.lever.co/prior/role-1' },
    }] })
    await orchestrator.normalize(prior.receipts[0].rawRecordId, prior.receipts[0].revision.id)
    const before = await normalizationPersistenceState(database)
    const failing = await rawRepository.ingestBatch({ records: [{
      adapter: { id: 'manual.fixture', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z',
      payload: { company: 'Later', title: 'Intern', url: 'https://jobs.lever.co/later/role-2' },
    }] })
    await installFailureTrigger(
      database,
      'normalization_gates',
      'fail_normalization_gate',
      'fixture normalization gate failure',
    )

    await expect(orchestrator.normalize(
      failing.receipts[0].rawRecordId,
      failing.receipts[0].revision.id,
    )).rejects.toThrow(/Failed query: insert into "normalization_gates"/)
    expect(await normalizationPersistenceState(database)).toEqual(before)
    expect(await rawLedgerState(database)).toEqual({ records: 2, revisions: 2, occurrences: 2 })
    await fixture.close()
  })
  it('rolls back a conflict audit when its needs-enrichment gate fails', async () => {
    const fixture = await createTestPgliteDatabase()
    const { database } = fixture
    await database.execute(sql`
      insert into jobs (id, identity_kind, identity_namespace, identity_value, created_at)
      values ('preowner', 'provider_job', 'fixture', 'preowner-job', '2026-07-10T11:00:00.000Z')
    `)
    await database.execute(sql`
      insert into job_identities (
        id, job_id, identity_kind, identity_namespace, identity_value,
        provenance_kind, provenance_version, evidence_json, created_at
      ) values (
        'preowned-intermediary', 'preowner', 'intermediary_alias', 'job-intermediary/v1',
        'https://jobright.ai/jobs/info/shared-job', 'normalization',
        'source-identity-reconciliation/v1', '{}', '2026-07-10T11:00:00.000Z'
      )
    `)
    const rawRepository = createPgliteRawSourceRepository(database)
    const intake = await rawRepository.ingestBatch({ records: [{
      adapter: { id: 'manual.alpha', kind: 'manual', version: '1.0.0' },
      observedAt: '2026-07-10T12:00:00.000Z', providerRecordId: 'alpha-1', providerSchema: 'jobs/v1',
      payload: { company: 'Acme', title: 'Intern' },
    }] })
    const before = await normalizationPersistenceState(database)
    await installFailureTrigger(
      database,
      'normalization_gates',
      'fail_conflict_gate',
      'fixture conflict gate failure',
    )
    const orchestrator = createNormalizationOrchestrator({
      repository: createPgliteNormalizationRepository(database),
      registry: createNormalizationResolverRegistry([
        fixedDestinationResolver('https://jobright.ai/jobs/info/shared-job'),
        ...createDefaultNormalizationResolverRegistry().resolvers,
      ]),
    })

    await expect(orchestrator.normalize(
      intake.receipts[0].rawRecordId,
      intake.receipts[0].revision.id,
    )).rejects.toThrow(/Failed query: insert into "normalization_gates"/)
    expect(await normalizationPersistenceState(database)).toEqual(before)
    expect((await database.execute(sql`
      select count(*)::integer as count from job_identity_conflicts
    `)).rows[0]).toEqual({ count: 0 })
    await fixture.close()
  })
})

async function installFailureTrigger(
  database: PgliteDatabase,
  table: string,
  trigger: string,
  message: string,
) {
  await database.execute(sql.raw(`
    create function ${trigger}_fn() returns trigger as $$
    begin raise exception '${message}'; end;
    $$ language plpgsql
  `))
  await database.execute(sql.raw(`
    create trigger ${trigger} before insert on ${table}
    for each row execute function ${trigger}_fn()
  `))
}

async function normalizationPersistenceState(database: PgliteDatabase) {
  const count = async (table: string) => Number((await database.execute(
    sql.raw(`select count(*) as count from ${table}`),
  )).rows[0]?.count)
  return {
    jobs: await count('jobs'),
    identities: await count('job_identities'),
    conflicts: await count('job_identity_conflicts'),
    runs: await count('normalization_runs'),
    attempts: await count('normalization_attempts'),
    outcomes: await count('normalization_field_outcomes'),
    candidates: await count('job_fact_versions'),
    gates: await count('normalization_gates'),
  }
}

async function rawLedgerState(database: PgliteDatabase) {
  const count = async (table: string) => Number((await database.execute(
    sql.raw(`select count(*) as count from ${table}`),
  )).rows[0]?.count)
  return {
    records: await count('capture_lineages'),
    revisions: await count('capture_evidence_versions'),
    occurrences: await count('captures'),
  }
}

function tempDatabasePath() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'normalization-runtime-'))
}

function fixedDestinationResolver(intermediaryUrl: string): NormalizationResolver {
  return {
    declaration: {
      id: 'fixture.fixed-destination', version: '1.0.0', requiredInputs: ['rawRevision'],
      outputFields: ['destinationUrl'], capabilities: ['pure'], costClass: 'none', precedence: 1_000,
    },
    resolve(context) {
      const value = { class: 'employer_or_ats' as const, url: 'https://jobs.lever.co/acme/target-role', intermediaryUrl }
      return [{
        resolverId: 'fixture.fixed-destination', resolverVersion: '1.0.0', field: 'destinationUrl',
        inputHash: context.hashInput(value), status: 'resolved', value, confidence: 1, authoritative: true,
      }]
    },
  }
}
