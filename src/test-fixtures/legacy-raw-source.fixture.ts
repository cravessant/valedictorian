import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFileDatabase, migrateDatabase } from '../db/sqlite'

export const LEGACY_MIXED_RAW_RECORD_ID = 'legacy-mixed-record'
export const LEGACY_INVALID_ONLY_RAW_RECORD_ID = 'legacy-invalid-only-record'
export const LEGACY_MIXED_LATEST_CONNECTOR_RECORD_ID = 'legacy-mixed-latest-connector-record'
export const LEGACY_MIXED_LATEST_IMPORT_RECORD_ID = 'legacy-mixed-latest-import-record'
export const LEGACY_VALID_CONNECTOR_RECORD_ID = 'legacy-valid-connector-record'
export const LEGACY_NESTED_JOBRIGHT_RAW_RECORD_ID = 'legacy-nested-jobright-record'

export const LEGACY_NESTED_JOBRIGHT_PAYLOAD = {
  decodingStatus: 'valid',
  rawType: 'object',
  providerJobId: 'consigli-coop-2027',
  providerRow: {
    jobResult: {
      jobId: 'consigli-coop-2027',
      jobTitle: 'IT Co-op (Spring 2027)',
    },
    companyResult: {
      companyName: 'Consigli Construction Co., Inc.',
    },
  },
} as const

const AT = '2026-07-10T12:00:00.000Z'

export function createLegacyRawSourceFixture(
  sqlitePath: string,
  options: { includeInvalidOnly?: boolean } = {},
) {
  const database = createFileDatabase(sqlitePath)
  migrateDatabase(database, { migrationsFolder: migrationFolderThrough(25) })
  seedConnectorOwner(database)
  seedConnectorRecord(database, LEGACY_MIXED_RAW_RECORD_ID, true)
  seedValidConnectorRecord(database, LEGACY_VALID_CONNECTOR_RECORD_ID)
  seedNestedJobrightRecord(database, LEGACY_NESTED_JOBRIGHT_RAW_RECORD_ID)
  seedMixedAdapterRecord(database, LEGACY_MIXED_LATEST_CONNECTOR_RECORD_ID, 'connector')
  seedMixedAdapterRecord(database, LEGACY_MIXED_LATEST_IMPORT_RECORD_ID, 'import')
  if (options.includeInvalidOnly) {
    seedConnectorRecord(database, LEGACY_INVALID_ONLY_RAW_RECORD_ID, false)
  }
  seedUncapturedRecord(database, 'legacy-manual-record', 'manual')
  seedUncapturedRecord(database, 'legacy-cli-record', 'cli')
  seedUncapturedRecord(database, 'legacy-import-record', 'import')
  seedNormalization(
    database,
    LEGACY_MIXED_RAW_RECORD_ID,
    `${LEGACY_MIXED_RAW_RECORD_ID}-valid-occurrence`,
    'legacy',
  )
  seedNormalization(
    database,
    LEGACY_VALID_CONNECTOR_RECORD_ID,
    `${LEGACY_VALID_CONNECTOR_RECORD_ID}-occurrence`,
    'valid',
  )
  seedUnresolvedReplayItems(database)
  database.close()
}

function seedValidConnectorRecord(
  database: ReturnType<typeof createFileDatabase>,
  rawRecordId: string,
) {
  const revisionId = `${rawRecordId}-revision`
  database.exec(`
    insert into source_entities (id, identity_kind, identity_namespace, identity_value, created_at)
    values ('${rawRecordId}-entity', 'provider_job', 'fixture.connector:jobs@1',
      '${rawRecordId}-provider', '${AT}');
    insert into raw_source_records (id, source_entity_id, created_at)
    values ('${rawRecordId}', '${rawRecordId}-entity', '${AT}');
    insert into raw_source_revisions (
      id, raw_record_id, revision, content_hash, adapter_id, adapter_kind, adapter_version,
      observed_at, provider_record_id, provider_schema, payload_json, evidence_json, created_at
    ) values (
      '${revisionId}', '${rawRecordId}', 1, 'sha256:${rawRecordId}', 'fixture.connector',
      'connector', '1.0.0', '${AT}', '${rawRecordId}-provider', 'jobs@1',
      '{"title":"Platform Engineer","company":"Fixture Robotics"}', '[]', '${AT}'
    );
    insert into raw_source_occurrences (
      id, raw_record_id, raw_revision_id, connector_instance_id, connector_run_id,
      execution_scope_id, observed_at, received_at
    ) values (
      '${rawRecordId}-occurrence', '${rawRecordId}', '${revisionId}', 'legacy-connector',
      'legacy-connector-run', 'scope-legacy-connector', '${AT}', '${AT}'
    );
  `)
}

