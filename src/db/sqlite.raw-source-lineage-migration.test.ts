import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  rawSourceNormalizationResultSchema,
  rawSourceProjectionResultSchema,
  rawSourceRecordSchema,
} from 'sparxie'
import { describe, expect, it } from 'vitest'
import { createDrizzleDatabase, createFileDatabase, migrateDatabase } from './sqlite'
import { createSqliteRawSourceRepository } from '../modules/sourcing/raw-source.repository'
import { createSqliteNormalizationRepository } from '../modules/sourcing/normalization.repository'
import { createSqliteProjectionOutcomeRepository } from '../modules/sourcing/projection-outcome.repository'
import {
  createLegacyRawSourceFixture,
  LEGACY_INVALID_ONLY_RAW_RECORD_ID,
  LEGACY_MIXED_LATEST_CONNECTOR_RECORD_ID,
  LEGACY_MIXED_LATEST_IMPORT_RECORD_ID,
  LEGACY_MIXED_RAW_RECORD_ID,
  LEGACY_VALID_CONNECTOR_RECORD_ID,
} from '../test-fixtures/legacy-raw-source.fixture'

describe('legacy connector raw-source lineage migration', () => {
  it('drops every record whose occurrences disagree with its latest adapter contract', async () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'raw-lineage-migration-')),
      'valedictorian.sqlite',
    )
    createLegacyRawSourceFixture(sqlitePath, { includeInvalidOnly: true })
    const sqlite = createFileDatabase(sqlitePath)
    const legacyRepository = createSqliteRawSourceRepository(createDrizzleDatabase(sqlite))
    for (const rawRecordId of [
      LEGACY_MIXED_LATEST_CONNECTOR_RECORD_ID,
      LEGACY_MIXED_LATEST_IMPORT_RECORD_ID,
    ]) {
      const parsed = rawSourceRecordSchema.safeParse(await legacyRepository.get(rawRecordId))
      expect(parsed.success).toBe(false)
      if (!parsed.success) {
        expect(parsed.error.issues).toEqual(expect.arrayContaining([
          expect.objectContaining({
            message: 'raw record revision, adapter, occurrence, and capture lineage must agree',
          }),
        ]))
      }
    }

    migrateDatabase(sqlite)

    const repository = createSqliteRawSourceRepository(createDrizzleDatabase(sqlite))
    await expect(repository.get(LEGACY_MIXED_RAW_RECORD_ID)).resolves.toBeNull()
    await expect(repository.get(LEGACY_INVALID_ONLY_RAW_RECORD_ID)).resolves.toBeNull()
    await expect(repository.get(LEGACY_MIXED_LATEST_CONNECTOR_RECORD_ID)).resolves.toBeNull()
    await expect(repository.get(LEGACY_MIXED_LATEST_IMPORT_RECORD_ID)).resolves.toBeNull()
    const validConnector = await repository.get(LEGACY_VALID_CONNECTOR_RECORD_ID)
    expect(() => rawSourceRecordSchema.parse(validConnector)).not.toThrow()
    for (const kind of ['manual', 'cli', 'import']) {
      const detail = await repository.get(`legacy-${kind}-record`)
      expect(() => rawSourceRecordSchema.parse(detail)).not.toThrow()
      expect(detail).toMatchObject({
        adapter: { kind },
        occurrences: [expect.objectContaining({ capture: null })],
      })
    }
    expect(sqlite.prepare(`
      select count(*) as count
      from raw_source_occurrences occurrence
      join raw_source_revisions revision on revision.id = occurrence.raw_revision_id
      where revision.adapter_kind = 'connector'
        and (occurrence.connector_instance_id is null
          or occurrence.connector_run_id is null
          or occurrence.execution_scope_id is null)
    `).get()).toEqual({ count: 0 })
    expect(sqlite.prepare('pragma foreign_key_check').all()).toEqual([])
    sqlite.close()
  })

  it('removes pending and failed replay items without normalization runs for a doomed record', () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'raw-lineage-replay-migration-')),
      'valedictorian.sqlite',
    )
    createLegacyRawSourceFixture(sqlitePath)
    const sqlite = createFileDatabase(sqlitePath)
    expect(sqlite.prepare(`select status, normalization_run_id from normalization_replay_items
      where id like 'legacy-%-replay-item' order by status`).all()).toEqual([
      { status: 'failed', normalization_run_id: null },
      { status: 'pending', normalization_run_id: null },
    ])

    migrateDatabase(sqlite)

    expect(sqlite.prepare(`select count(*) as count from normalization_replay_items
      where id like 'legacy-%-replay-item'`).get()).toEqual({ count: 0 })
    expect(sqlite.prepare(`select id from normalization_replay_requests
      where id like 'legacy-%-replay' order by id`).all()).toEqual([
      { id: 'legacy-failed-replay' },
      { id: 'legacy-pending-replay' },
    ])
    expect(sqlite.prepare('pragma foreign_key_check').all()).toEqual([])
    sqlite.close()
  })

  it('leaves every valid raw record row byte-for-byte unchanged', () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'raw-lineage-valid-preservation-')),
      'valedictorian.sqlite',
    )
    createLegacyRawSourceFixture(sqlitePath)
    const sqlite = createFileDatabase(sqlitePath)
    const validIds = [
      LEGACY_VALID_CONNECTOR_RECORD_ID,
      'legacy-manual-record',
      'legacy-cli-record',
      'legacy-import-record',
    ]
    const before = snapshotRawRecords(sqlite, validIds)

    migrateDatabase(sqlite)

    expect(snapshotRawRecords(sqlite, validIds)).toEqual(before)
    expect(sqlite.prepare('pragma foreign_key_check').all()).toEqual([])
    sqlite.close()
  })

  it('removes a referenced invalid occurrence with its entire dependent raw graph', async () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'raw-lineage-referenced-migration-')),
      'valedictorian.sqlite',
    )
    createLegacyRawSourceFixture(sqlitePath)
    const sqlite = createFileDatabase(sqlitePath)
    sqlite.prepare(`insert into raw_source_occurrences (
      id, raw_record_id, raw_revision_id, connector_instance_id, connector_run_id,
      execution_scope_id, observed_at, received_at
    ) values (?, ?, ?, 'legacy-connector', 'legacy-connector-run',
      'scope-legacy-connector', '2026-07-10T12:03:00.000Z', '2026-07-10T12:03:00.000Z')`).run(
      `${LEGACY_MIXED_RAW_RECORD_ID}-fallback-occurrence`,
      LEGACY_MIXED_RAW_RECORD_ID,
      `${LEGACY_MIXED_RAW_RECORD_ID}-revision`,
    )
    const triggerNames = [
      'trg_raw_source_occurrences_normalization_lineage_update',
      'trg_raw_source_occurrences_normalization_lineage_delete',
    ]
    const triggerDefinitions = sqlite.prepare(`select sql from sqlite_master
      where type = 'trigger' and name in (?, ?) order by name`).all(...triggerNames) as Array<{ sql: string }>
    for (const name of triggerNames) sqlite.exec(`drop trigger ${name}`)
    sqlite.prepare(`update raw_source_occurrences
      set connector_instance_id = null, connector_run_id = null, execution_scope_id = null
      where id = ?`).run(`${LEGACY_MIXED_RAW_RECORD_ID}-valid-occurrence`)
    for (const { sql } of triggerDefinitions) sqlite.exec(sql)

    expect(() => migrateDatabase(sqlite)).not.toThrow()
    expect(sqlite.prepare("select count(*) as count from normalization_runs where id = 'legacy-normalization'").get())
      .toEqual({ count: 0 })
    expect(sqlite.prepare('select id from raw_source_occurrences where raw_record_id = ?').all(
      LEGACY_MIXED_RAW_RECORD_ID,
    )).toEqual([])
    expect(sqlite.prepare('select count(*) as count from raw_source_records where id = ?').get(
      LEGACY_MIXED_RAW_RECORD_ID,
    )).toEqual({ count: 0 })
    expect(sqlite.prepare('pragma foreign_key_check').all()).toEqual([])
    sqlite.close()
  })

  it('preserves a valid import graph that shares the doomed connector source entity', async () => {
    const sqlitePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'raw-lineage-shared-entity-migration-')),
      'valedictorian.sqlite',
    )
    createLegacyRawSourceFixture(sqlitePath)
    const sqlite = createFileDatabase(sqlitePath)
    seedSharedSurvivingGraph(sqlite)

    expect(() => migrateDatabase(sqlite)).not.toThrow()

    const database = createDrizzleDatabase(sqlite)
    const raw = await createSqliteRawSourceRepository(database).get('shared-import-record')
    const normalization = createSqliteNormalizationRepository(database)
      .getLatest('shared-import-record')
    const projection = createSqliteProjectionOutcomeRepository(database)
      .get('shared-import-revision')
    const { triggerOccurrence: _triggerOccurrence, ...publicNormalization } = normalization!
    expect(() => rawSourceRecordSchema.parse(raw)).not.toThrow()
    expect(() => rawSourceNormalizationResultSchema.parse(publicNormalization)).not.toThrow()
    expect(() => rawSourceProjectionResultSchema.parse(projection)).not.toThrow()
    expect(sqlite.prepare('select id from raw_source_records where id = ?').get(
      LEGACY_MIXED_RAW_RECORD_ID,
    )).toBeUndefined()
    expect(sqlite.prepare(`select id from source_entities
      where id = 'legacy-mixed-record-entity'`).get()).toEqual({
      id: 'legacy-mixed-record-entity',
    })
    expect(sqlite.prepare(`select id from source_entity_identities
      where id = 'shared-import-identity'`).get()).toEqual({ id: 'shared-import-identity' })
    expect(sqlite.prepare(`select id from source_identity_conflicts
      where id = 'shared-import-conflict'`).get()).toEqual({ id: 'shared-import-conflict' })
    expect(sqlite.prepare(`select id from canonical_source_candidates
      where id = 'shared-import-candidate'`).get()).toEqual({ id: 'shared-import-candidate' })
    expect(sqlite.prepare(`select id from sourcing_findings
      where id = 'shared-import-finding'`).get()).toEqual({ id: 'shared-import-finding' })
    expect(sqlite.prepare('pragma foreign_key_check').all()).toEqual([])
    expect(sqlite.prepare('select count(*) as count from __drizzle_migrations').get())
      .toEqual({ count: 27 })
    const protectedTables = [
      ['source_entity_identities', 'shared-import-identity'],
      ['source_identity_conflicts', 'shared-import-conflict'],
      ['sourcing_projection_outcomes', 'shared-import-projection'],
    ] as const
    for (const [table, id] of protectedTables) {
      expect(() => sqlite.prepare(`delete from ${table} where id = ?`).run(id))
        .toThrow('append-only')
    }
    sqlite.close()
  })
})

