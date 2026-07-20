/**
 * Capture aggregate schema (issue #298). Owned by the capture module.
 *
 * Canonical root uses the interim physical name `lifecycle_captures` so it does
 * not collide with the still-live legacy `captures` table. #298 installs and
 * one-time-transforms these tables but does NOT rewire the runtime onto them; the
 * legacy tables stay the live source. The Capture leaf (#299) adopts these tables;
 * the clean-cutover leaf (#307) drops legacy and renames `lifecycle_captures` to
 * `captures` (see drizzle/lifecycle-migration.md). Relation tables already use
 * their canonical names. Vocabulary mirrors the sparxie contract
 * (src/db/lifecycle-vocabulary.ts). Triggers are installed by the journaled
 * migration and are intentionally not modeled here (Drizzle does not model
 * triggers), matching the baseline pattern.
 */
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { FORBIDDEN_JSON_KEY_PREDICATE } from '../../db/sensitive-keys'
import { workspaces } from '../../db/workspaces.schema'

const FORBIDDEN_KEY = FORBIDDEN_JSON_KEY_PREDICATE

export const lifecycleCaptures = pgTable(
  'lifecycle_captures',
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
  },
  (table) => ({
    workspaceIdx: index('idx_lifecycle_captures_workspace').on(table.workspaceId, table.createdAt),
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
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: 'capture_revisions_pk', columns: [table.captureId, table.revision] }),
    captureFk: foreignKey({ name: 'fk_capture_revisions_capture', columns: [table.captureId], foreignColumns: [lifecycleCaptures.id] }),
    revisionCheck: check('chk_capture_revisions_revision', sql`${table.revision} > 0`),
    kindCheck: check('chk_capture_revisions_kind', sql`${table.kind} in ('created','corrected','removed','restored')`),
    snapshotBoundCheck: check('chk_capture_revisions_snapshot_bound', sql`length(${table.snapshotJson}) <= 262144`),
    auditBoundCheck: check('chk_capture_revisions_audit_bound', sql`length(${table.auditJson}) <= 16384`),
    auditKeysCheck: check('chk_capture_revisions_audit_keys', sql`${table.auditJson} ${sql.raw(FORBIDDEN_KEY)}`),
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
