/**
 * Capture aggregate schema (issue #298). Owned by the capture module.
 *
 * The clean cutover owns the canonical `captures` root and its relation tables.
 * Vocabulary mirrors the sparxie contract
 * (src/db/lifecycle-vocabulary.ts). Triggers are installed by the journaled
 * migration and are intentionally not modeled here (Drizzle does not model
 * triggers), matching the baseline pattern.
 */
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { FORBIDDEN_JSON_KEY_PREDICATE } from '../../db/sensitive-keys'
import { workspaces } from '../../db/workspaces.schema'

const FORBIDDEN_KEY = FORBIDDEN_JSON_KEY_PREDICATE

export const captures = pgTable(
  'captures',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
    evidenceMode: text('evidence_mode').notNull(),
    adapterId: text('adapter_id').notNull(),
    adapterKind: text('adapter_kind').notNull(),
    adapterVersion: text('adapter_version').notNull(),
    observedAt: text('observed_at').notNull(),
    receivedAt: text('received_at').notNull(),
    providerRecordId: text('provider_record_id'),
    providerSchema: text('provider_schema'),
    payloadJson: text('payload_json'),
    revision: integer('revision').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    removedAt: text('removed_at'),
    // #304: create-dedup key. Nullable + excluded from the partial index when null,
    // so migrated rows and keyless creates are inert; a keyed re-create converges to
    // the winning row via idx_captures_idempotency.
    idempotencyKey: text('idempotency_key'),
  },
  (table) => ({
    workspaceIdx: index('idx_lifecycle_captures_workspace').on(table.workspaceId, table.createdAt),
    idempotencyIdx: uniqueIndex('idx_lifecycle_captures_idempotency')
      .on(table.workspaceId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    idempotencyKeyCheck: check('chk_lifecycle_captures_idempotency_key', sql`${table.idempotencyKey} is null or length(${table.idempotencyKey}) between 1 and 200`),
    // #299: provenance identity resolves to exactly one Capture id forever. The
    // key includes provider_schema (coalesced) to match the legacy connector
    // lineage identity (adapterId, providerSchema, providerRecordId) — so the same
    // adapter re-observing a provider record under a bumped schema stays a distinct
    // capture, exactly as legacy semantics treated it, and 0001's schema-divergent
    // migrated rows do not collide. A partial unique lets manual captures (null
    // provider_record_id) coexist without colliding; connector/import re-observation
    // resolves idempotently to the existing Capture, including 0001-migrated rows
    // (which reused the legacy lineage id). The tombstone is NOT excluded: a removed
    // Capture keeps owning its provenance identity, so re-intake appends to it
    // without clearing removed_at.
    provenanceIdx: uniqueIndex('idx_lifecycle_captures_provenance')
      .on(table.workspaceId, table.adapterId, sql`coalesce(${table.providerSchema}, '')`, table.providerRecordId)
      .where(sql`${table.providerRecordId} is not null`),
    workspaceCheck: check('chk_lifecycle_captures_workspace', sql`length(${table.workspaceId}) between 1 and 200`),
    evidenceModeCheck: check('chk_lifecycle_captures_evidence_mode', sql`${table.evidenceMode} in ('reported','ats_details_provided')`),
    adapterKindCheck: check('chk_lifecycle_captures_adapter_kind', sql`${table.adapterKind} in ('connector','cli','manual','import')`),
    adapterVersionCheck: check('chk_lifecycle_captures_adapter_version', sql`length(${table.adapterVersion}) between 1 and 100`),
    providerRecordCheck: check('chk_lifecycle_captures_provider_record', sql`${table.providerRecordId} is null or length(${table.providerRecordId}) between 1 and 500`),
    providerSchemaCheck: check('chk_lifecycle_captures_provider_schema', sql`${table.providerSchema} is null or length(${table.providerSchema}) between 1 and 500`),
    payloadBoundCheck: check('chk_lifecycle_captures_payload_bound', sql`${table.payloadJson} is null or length(${table.payloadJson}) <= 262144`),
    payloadKeysCheck: check('chk_lifecycle_captures_payload_keys', sql`${table.payloadJson} is null or ${table.payloadJson} ${sql.raw(FORBIDDEN_KEY)}`),
    revisionCheck: check('chk_lifecycle_captures_revision', sql`${table.revision} > 0`),
  }),
)

