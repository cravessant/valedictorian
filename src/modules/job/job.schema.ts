/**
 * Job aggregate schema (issue #298). Owned by the job module.
 *
 * Canonical root uses the interim physical name `lifecycle_jobs` (avoids colliding
 * with the still-live legacy `jobs`). #298 installs and one-time-transforms these
 * tables but does not rewire the runtime; the Job leaf (#300) adopts them and the
 * clean-cutover leaf (#307) drops legacy and renames it to `jobs` (see
 * drizzle/lifecycle-migration.md). Vocabulary mirrors the sparxie contract
 * (src/db/lifecycle-vocabulary.ts). Append-only,
 * one-way-removal, and Capture-to-Job workspace-lineage triggers are installed
 * by the journaled migration and not modeled here.
 */
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { FORBIDDEN_JSON_KEY_PREDICATE } from '../../db/sensitive-keys'
import { captureRevisions } from '../capture/capture.schema'
import { workspaces } from '../../db/workspaces.schema'

const FORBIDDEN_KEY = FORBIDDEN_JSON_KEY_PREDICATE
// The sparxie contract's uuidV7Schema regex carries the case-insensitive /i flag,
// so it admits uppercase hex. The CHECK therefore uses ~* (case-insensitive);
// using ~ would reject ids the contract accepts.
const UUID_V7 = `~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`

export const lifecycleJobs = pgTable(
  'lifecycle_jobs',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
    factsRevision: integer('facts_revision').notNull(),
    factsJson: text('facts_json').notNull(),
    availabilityState: text('availability_state').notNull(),
    availabilityObservedAt: text('availability_observed_at').notNull(),
    availabilityRevision: integer('availability_revision').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    removedAt: text('removed_at'),
    // #304: create-dedup key (see capture.schema for the partial-index rationale).
    idempotencyKey: text('idempotency_key'),
  },
  (table) => ({
    workspaceIdx: index('idx_lifecycle_jobs_workspace').on(table.workspaceId, table.createdAt),
    idempotencyIdx: uniqueIndex('idx_lifecycle_jobs_idempotency')
      .on(table.workspaceId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    idempotencyKeyCheck: check('chk_lifecycle_jobs_idempotency_key', sql`${table.idempotencyKey} is null or length(${table.idempotencyKey}) between 1 and 200`),
    idCheck: check('chk_lifecycle_jobs_id', sql`${table.id} ${sql.raw(UUID_V7)}`),
    workspaceCheck: check('chk_lifecycle_jobs_workspace', sql`length(${table.workspaceId}) between 1 and 200`),
    factsRevisionCheck: check('chk_lifecycle_jobs_facts_revision', sql`${table.factsRevision} > 0`),
    factsBoundCheck: check('chk_lifecycle_jobs_facts_bound', sql`length(${table.factsJson}) <= 262144`),
    availabilityStateCheck: check('chk_lifecycle_jobs_availability_state', sql`${table.availabilityState} in ('open','closed','unknown')`),
    availabilityRevisionCheck: check('chk_lifecycle_jobs_availability_revision', sql`${table.availabilityRevision} > 0`),
  }),
)