function seedNestedJobrightRecord(
  database: ReturnType<typeof createFileDatabase>,
  rawRecordId: string,
) {
  const revisionId = `${rawRecordId}-revision`
  database.prepare(`
    insert into source_entities (id, identity_kind, identity_namespace, identity_value, created_at)
    values (?, 'provider_job', 'jobright:jobright-visitor-list@1', ?, ?)
  `).run(`${rawRecordId}-entity`, 'consigli-coop-2027', AT)
  database.prepare(`
    insert into raw_source_records (id, source_entity_id, created_at)
    values (?, ?, ?)
  `).run(rawRecordId, `${rawRecordId}-entity`, AT)
  database.prepare(`
    insert into raw_source_revisions (
      id, raw_record_id, revision, content_hash, adapter_id, adapter_kind, adapter_version,
      observed_at, provider_record_id, provider_schema, payload_json, evidence_json, created_at
    ) values (?, ?, 1, ?, 'jobright', 'connector', '0.11.0', ?, 'consigli-coop-2027',
      'jobright-visitor-list@1', ?, '[]', ?)
  `).run(
    revisionId,
    rawRecordId,
    `sha256:${rawRecordId}`,
    AT,
    JSON.stringify(LEGACY_NESTED_JOBRIGHT_PAYLOAD),
    AT,
  )
  database.prepare(`
    insert into raw_source_occurrences (
      id, raw_record_id, raw_revision_id, connector_instance_id, connector_run_id,
      execution_scope_id, observed_at, received_at
    ) values (?, ?, ?, 'legacy-connector', 'legacy-connector-run',
      'scope-legacy-connector', ?, ?)
  `).run(`${rawRecordId}-occurrence`, rawRecordId, revisionId, AT, AT)
}

function seedMixedAdapterRecord(
  database: ReturnType<typeof createFileDatabase>,
  rawRecordId: string,
  latestKind: 'connector' | 'import',
) {
  const firstKind = latestKind === 'connector' ? 'import' : 'connector'
  const adapter = (kind: 'connector' | 'import') => `fixture.${kind}`
  database.exec(`
    insert into raw_source_records (id, source_entity_id, created_at)
    values ('${rawRecordId}', null, '${AT}');
    insert into raw_source_revisions (
      id, raw_record_id, revision, content_hash, adapter_id, adapter_kind, adapter_version,
      observed_at, payload_json, evidence_json, created_at
    ) values
      ('${rawRecordId}-revision-1', '${rawRecordId}', 1, 'sha256:${rawRecordId}:1',
        '${adapter(firstKind)}', '${firstKind}', '1.0.0', '${AT}', '{}', '[]', '${AT}'),
      ('${rawRecordId}-revision-2', '${rawRecordId}', 2, 'sha256:${rawRecordId}:2',
        '${adapter(latestKind)}', '${latestKind}', '1.0.0', '2026-07-10T12:01:00.000Z',
        '{}', '[]', '2026-07-10T12:01:00.000Z');
  `)
  for (const [revision, kind] of [[1, firstKind], [2, latestKind]] as const) {
    const occurrenceAt = revision === 1 ? AT : '2026-07-10T12:01:00.000Z'
    const captureColumns = kind === 'connector'
      ? ', connector_instance_id, connector_run_id, execution_scope_id'
      : ''
    const captureValues = kind === 'connector'
      ? ", 'legacy-connector', 'legacy-connector-run', 'scope-legacy-connector'"
      : ''
    database.exec(`insert into raw_source_occurrences (
      id, raw_record_id, raw_revision_id, observed_at, received_at${captureColumns}
    ) values (
      '${rawRecordId}-occurrence-${revision}', '${rawRecordId}', '${rawRecordId}-revision-${revision}',
      '${occurrenceAt}', '${occurrenceAt}'${captureValues}
    )`)
  }
}