export const captureRevisions = pgTable(
  'capture_revisions',
  {
    captureId: text('capture_id').notNull(),
    revision: integer('revision').notNull(),
    kind: text('kind').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    auditJson: text('audit_json').notNull(),
    connectorInstanceId: text('connector_instance_id'),
    connectorRunId: text('connector_run_id'),
    executionScopeId: text('execution_scope_id'),
    reportedOriginJson: text('reported_origin_json'),
    contentHash: text('content_hash'),
    // #325: the immutable observed connector input for this exact revision. Nullable so
    // historical revisions without a truthfully preserved raw input stay inert (replay
    // skips them rather than inventing input). Bounded + sanitized like captures.payload_json.
    payloadJson: text('payload_json'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: 'capture_revisions_pk', columns: [table.captureId, table.revision] }),
    captureFk: foreignKey({ name: 'fk_capture_revisions_capture', columns: [table.captureId], foreignColumns: [captures.id] }),
    revisionCheck: check('chk_capture_revisions_revision', sql`${table.revision} > 0`),
    kindCheck: check('chk_capture_revisions_kind', sql`${table.kind} in ('created','corrected','removed','restored')`),
    snapshotBoundCheck: check('chk_capture_revisions_snapshot_bound', sql`length(${table.snapshotJson}) <= 262144`),
    auditBoundCheck: check('chk_capture_revisions_audit_bound', sql`length(${table.auditJson}) <= 16384`),
    auditKeysCheck: check('chk_capture_revisions_audit_keys', sql`${table.auditJson} ${sql.raw(FORBIDDEN_KEY)}`),
    payloadBoundCheck: check('chk_capture_revisions_payload_bound', sql`${table.payloadJson} is null or length(${table.payloadJson}) <= 262144`),
    payloadKeysCheck: check('chk_capture_revisions_payload_keys', sql`${table.payloadJson} is null or ${table.payloadJson} ${sql.raw(FORBIDDEN_KEY)}`),
    connectorProvenanceCheck: check(
      'chk_capture_revisions_connector_provenance',
      sql`(${table.connectorInstanceId} is null and ${table.connectorRunId} is null and ${table.executionScopeId} is null and ${table.reportedOriginJson} is null) or (${table.connectorInstanceId} is not null and ${table.connectorRunId} is not null and ${table.executionScopeId} is not null)`,
    ),
    connectorRunIdx: index('idx_capture_revisions_connector_run').on(table.connectorRunId, table.captureId),
    contentHashIdx: uniqueIndex('idx_capture_revisions_content_hash')
      .on(table.captureId, table.contentHash)
      .where(sql`${table.contentHash} is not null`),
  }),
)

export const captureOccurrences = pgTable(
  'capture_occurrences',
  {
    id: text('id').primaryKey(),
    captureId: text('capture_id').notNull(),
    captureRevision: integer('capture_revision').notNull(),
    connectorInstanceId: text('connector_instance_id').notNull(),
    connectorRunId: text('connector_run_id').notNull(),
    executionScopeId: text('execution_scope_id').notNull(),
    observedAt: text('observed_at').notNull(),
    receivedAt: text('received_at').notNull(),
  },
  (table) => ({
    revisionFk: foreignKey({
      name: 'fk_capture_occurrences_revision',
      columns: [table.captureId, table.captureRevision],
      foreignColumns: [captureRevisions.captureId, captureRevisions.revision],
    }),
    connectorRunIdx: index('idx_capture_occurrences_connector_run').on(table.connectorRunId, table.captureId),
    captureIdx: index('idx_capture_occurrences_capture').on(table.captureId, table.captureRevision),
    revisionCheck: check('chk_capture_occurrences_revision', sql`${table.captureRevision} > 0`),
  }),
)