export const jobExternalIdentities = pgTable(
  'job_external_identities',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id').notNull(),
    kind: text('kind').notNull(),
    provider: text('provider').notNull(),
    account: text('account'),
    value: text('value').notNull(),
    strength: text('strength').notNull(),
    provenanceKind: text('provenance_kind').notNull(),
    provenanceVersion: text('provenance_version').notNull(),
    evidenceJson: text('evidence_json').notNull(),
    removedAt: text('removed_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    jobFk: foreignKey({ name: 'fk_job_external_identities_job', columns: [table.jobId], foreignColumns: [lifecycleJobs.id] }),
    strongIdx: uniqueIndex('idx_job_external_identities_strong')
      .on(table.kind, table.provider, sql`(coalesce(${table.account}, ''))`, table.value)
      .where(sql`${table.strength} = 'strong' and ${table.removedAt} is null`),
    perJobIdx: uniqueIndex('idx_job_external_identities_per_job')
      .on(table.jobId, table.kind, table.provider, sql`(coalesce(${table.account}, ''))`, table.value)
      .where(sql`${table.removedAt} is null`),
    jobIdx: index('idx_job_external_identities_job').on(table.jobId, table.createdAt, table.id),
    kindCheck: check('chk_job_external_identities_kind', sql`${table.kind} in ('ats_job','employer_job','canonical_destination','posting')`),
    strengthCheck: check('chk_job_external_identities_strength', sql`${table.strength} in ('strong','provisional')`),
    providerCheck: check('chk_job_external_identities_provider', sql`${table.provider} = lower(${table.provider}) and length(${table.provider}) between 1 and 200`),
    accountCheck: check('chk_job_external_identities_account', sql`${table.account} is null or (${table.account} = lower(${table.account}) and length(${table.account}) between 1 and 500)`),
    valueCheck: check('chk_job_external_identities_value', sql`length(${table.value}) between 1 and 2048`),
    provenanceVersionCheck: check('chk_job_external_identities_provenance_version', sql`length(${table.provenanceVersion}) between 1 and 128`),
    evidenceBoundCheck: check('chk_job_external_identities_evidence_bound', sql`length(${table.evidenceJson}) between 2 and 16384`),
    evidenceKeysCheck: check('chk_job_external_identities_evidence_keys', sql`${table.evidenceJson} ${sql.raw(FORBIDDEN_KEY)}`),
    strongAccountCheck: check('chk_job_external_identities_strong_account', sql`${table.strength} = 'provisional' or ${table.account} is not null`),
  }),
)

export const jobCaptureEvidenceReferences = pgTable(
  'job_capture_evidence_references',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id').notNull(),
    captureId: text('capture_id').notNull(),
    captureRevision: integer('capture_revision').notNull(),
    evidenceIndexesJson: text('evidence_indexes_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    lineageIdx: uniqueIndex('idx_job_capture_evidence_references_lineage').on(table.jobId, table.captureId, table.captureRevision),
    captureIdx: index('idx_job_capture_evidence_references_capture').on(table.captureId, table.captureRevision),
    jobFk: foreignKey({ name: 'fk_job_capture_evidence_references_job', columns: [table.jobId], foreignColumns: [lifecycleJobs.id] }),
    revisionFk: foreignKey({
      name: 'fk_job_capture_evidence_references_revision',
      columns: [table.captureId, table.captureRevision],
      foreignColumns: [captureRevisions.captureId, captureRevisions.revision],
    }),
    revisionCheck: check('chk_job_capture_evidence_references_revision', sql`${table.captureRevision} > 0`),
    indexesCheck: check('chk_job_capture_evidence_references_indexes', sql`length(${table.evidenceIndexesJson}) between 2 and 4096`),
  }),
)

export const jobHistory = pgTable(
  'job_history',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id').notNull(),
    sequence: integer('sequence').notNull(),
    kind: text('kind').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    auditJson: text('audit_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    sequenceIdx: uniqueIndex('idx_job_history_sequence').on(table.jobId, table.sequence),
    jobFk: foreignKey({ name: 'fk_job_history_job', columns: [table.jobId], foreignColumns: [lifecycleJobs.id] }),
    sequenceCheck: check('chk_job_history_sequence', sql`${table.sequence} > 0`),
    kindCheck: check('chk_job_history_kind', sql`${table.kind} in ('created','facts_corrected','availability_changed','identity_added','identity_removed','removed','restored')`),
    snapshotBoundCheck: check('chk_job_history_snapshot_bound', sql`length(${table.snapshotJson}) <= 262144`),
    auditBoundCheck: check('chk_job_history_audit_bound', sql`length(${table.auditJson}) <= 16384`),
    auditKeysCheck: check('chk_job_history_audit_keys', sql`${table.auditJson} ${sql.raw(FORBIDDEN_KEY)}`),
  }),
)