function snapshotRawRecords(
  sqlite: ReturnType<typeof createFileDatabase>,
  rawRecordIds: string[],
) {
  const placeholders = rawRecordIds.map(() => '?').join(', ')
  return {
    records: sqlite.prepare(`select * from raw_source_records
      where id in (${placeholders}) order by id`).all(...rawRecordIds),
    revisions: sqlite.prepare(`select * from raw_source_revisions
      where raw_record_id in (${placeholders}) order by raw_record_id, revision`).all(...rawRecordIds),
    occurrences: sqlite.prepare(`select * from raw_source_occurrences
      where raw_record_id in (${placeholders}) order by raw_record_id, id`).all(...rawRecordIds),
  }
}

function seedSharedSurvivingGraph(sqlite: ReturnType<typeof createFileDatabase>) {
  const at = '2026-07-10T13:00:00.000Z'
  const candidate = JSON.stringify({
    id: 'shared-import-candidate', sourceEntityId: 'legacy-mixed-record-entity',
    rawRecordId: 'shared-import-record', rawRevisionId: 'shared-import-revision',
    schemaVersion: 'canonical-source@1',
    canonicalIdentity: { kind: 'provider_job', value: 'shared-import-provider' },
    companyName: 'Shared Import Co', roleTitle: 'Shared Import Role',
    employmentType: 'full_time', seniority: 'mid_level', workMode: 'remote',
    location: null, compensation: null,
    postedAt: { value: null, precision: 'unknown', raw: null },
    destination: { class: 'employer_or_ats', url: 'https://jobs.example.test/shared' },
    sourceUrl: null, providerJobId: 'shared-import-provider', observedAt: at,
  })
  const gate = JSON.stringify({
    status: 'passed', policyVersion: 'normalization-gate@1',
    requiredFields: ['companyName', 'roleTitle', 'destinationUrl'],
    missingFields: [], conflictingFields: [], reason: 'Required fields are resolved.',
    evaluatedAt: at,
    candidate: {
      id: 'shared-import-candidate', sourceEntityId: 'legacy-mixed-record-entity',
      rawRecordId: 'shared-import-record', rawRevisionId: 'shared-import-revision',
      schemaVersion: 'canonical-source@1',
    },
  })
  sqlite.prepare(`insert into source_entities (
    id, identity_kind, identity_namespace, identity_value, created_at
  ) values ('shared-conflicting-entity', 'destination_url', 'fixture',
    'https://jobs.example.test/conflict', ?)`).run(at)
  sqlite.prepare(`insert into raw_source_records (id, source_entity_id, created_at)
    values ('shared-import-record', null, ?)`).run(at)
  sqlite.prepare(`insert into raw_source_revisions (
    id, raw_record_id, revision, content_hash, adapter_id, adapter_kind, adapter_version,
    observed_at, provider_record_id, provider_schema, payload_json, evidence_json, created_at
  ) values ('shared-import-revision', 'shared-import-record', 1, 'sha256:shared-import',
    'fixture.import', 'import', '1.0.0', ?, 'shared-import-provider', 'jobs@1',
    '{"title":"Shared Import Role","company":"Shared Import Co"}', '[]', ?)`).run(at, at)
  sqlite.prepare(`insert into raw_source_occurrences (
    id, raw_record_id, raw_revision_id, observed_at, received_at
  ) values ('shared-import-occurrence', 'shared-import-record', 'shared-import-revision', ?, ?)`)
    .run(at, at)
  sqlite.prepare(`insert into source_entity_identities (
    id, source_entity_id, identity_kind, identity_namespace, identity_value,
    provenance_kind, provenance_version, evidence_json, raw_revision_id, created_at
  ) values ('shared-import-identity', 'legacy-mixed-record-entity', 'canonical_destination',
    'canonicalized-job-destination/v1', 'https://jobs.example.test/shared', 'normalization',
    'source-identity-reconciliation/v1', '{}', 'shared-import-revision', ?)`).run(at)
  sqlite.prepare(`insert into source_identity_conflicts (
    id, source_entity_id, conflicting_source_entity_id, raw_revision_id, identity_kind,
    identity_namespace, identity_value, reason, provenance_version, evidence_json, created_at
  ) values ('shared-import-conflict', 'legacy-mixed-record-entity', 'shared-conflicting-entity',
    'shared-import-revision', 'canonical_destination', 'canonicalized-job-destination/v1',
    'https://jobs.example.test/shared', 'Fixture conflict',
    'source-identity-reconciliation/v1', '{}', ?)`).run(at)
  sqlite.prepare(`insert into normalization_runs (
    id, raw_record_id, raw_revision_id, input_hash, resolver_set_hash,
    canonical_schema_version, gate_policy_version, trigger_kind, status, created_at, updated_at
  ) values ('shared-import-normalization', 'shared-import-record', 'shared-import-revision',
    'sha256:shared-input', 'sha256:shared-resolvers',
    'canonical-source@1', 'normalization-gate@1', 'intake', 'completed', ?, ?)`).run(at, at)
  sqlite.prepare(`insert into canonical_source_candidates (
    id, run_id, source_entity_id, raw_record_id, raw_revision_id, schema_version,
    candidate_json, created_at
  ) values ('shared-import-candidate', 'shared-import-normalization',
    'legacy-mixed-record-entity', 'shared-import-record', 'shared-import-revision',
    'canonical-source@1', ?, ?)`).run(candidate, at)
  sqlite.prepare(`insert into normalization_gates (
    id, run_id, policy_version, status, candidate_id, gate_json, evaluated_at
  ) values ('shared-import-gate', 'shared-import-normalization', 'normalization-gate@1',
    'passed', 'shared-import-candidate', ?, ?)`).run(gate, at)
  sqlite.prepare(`insert into sources (id, name, created_at, updated_at)
    values ('shared-import-source', 'Shared Import', ?, ?)`).run(at, at)
  sqlite.prepare(`insert into workflow_runs (
    id, run_type, status, actor_type, source_id, started_at, completed_at,
    input_json, metadata_json, created_at, updated_at
  ) values ('shared-import-workflow', 'sourcing', 'completed', 'system',
    'shared-import-source', ?, ?, '{}', '{}', ?, ?)`).run(at, at, at, at)
  sqlite.prepare(`insert into sourcing_findings (
    id, projection_identity_key, source_entity_id, canonical_candidate_id, raw_revision_id,
    adapter_id, adapter_kind, adapter_version, workflow_run_id, source_id, company_name,
    role_title, role_kind, work_mode, merge_status, discovered_at, created_at, updated_at
  ) values ('shared-import-finding', 'fixture:shared-import', 'legacy-mixed-record-entity',
    'shared-import-candidate', 'shared-import-revision', 'fixture.import', 'import', '1.0.0',
    'shared-import-workflow', 'shared-import-source', 'Shared Import Co', 'Shared Import Role',
    'full_time', 'remote', 'new', ?, ?, ?)`).run(at, at, at)
  sqlite.prepare(`insert into sourcing_projection_outcomes (
    id, raw_record_id, raw_revision_id, canonical_candidate_id, status, created_at, updated_at
  ) values ('shared-import-projection', 'shared-import-record', 'shared-import-revision',
    'shared-import-candidate', 'pending', ?, ?)`).run(at, at)
  sqlite.prepare(`update sourcing_projection_outcomes
    set status = 'projected', finding_id = 'shared-import-finding', projected_at = ?, updated_at = ?
    where id = 'shared-import-projection'`).run(at, at)
}