export const captureEvidenceItems = pgTable(
  'capture_evidence_items',
  {
    id: text('id').primaryKey(),
    captureId: text('capture_id').notNull(),
    captureRevision: integer('capture_revision').notNull(),
    evidenceIndex: integer('evidence_index').notNull(),
    kind: text('kind').notNull(),
    label: text('label').notNull(),
    valueJson: text('value_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    identityIdx: uniqueIndex('idx_capture_evidence_items_identity').on(table.captureId, table.captureRevision, table.evidenceIndex),
    revisionFk: foreignKey({
      name: 'fk_capture_evidence_items_revision',
      columns: [table.captureId, table.captureRevision],
      foreignColumns: [captureRevisions.captureId, captureRevisions.revision],
    }),
    revisionCheck: check('chk_capture_evidence_items_revision', sql`${table.captureRevision} > 0`),
    indexCheck: check('chk_capture_evidence_items_index', sql`${table.evidenceIndex} between 0 and 49`),
    kindCheck: check('chk_capture_evidence_items_kind', sql`length(${table.kind}) between 1 and 100`),
    labelCheck: check('chk_capture_evidence_items_label', sql`length(${table.label}) between 1 and 200`),
    valueBoundCheck: check('chk_capture_evidence_items_value_bound', sql`length(${table.valueJson}) <= 16384`),
    valueKeysCheck: check('chk_capture_evidence_items_value_keys', sql`${table.valueJson} ${sql.raw(FORBIDDEN_KEY)}`),
  }),
)

/**
 * Capture-owned provider-field resolution outcomes (issue #325).
 *
 * Bounded supporting evidence keyed to the immutable Capture revision plus the exact
 * resolver id/version, input hash, and field. Scheduling tables stay coordination-only;
 * the durable domain result lives here, owned by the Capture module. The composite
 * identity makes persistence idempotent: a crash after persisting outcomes but before
 * completing the scheduled work re-runs and converges via ON CONFLICT DO NOTHING rather
 * than duplicating rows. `outcomeJson` preserves the connector's status and every safe detail
 * that fits for one field, progressively degrading optional evidence within a strict bound.
 */
export const captureFieldOutcomes = pgTable(
  'capture_field_outcomes',
  {
    captureId: text('capture_id').notNull(),
    captureRevision: integer('capture_revision').notNull(),
    resolverId: text('resolver_id').notNull(),
    resolverVersion: text('resolver_version').notNull(),
    inputHash: text('input_hash').notNull(),
    field: text('field').notNull(),
    status: text('status').notNull(),
    outcomeJson: text('outcome_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({
      name: 'capture_field_outcomes_pk',
      columns: [table.captureId, table.captureRevision, table.resolverId, table.resolverVersion, table.inputHash, table.field],
    }),
    revisionFk: foreignKey({
      name: 'fk_capture_field_outcomes_revision',
      columns: [table.captureId, table.captureRevision],
      foreignColumns: [captureRevisions.captureId, captureRevisions.revision],
    }),
    revisionCheck: check('chk_capture_field_outcomes_revision', sql`${table.captureRevision} > 0`),
    resolverCheck: check(
      'chk_capture_field_outcomes_resolver',
      sql`length(${table.resolverId}) between 1 and 256 and length(${table.resolverVersion}) between 1 and 128 and length(${table.inputHash}) between 1 and 256`,
    ),
    fieldCheck: check('chk_capture_field_outcomes_field', sql`length(${table.field}) between 1 and 64`),
    statusCheck: check('chk_capture_field_outcomes_status', sql`length(${table.status}) between 1 and 32`),
    outcomeBoundCheck: check('chk_capture_field_outcomes_outcome_bound', sql`length(${table.outcomeJson}) <= 16384`),
    outcomeKeysCheck: check('chk_capture_field_outcomes_outcome_keys', sql`${table.outcomeJson} ${sql.raw(FORBIDDEN_KEY)}`),
  }),
)
