/**
 * Capture aggregate schema (issue #298). Owned by the capture module.
 *
 * This module owns the canonical `captures` root and its relation tables.
 * Vocabulary mirrors the sparxie contract
 * (src/db/lifecycle-vocabulary.ts). Triggers are installed by the journaled
 * baseline and are intentionally not modeled here (Drizzle does not model
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
    // #304: create-dedup key. Nullable values are excluded from the partial index,
    // so keyless creates stay distinct while a keyed re-create converges to the
    // winning row via idx_captures_idempotency.
    idempotencyKey: text('idempotency_key'),
  },
  (table) => ({
    workspaceIdx: index('idx_lifecycle_captures_workspace').on(table.workspaceId, table.createdAt),
    idempotencyIdx: uniqueIndex('idx_lifecycle_captures_idempotency')
      .on(table.workspaceId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    idempotencyKeyCheck: check('chk_lifecycle_captures_idempotency_key', sql`${table.idempotencyKey} is null or length(${table.idempotencyKey}) between 1 and 200`),
    // #299: provenance identity resolves to exactly one Capture id forever. Including
    // provider_schema (coalesced) keeps the same provider record under a different
    // schema distinct. A partial unique lets manual captures (null provider_record_id)
    // coexist, while connector/import re-observation resolves to the existing Capture.
    // The tombstone is NOT excluded: a removed Capture keeps owning its provenance
    // identity, so re-intake appends to it without clearing removed_at.
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

export const captureEffectiveRevisionInputs = pgTable(
  'capture_effective_revision_inputs',
  {
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
    captureId: text('capture_id').notNull(),
    captureRevision: integer('capture_revision').notNull(),
    effectiveInputJson: text('effective_input_json').notNull(),
    evidenceOriginsJson: text('evidence_origins_json').notNull(),
    inputFingerprint: text('input_fingerprint').notNull(),
    materializedAt: text('materialized_at').notNull(),
    finalizedAt: text('finalized_at'),
  },
  (table) => ({
    pk: primaryKey({
      name: 'capture_effective_revision_inputs_pk',
      columns: [table.captureId, table.captureRevision],
    }),
    revisionFk: foreignKey({
      name: 'fk_capture_effective_revision_inputs_revision',
      columns: [table.captureId, table.captureRevision],
      foreignColumns: [captureRevisions.captureId, captureRevisions.revision],
    }),
    workspaceIdx: index('idx_capture_effective_revision_inputs_workspace')
      .on(table.workspaceId, table.captureId, table.captureRevision),
    revisionCheck: check(
      'chk_capture_effective_revision_inputs_revision',
      sql`${table.captureRevision} > 0`,
    ),
    inputBoundCheck: check(
      'chk_capture_effective_revision_inputs_bound',
      sql`length(${table.effectiveInputJson}) between 2 and 262144`,
    ),
    evidenceOriginsBoundCheck: check(
      'chk_capture_effective_revision_inputs_evidence_origins_bound',
      sql`length(${table.evidenceOriginsJson}) between 2 and 8192`,
    ),
    fingerprintCheck: check(
      'chk_capture_effective_revision_inputs_fingerprint',
      sql`length(${table.inputFingerprint}) = 64`,
    ),
  }),
)

export const captureMaterializationIssues = pgTable(
  'capture_materialization_issues',
  {
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
    captureId: text('capture_id').notNull(),
    captureRevision: integer('capture_revision').notNull(),
    code: text('code').notNull(),
    message: text('message').notNull(),
    detailsJson: text('details_json').notNull(),
    createdAt: text('created_at').notNull(),
    resolvedAt: text('resolved_at'),
  },
  (table) => ({
    pk: primaryKey({
      name: 'capture_materialization_issues_pk',
      columns: [table.captureId, table.captureRevision],
    }),
    revisionFk: foreignKey({
      name: 'fk_capture_materialization_issues_revision',
      columns: [table.captureId, table.captureRevision],
      foreignColumns: [captureRevisions.captureId, captureRevisions.revision],
    }),
    unresolvedIdx: index('idx_capture_materialization_issues_unresolved')
      .on(table.workspaceId, table.captureId, table.captureRevision)
      .where(sql`${table.resolvedAt} is null`),
    revisionCheck: check(
      'chk_capture_materialization_issues_revision',
      sql`${table.captureRevision} > 0`,
    ),
    codeCheck: check(
      'chk_capture_materialization_issues_code',
      sql`${table.code} = 'revision_materialization_failed'`,
    ),
    messageCheck: check(
      'chk_capture_materialization_issues_message',
      sql`length(btrim(${table.message})) between 1 and 500`,
    ),
    detailsCheck: check(
      'chk_capture_materialization_issues_details',
      sql`length(${table.detailsJson}) between 2 and 4096`,
    ),
  }),
)

export const captureResolutionGenerations = pgTable(
  'capture_resolution_generations',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
    captureId: text('capture_id').notNull(),
    captureRevision: integer('capture_revision').notNull(),
    ordinal: integer('ordinal').notNull(),
    trigger: text('trigger').notNull(),
    status: text('status').notNull(),
    processingSummary: text('processing_summary').notNull(),
    inputFingerprint: text('input_fingerprint').notNull(),
    retryPolicyId: text('retry_policy_id').notNull(),
    retryPolicySnapshotJson: text('retry_policy_snapshot_json').notNull(),
    resolverSelectionSnapshotJson: text('resolver_selection_snapshot_json').notNull(),
    createdByActorJson: text('created_by_actor_json').notNull(),
    linkedJobId: text('linked_job_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    revisionFk: foreignKey({
      name: 'fk_capture_resolution_generations_revision',
      columns: [table.captureId, table.captureRevision],
      foreignColumns: [captureRevisions.captureId, captureRevisions.revision],
    }),
    captureOrdinalIdx: uniqueIndex('idx_capture_resolution_generations_ordinal')
      .on(table.captureId, table.ordinal),
    currentRevisionIdx: index('idx_capture_resolution_generations_revision')
      .on(table.captureId, table.captureRevision),
    activeIdx: uniqueIndex('idx_capture_resolution_generations_active')
      .on(table.captureId)
      .where(sql`${table.status} = 'active'`),
    workspaceQueueIdx: index('idx_capture_resolution_generations_workspace')
      .on(table.workspaceId, table.processingSummary, table.updatedAt, table.id),
    revisionCheck: check(
      'chk_capture_resolution_generations_revision',
      sql`${table.captureRevision} > 0 and ${table.ordinal} > 0`,
    ),
    triggerCheck: check(
      'chk_capture_resolution_generations_trigger',
      sql`${table.trigger} in (
        'intake','correction','restore','retry_destination','replay',
        'manual_completion'
      )`,
    ),
    statusCheck: check(
      'chk_capture_resolution_generations_status',
      sql`${table.status} in ('active','promoted','superseded','cancelled')`,
    ),
    summaryCheck: check(
      'chk_capture_resolution_generations_summary',
      sql`${table.processingSummary} in (
        'promoted','blocked','needs_action','retrying','processing',
        'awaiting_destination','awaiting_information','stopped'
      )`,
    ),
    fingerprintCheck: check(
      'chk_capture_resolution_generations_fingerprint',
      sql`length(${table.inputFingerprint}) = 64`,
    ),
    policyCheck: check(
      'chk_capture_resolution_generations_policy',
      sql`length(${table.retryPolicyId}) between 1 and 100
        and length(${table.retryPolicySnapshotJson}) between 2 and 4096
        and length(${table.resolverSelectionSnapshotJson}) between 2 and 4096`,
    ),
    actorCheck: check(
      'chk_capture_resolution_generations_actor',
      sql`length(${table.createdByActorJson}) between 2 and 2048`,
    ),
  }),
)

export const captureResolutionStageResults = pgTable(
  'capture_resolution_stage_results',
  {
    generationId: text('generation_id').notNull(),
    stage: text('stage').notNull(),
    captureRevision: integer('capture_revision').notNull(),
    status: text('status').notNull(),
    attemptCount: integer('attempt_count').notNull(),
    issueJson: text('issue_json'),
    resultJson: text('result_json').notNull(),
    nextAttemptAt: text('next_attempt_at'),
    resolverId: text('resolver_id'),
    resolverVersion: text('resolver_version'),
    remoteOperationId: text('remote_operation_id'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({
      name: 'capture_resolution_stage_results_pk',
      columns: [table.generationId, table.stage],
    }),
    generationFk: foreignKey({
      name: 'fk_capture_resolution_stage_results_generation',
      columns: [table.generationId],
      foreignColumns: [captureResolutionGenerations.id],
    }),
    stageCheck: check(
      'chk_capture_resolution_stage_results_stage',
      sql`${table.stage} in ('destination','information','promotion')`,
    ),
    revisionCheck: check(
      'chk_capture_resolution_stage_results_revision',
      sql`${table.captureRevision} > 0 and ${table.attemptCount} >= 0`,
    ),
    statusCheck: check(
      'chk_capture_resolution_stage_results_status',
      sql`${table.status} in (
        'not_required','queued','running','retry_wait','resolved',
        'action_required','exhausted','blocked','awaiting_manual',
        'not_ready','promoted','superseded','cancelled'
      )`,
    ),
    issueCheck: check(
      'chk_capture_resolution_stage_results_issue',
      sql`${table.issueJson} is null or length(${table.issueJson}) between 2 and 4096`,
    ),
    resultCheck: check(
      'chk_capture_resolution_stage_results_result',
      sql`length(${table.resultJson}) between 2 and 16384`,
    ),
    resolverCheck: check(
      'chk_capture_resolution_stage_results_resolver',
      sql`${table.resolverId} is null or length(${table.resolverId}) between 1 and 200`,
    ),
  }),
)

export const captureResolutionCommandReceipts = pgTable(
  'capture_resolution_command_receipts',
  {
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
    idempotencyKey: text('idempotency_key').notNull(),
    operation: text('operation').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    /** Auditable, redacted command provenance for retry/replay requests. */
    requestSnapshotJson: text('request_snapshot_json').notNull().default('{}'),
    resultJson: text('result_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({
      name: 'capture_resolution_command_receipts_pk',
      columns: [table.workspaceId, table.operation, table.idempotencyKey],
    }),
    operationCheck: check(
      'chk_capture_resolution_command_receipts_operation',
      sql`${table.operation} in ('retry','replay','correct','complete')`,
    ),
    keyCheck: check(
      'chk_capture_resolution_command_receipts_key',
      sql`length(${table.idempotencyKey}) between 1 and 200`,
    ),
    fingerprintCheck: check(
      'chk_capture_resolution_command_receipts_fingerprint',
      sql`length(${table.requestFingerprint}) = 64`,
    ),
    resultCheck: check(
      'chk_capture_resolution_command_receipts_result',
      sql`length(${table.resultJson}) between 2 and 16384`,
    ),
    requestSnapshotCheck: check(
      'chk_capture_resolution_command_receipts_request_snapshot',
      sql`length(${table.requestSnapshotJson}) between 2 and 4096
        and ${table.requestSnapshotJson} ${sql.raw(FORBIDDEN_KEY)}`,
    ),
  }),
)

export const captureMaterializationState = pgTable(
  'capture_materialization_state',
  {
    workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id),
    status: text('status').notNull(),
    completed: integer('completed').notNull(),
    total: integer('total').notNull(),
    issueCount: integer('issue_count').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    statusCheck: check(
      'chk_capture_materialization_state_status',
      sql`${table.status} in ('migrating','ready','blocked')`,
    ),
    countCheck: check(
      'chk_capture_materialization_state_counts',
      sql`${table.completed} >= 0 and ${table.total} >= 0
        and ${table.completed} <= ${table.total} and ${table.issueCount} >= 0`,
    ),
  }),
)