function migrationFolderThrough(maxIndex: number) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), `raw-source-through-${maxIndex}-`))
  fs.cpSync(path.resolve('drizzle'), folder, { recursive: true })
  for (const name of fs.readdirSync(folder)) {
    const index = Number.parseInt(name.slice(0, 4), 10)
    if (Number.isInteger(index) && index > maxIndex) fs.rmSync(path.join(folder, name))
  }
  const journalPath = path.join(folder, 'meta', '_journal.json')
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ idx: number }>
  }
  journal.entries = journal.entries.filter(({ idx }) => idx <= maxIndex)
  fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`)
  return folder
}

function seedConnectorOwner(database: ReturnType<typeof createFileDatabase>) {
  database.exec(`
    insert into source_execution_scopes (id, created_at, updated_at)
    values ('scope-legacy-connector', '${AT}', '${AT}');
    insert into connector_instances (
      id, execution_scope_id, connector_id, connector_version, display_name, enabled,
      config_json, auth_json, filters_json, created_at, updated_at
    ) values (
      'legacy-connector', 'scope-legacy-connector', 'fixture.connector', '1.0.0',
      'Fixture connector', 1, '{}', '[]', '{}', '${AT}', '${AT}'
    );
    insert into connector_runs (
      id, execution_scope_id, connector_instance_id, mode, status, started_at, completed_at,
      config_json, filters_json, filter_signature, observation_count, warning_count,
      stats_json, warnings_json, retry_hints_json, created_at, updated_at
    ) values (
      'legacy-connector-run', 'scope-legacy-connector', 'legacy-connector', 'manual',
      'completed', '${AT}', '${AT}', '{}', '{}', 'filters:{}', 2, 0,
      '{}', '[]', '{}', '${AT}', '${AT}'
    );
  `)
}

function seedConnectorRecord(
  database: ReturnType<typeof createFileDatabase>,
  rawRecordId: string,
  includeValidOccurrence: boolean,
) {
  const revisionId = `${rawRecordId}-revision`
  database.exec(`
    insert into source_entities (id, identity_kind, identity_namespace, identity_value, created_at)
    values ('${rawRecordId}-entity', 'provider_job', 'fixture.connector:jobs@1',
      '${rawRecordId}-provider', '${AT}');
    insert into raw_source_records (id, source_entity_id, created_at)
    values ('${rawRecordId}', '${rawRecordId}-entity', '${AT}');
    insert into raw_source_revisions (
      id, raw_record_id, revision, content_hash, adapter_id, adapter_kind, adapter_version,
      observed_at, provider_record_id, provider_schema, payload_json, evidence_json, created_at
    ) values (
      '${revisionId}', '${rawRecordId}', 1, 'sha256:${rawRecordId}', 'fixture.connector',
      'connector', '1.0.0', '${AT}', '${rawRecordId}-provider', 'jobs@1',
      '{"title":"Platform Engineer","company":"Fixture Robotics"}', '[]', '${AT}'
    );
    insert into source_entity_identities (
      id, source_entity_id, identity_kind, identity_namespace, identity_value,
      provenance_kind, provenance_version, evidence_json, raw_revision_id, created_at
    ) values (
      '${rawRecordId}-identity', '${rawRecordId}-entity', 'provider_job',
      'fixture.connector:jobs@1', '${rawRecordId}-provider', 'capture',
      'raw-source-capture/v1', '{}', '${revisionId}', '${AT}'
    );
    insert into raw_source_occurrences (
      id, raw_record_id, raw_revision_id, observed_at, received_at
    ) values (
      '${rawRecordId}-invalid-occurrence', '${rawRecordId}', '${revisionId}', '${AT}', '${AT}'
    );
  `)
  if (!includeValidOccurrence) return
  database.prepare(`
    insert into raw_source_occurrences (
      id, raw_record_id, raw_revision_id, connector_instance_id, connector_run_id,
      execution_scope_id, observed_at, received_at
    ) values (?, ?, ?, 'legacy-connector', 'legacy-connector-run',
      'scope-legacy-connector', ?, ?)
  `).run(`${rawRecordId}-valid-occurrence`, rawRecordId, revisionId, AT, '2026-07-10T12:01:00.000Z')
}

function seedUncapturedRecord(
  database: ReturnType<typeof createFileDatabase>,
  rawRecordId: string,
  adapterKind: 'manual' | 'cli' | 'import',
) {
  database.exec(`
    insert into raw_source_records (id, source_entity_id, created_at)
    values ('${rawRecordId}', null, '${AT}');
    insert into raw_source_revisions (
      id, raw_record_id, revision, content_hash, adapter_id, adapter_kind, adapter_version,
      observed_at, payload_json, evidence_json, created_at
    ) values (
      '${rawRecordId}-revision', '${rawRecordId}', 1, 'sha256:${rawRecordId}',
      'fixture.${adapterKind}', '${adapterKind}', '1.0.0', '${AT}', '{}', '[]', '${AT}'
    );
    insert into raw_source_occurrences (
      id, raw_record_id, raw_revision_id, observed_at, received_at
    ) values (
      '${rawRecordId}-occurrence', '${rawRecordId}', '${rawRecordId}-revision', '${AT}', '${AT}'
    );
  `)
}

function seedNormalization(
  database: ReturnType<typeof createFileDatabase>,
  rawRecordId: string,
  occurrenceId: string,
  idPrefix: string,
) {
  const gate = JSON.stringify({
    status: 'needs_enrichment', policyVersion: 'normalization-gate@1',
    requiredFields: ['companyName', 'roleTitle', 'destinationUrl'],
    missingFields: ['destinationUrl'], conflictingFields: [],
    reason: 'Destination URL is missing.', evaluatedAt: '2026-07-10T12:02:00.000Z',
    candidate: null,
  })
  const resolver = JSON.stringify({
    id: 'fixture.raw', version: '1.0.0', scopeRequirement: 'source',
    requiredInputs: ['payload'], outputFields: ['roleTitle'], capabilities: ['pure'],
    costClass: 'none', precedence: 100,
  })
  const outcome = JSON.stringify({
    resolverId: 'fixture.raw', resolverVersion: '1.0.0', field: 'roleTitle',
    inputHash: 'sha256:normalization-input', status: 'resolved',
    value: 'Platform Engineer', confidence: 1, authoritative: true,
  })
  database.prepare(`
    insert into normalization_runs (
      id, raw_record_id, raw_revision_id, trigger_occurrence_id,
      trigger_connector_instance_id, trigger_connector_run_id, input_hash, resolver_set_hash,
      canonical_schema_version, gate_policy_version, trigger_kind, status, created_at, updated_at
    ) values (
      ?, ?, ?, ?, 'legacy-connector', 'legacy-connector-run',
      'sha256:normalization-input', 'sha256:resolver-set', 'canonical-source@1',
      'normalization-gate@1', 'intake', 'completed', ?, ?
    )
  `).run(
    `${idPrefix}-normalization`,
    rawRecordId,
    `${rawRecordId}-revision`,
    occurrenceId,
    AT,
    '2026-07-10T12:02:00.000Z',
  )
  database.prepare(`
    insert into normalization_attempts (
      id, run_id, raw_revision_id, sequence, resolver_id, resolver_version, input_hash,
      declaration_json, applicability_json, status, started_at, completed_at
    ) values (?, ?, ?, 0, 'fixture.raw', '1.0.0',
      'sha256:normalization-input', ?, '[]', 'completed', ?, ?)
  `).run(
    `${idPrefix}-attempt`,
    `${idPrefix}-normalization`,
    `${rawRecordId}-revision`,
    resolver,
    AT,
    '2026-07-10T12:01:00.000Z',
  )
  database.prepare(`
    insert into normalization_field_outcomes (
      id, run_id, attempt_id, sequence, attempt_sequence, outcome_index, field, status,
      resolver_id, resolver_version, input_hash, outcome_json
    ) values (?, ?, ?, 0, 0, 0,
      'roleTitle', 'resolved', 'fixture.raw', '1.0.0', 'sha256:normalization-input', ?)
  `).run(`${idPrefix}-outcome`, `${idPrefix}-normalization`, `${idPrefix}-attempt`, outcome)
  database.prepare(`
    insert into normalization_gates (
      id, run_id, policy_version, status, candidate_id, gate_json, evaluated_at
    ) values (?, ?, 'normalization-gate@1',
      'needs_enrichment', null, ?, '2026-07-10T12:02:00.000Z')
  `).run(`${idPrefix}-gate`, `${idPrefix}-normalization`, gate)
}

function seedUnresolvedReplayItems(database: ReturnType<typeof createFileDatabase>) {
  for (const status of ['pending', 'failed'] as const) {
    database.prepare(`insert into normalization_replay_requests (
      id, selector_json, invalidation_json, target_versions_json, field_directives_json,
      status, accepted_at, completed_at
    ) values (?, '{}', '{}', null, '[]', ?, ?, ?)`).run(
      `legacy-${status}-replay`,
      status === 'pending' ? 'accepted' : 'completed_with_failures',
      AT,
      status === 'pending' ? null : AT,
    )
    database.prepare(`insert into normalization_replay_items (
      id, replay_id, raw_record_id, raw_revision_id, input_hash, sequence, status,
      normalization_run_id, failure_json, completed_at
    ) values (?, ?, ?, ?, 'sha256:replay', 0, ?, null, ?, ?)`).run(
      `legacy-${status}-replay-item`,
      `legacy-${status}-replay`,
      LEGACY_MIXED_RAW_RECORD_ID,
      `${LEGACY_MIXED_RAW_RECORD_ID}-revision`,
      status,
      status === 'pending' ? null : '{"code":"normalization_failed","retryable":false}',
      status === 'pending' ? null : AT,
    )
  }
}
