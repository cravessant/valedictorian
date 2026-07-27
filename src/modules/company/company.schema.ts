import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { jobs } from '../job/job.schema'
import { workspaces } from '../../db/workspaces.schema'

const UUID_V7 = `~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`

export const workspaceCompanies = pgTable(
  'workspace_companies',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
    displayName: text('display_name').notNull(),
    normalizedDisplayName: text('normalized_display_name').notNull(),
    websiteUrl: text('website_url'),
    websiteHost: text('website_host'),
    notes: text('notes'),
    revision: integer('revision').notNull(),
    status: text('status').notNull(),
    mergedIntoCompanyId: text('merged_into_company_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    workspaceCompanyKey: unique('uq_workspace_companies_workspace_id')
      .on(table.workspaceId, table.id),
    directoryIdx: index('idx_workspace_companies_directory')
      .on(table.workspaceId, table.normalizedDisplayName, table.id),
    statusIdx: index('idx_workspace_companies_status')
      .on(table.workspaceId, table.status, table.normalizedDisplayName, table.id),
    websiteHostIdx: index('idx_workspace_companies_website_host')
      .on(table.workspaceId, table.websiteHost, table.id)
      .where(sql`${table.websiteHost} is not null`),
    canonicalFk: foreignKey({
      name: 'fk_workspace_companies_canonical',
      columns: [table.workspaceId, table.mergedIntoCompanyId],
      foreignColumns: [table.workspaceId, table.id],
    }),
    idCheck: check('chk_workspace_companies_id', sql`${table.id} ${sql.raw(UUID_V7)}`),
    displayNameCheck: check(
      'chk_workspace_companies_display_name',
      sql`length(btrim(${table.displayName})) between 1 and 500`,
    ),
    normalizedNameCheck: check(
      'chk_workspace_companies_normalized_name',
      sql`length(${table.normalizedDisplayName}) between 1 and 500`,
    ),
    websiteUrlCheck: check(
      'chk_workspace_companies_website_url',
      sql`${table.websiteUrl} is null or length(${table.websiteUrl}) between 8 and 2048`,
    ),
    websiteHostCheck: check(
      'chk_workspace_companies_website_host',
      sql`${table.websiteHost} is null or length(${table.websiteHost}) between 1 and 253`,
    ),
    notesCheck: check(
      'chk_workspace_companies_notes',
      sql`${table.notes} is null or length(${table.notes}) between 1 and 10000`,
    ),
    revisionCheck: check('chk_workspace_companies_revision', sql`${table.revision} > 0`),
    statusCheck: check(
      'chk_workspace_companies_status',
      sql`${table.status} in ('active','archived','merged')`,
    ),
    mergedTargetCheck: check(
      'chk_workspace_companies_merged_target',
      sql`(${table.status} = 'merged') = (${table.mergedIntoCompanyId} is not null)
        and ${table.mergedIntoCompanyId} is distinct from ${table.id}`,
    ),
  }),
)

export const companyAliases = pgTable(
  'company_aliases',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    companyId: text('company_id').notNull(),
    value: text('value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    removedAt: text('removed_at'),
  },
  (table) => ({
    companyFk: foreignKey({
      name: 'fk_company_aliases_company',
      columns: [table.workspaceId, table.companyId],
      foreignColumns: [workspaceCompanies.workspaceId, workspaceCompanies.id],
    }),
    companyIdx: index('idx_company_aliases_company')
      .on(table.workspaceId, table.companyId, table.createdAt, table.id),
    activeValueIdx: uniqueIndex('idx_company_aliases_active_value')
      .on(table.companyId, table.normalizedValue)
      .where(sql`${table.removedAt} is null`),
    duplicateSignalIdx: index('idx_company_aliases_duplicate_signal')
      .on(table.workspaceId, table.normalizedValue, table.companyId)
      .where(sql`${table.removedAt} is null`),
    valueCheck: check(
      'chk_company_aliases_value',
      sql`length(btrim(${table.value})) between 1 and 500`,
    ),
    normalizedValueCheck: check(
      'chk_company_aliases_normalized_value',
      sql`length(${table.normalizedValue}) between 1 and 500`,
    ),
  }),
)

export const companyDuplicateCandidates = pgTable(
  'company_duplicate_candidates',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
    lowerCompanyId: text('lower_company_id').notNull(),
    higherCompanyId: text('higher_company_id').notNull(),
    revision: integer('revision').notNull(),
    score: integer('score').notNull(),
    reasonCodesJson: text('reason_codes_json').notNull(),
    matcherVersion: text('matcher_version').notNull(),
    lowerInputFingerprint: text('lower_input_fingerprint').notNull(),
    higherInputFingerprint: text('higher_input_fingerprint').notNull(),
    lowerResolvedSnapshotJson: text('lower_resolved_snapshot_json'),
    higherResolvedSnapshotJson: text('higher_resolved_snapshot_json'),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    workspaceCandidateKey: unique('uq_company_duplicate_candidates_workspace_id')
      .on(table.workspaceId, table.id),
    pairKey: uniqueIndex('idx_company_duplicate_candidates_pair')
      .on(table.workspaceId, table.lowerCompanyId, table.higherCompanyId),
    reviewQueueIdx: index('idx_company_duplicate_candidates_review_queue')
      .on(
        table.workspaceId,
        table.status,
        table.score.desc(),
        table.updatedAt.desc(),
        table.id,
      ),
    lowerIdx: index('idx_company_duplicate_candidates_lower')
      .on(table.workspaceId, table.lowerCompanyId, table.status),
    higherIdx: index('idx_company_duplicate_candidates_higher')
      .on(table.workspaceId, table.higherCompanyId, table.status),
    lowerCompanyFk: foreignKey({
      name: 'fk_company_duplicate_candidates_lower',
      columns: [table.workspaceId, table.lowerCompanyId],
      foreignColumns: [workspaceCompanies.workspaceId, workspaceCompanies.id],
    }),
    higherCompanyFk: foreignKey({
      name: 'fk_company_duplicate_candidates_higher',
      columns: [table.workspaceId, table.higherCompanyId],
      foreignColumns: [workspaceCompanies.workspaceId, workspaceCompanies.id],
    }),
    idCheck: check('chk_company_duplicate_candidates_id', sql`${table.id} ${sql.raw(UUID_V7)}`),
    orderCheck: check(
      'chk_company_duplicate_candidates_order',
      sql`${table.lowerCompanyId} < ${table.higherCompanyId}`,
    ),
    revisionCheck: check(
      'chk_company_duplicate_candidates_revision',
      sql`${table.revision} > 0`,
    ),
    scoreCheck: check(
      'chk_company_duplicate_candidates_score',
      sql`${table.score} between 0 and 10000`,
    ),
    reasonCodesCheck: check(
      'chk_company_duplicate_candidates_reasons',
      sql`length(${table.reasonCodesJson}) between 2 and 2048`,
    ),
    matcherCheck: check(
      'chk_company_duplicate_candidates_matcher',
      sql`length(${table.matcherVersion}) between 1 and 100`,
    ),
    fingerprintCheck: check(
      'chk_company_duplicate_candidates_fingerprints',
      sql`length(${table.lowerInputFingerprint}) = 64
        and length(${table.higherInputFingerprint}) = 64`,
    ),
    resolvedSnapshotCheck: check(
      'chk_company_duplicate_candidates_resolved_snapshots',
      sql`(${table.lowerResolvedSnapshotJson} is null
          and ${table.higherResolvedSnapshotJson} is null)
        or (${table.status} = 'resolved_by_merge'
          and length(${table.lowerResolvedSnapshotJson}) between 2 and 4096
          and length(${table.higherResolvedSnapshotJson}) between 2 and 4096)`,
    ),
    statusCheck: check(
      'chk_company_duplicate_candidates_status',
      sql`${table.status} in ('open','marked_distinct','resolved_by_merge')`,
    ),
  }),
)

export const companyDuplicateCandidateReviews = pgTable(
  'company_duplicate_candidate_reviews',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    candidateId: text('candidate_id').notNull(),
    candidateRevision: integer('candidate_revision').notNull(),
    decision: text('decision').notNull(),
    actorJson: text('actor_json').notNull(),
    rationale: text('rationale').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    candidateFk: foreignKey({
      name: 'fk_company_duplicate_candidate_reviews_candidate',
      columns: [table.workspaceId, table.candidateId],
      foreignColumns: [
        companyDuplicateCandidates.workspaceId,
        companyDuplicateCandidates.id,
      ],
    }),
    candidateRevisionKey: uniqueIndex('idx_company_duplicate_candidate_reviews_revision')
      .on(table.candidateId, table.candidateRevision),
    decisionCheck: check(
      'chk_company_duplicate_candidate_reviews_decision',
      sql`${table.decision} in ('mark_distinct','merge')`,
    ),
    revisionCheck: check(
      'chk_company_duplicate_candidate_reviews_revision',
      sql`${table.candidateRevision} > 0`,
    ),
    actorCheck: check(
      'chk_company_duplicate_candidate_reviews_actor',
      sql`length(${table.actorJson}) between 2 and 2048`,
    ),
    rationaleCheck: check(
      'chk_company_duplicate_candidate_reviews_rationale',
      sql`length(btrim(${table.rationale})) between 1 and 1000`,
    ),
  }),
)

export const companyDuplicateMaintenanceWork = pgTable(
  'company_duplicate_maintenance_work',
  {
    workspaceId: text('workspace_id').notNull(),
    companyId: text('company_id').notNull(),
    requestedRevision: integer('requested_revision').notNull(),
    processedRevision: integer('processed_revision'),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.workspaceId, table.companyId] }),
    companyFk: foreignKey({
      name: 'fk_company_duplicate_maintenance_work_company',
      columns: [table.workspaceId, table.companyId],
      foreignColumns: [workspaceCompanies.workspaceId, workspaceCompanies.id],
    }),
    pendingIdx: index('idx_company_duplicate_maintenance_work_pending')
      .on(table.workspaceId, table.status, table.updatedAt, table.companyId),
    requestedCheck: check(
      'chk_company_duplicate_maintenance_work_requested',
      sql`${table.requestedRevision} > 0`,
    ),
    processedCheck: check(
      'chk_company_duplicate_maintenance_work_processed',
      sql`${table.processedRevision} is null
        or (${table.processedRevision} > 0
          and ${table.processedRevision} <= ${table.requestedRevision})`,
    ),
    statusCheck: check(
      'chk_company_duplicate_maintenance_work_status',
      sql`${table.status} in ('pending','processing','idle')`,
    ),
  }),
)

export const companyDuplicateIndexState = pgTable(
  'company_duplicate_index_state',
  {
    workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id),
    matcherVersion: text('matcher_version').notNull(),
    afterCompanyId: text('after_company_id'),
    status: text('status').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    statusCheck: check(
      'chk_company_duplicate_index_state_status',
      sql`${table.status} in ('indexing','ready')`,
    ),
    matcherCheck: check(
      'chk_company_duplicate_index_state_matcher',
      sql`length(${table.matcherVersion}) between 1 and 100`,
    ),
  }),
)

export const jobCompanyAssignments = pgTable(
  'job_company_assignments',
  {
    jobId: text('job_id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    companyId: text('company_id').notNull(),
    revision: integer('revision').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    jobFk: foreignKey({
      name: 'fk_job_company_assignments_job',
      columns: [table.jobId],
      foreignColumns: [jobs.id],
    }),
    companyFk: foreignKey({
      name: 'fk_job_company_assignments_company',
      columns: [table.workspaceId, table.companyId],
      foreignColumns: [workspaceCompanies.workspaceId, workspaceCompanies.id],
    }),
    companyIdx: index('idx_job_company_assignments_company')
      .on(table.workspaceId, table.companyId, table.jobId),
    revisionCheck: check('chk_job_company_assignments_revision', sql`${table.revision} > 0`),
  }),
)

export const jobCompanyAssignmentHistory = pgTable(
  'job_company_assignment_history',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    jobId: text('job_id').notNull(),
    assignmentRevision: integer('assignment_revision').notNull(),
    priorCompanyId: text('prior_company_id'),
    companyId: text('company_id').notNull(),
    kind: text('kind').notNull(),
    actorJson: text('actor_json').notNull(),
    rationale: text('rationale').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    assignmentKey: uniqueIndex('idx_job_company_assignment_history_revision')
      .on(table.jobId, table.assignmentRevision),
    jobFk: foreignKey({
      name: 'fk_job_company_assignment_history_job',
      columns: [table.jobId],
      foreignColumns: [jobs.id],
    }),
    companyFk: foreignKey({
      name: 'fk_job_company_assignment_history_company',
      columns: [table.workspaceId, table.companyId],
      foreignColumns: [workspaceCompanies.workspaceId, workspaceCompanies.id],
    }),
    priorCompanyFk: foreignKey({
      name: 'fk_job_company_assignment_history_prior_company',
      columns: [table.workspaceId, table.priorCompanyId],
      foreignColumns: [workspaceCompanies.workspaceId, workspaceCompanies.id],
    }),
    revisionCheck: check(
      'chk_job_company_assignment_history_revision',
      sql`${table.assignmentRevision} > 0`,
    ),
    kindCheck: check(
      'chk_job_company_assignment_history_kind',
      sql`${table.kind} in ('baseline','assigned','reassigned','merged')`,
    ),
    rationaleCheck: check(
      'chk_job_company_assignment_history_rationale',
      sql`length(btrim(${table.rationale})) between 1 and 1000`,
    ),
    actorCheck: check(
      'chk_job_company_assignment_history_actor',
      sql`length(${table.actorJson}) between 2 and 2048`,
    ),
  }),
)

export const companyHistory = pgTable(
  'company_history',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    companyId: text('company_id').notNull(),
    sequence: integer('sequence').notNull(),
    companyRevision: integer('company_revision').notNull(),
    kind: text('kind').notNull(),
    changedFieldsJson: text('changed_fields_json').notNull(),
    actorJson: text('actor_json').notNull(),
    rationale: text('rationale').notNull(),
    aliasId: text('alias_id'),
    relatedCompanyId: text('related_company_id'),
    affectedJobIdsJson: text('affected_job_ids_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    sequenceKey: uniqueIndex('idx_company_history_sequence')
      .on(table.companyId, table.sequence),
    companyFk: foreignKey({
      name: 'fk_company_history_company',
      columns: [table.workspaceId, table.companyId],
      foreignColumns: [workspaceCompanies.workspaceId, workspaceCompanies.id],
    }),
    relatedCompanyFk: foreignKey({
      name: 'fk_company_history_related_company',
      columns: [table.workspaceId, table.relatedCompanyId],
      foreignColumns: [workspaceCompanies.workspaceId, workspaceCompanies.id],
    }),
    sequenceCheck: check('chk_company_history_sequence', sql`${table.sequence} > 0`),
    revisionCheck: check('chk_company_history_revision', sql`${table.companyRevision} > 0`),
    kindCheck: check(
      'chk_company_history_kind',
      sql`${table.kind} in ('created','updated','alias_added','alias_updated',
        'alias_removed','archived','restored','merged')`,
    ),
    changedFieldsCheck: check(
      'chk_company_history_changed_fields',
      sql`length(${table.changedFieldsJson}) between 2 and 2048`,
    ),
    actorCheck: check(
      'chk_company_history_actor',
      sql`length(${table.actorJson}) between 2 and 2048`,
    ),
    rationaleCheck: check(
      'chk_company_history_rationale',
      sql`length(btrim(${table.rationale})) between 1 and 1000`,
    ),
    affectedJobsCheck: check(
      'chk_company_history_affected_jobs',
      sql`length(${table.affectedJobIdsJson}) between 2 and 16384`,
    ),
  }),
)

export const companyCommandReceipts = pgTable(
  'company_command_receipts',
  {
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
    idempotencyKey: text('idempotency_key').notNull(),
    operation: text('operation').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    resultJson: text('result_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      columns: [table.workspaceId, table.idempotencyKey],
    }),
    keyCheck: check(
      'chk_company_command_receipts_key',
      sql`length(btrim(${table.idempotencyKey})) between 1 and 200`,
    ),
    operationCheck: check(
      'chk_company_command_receipts_operation',
      sql`${table.operation} in ('create','update','notes','alias_add','alias_update','alias_remove','archive','restore','reassign','mark_distinct','merge')`,
    ),
    fingerprintCheck: check(
      'chk_company_command_receipts_fingerprint',
      sql`length(${table.requestFingerprint}) = 64`,
    ),
    resultCheck: check(
      'chk_company_command_receipts_result',
      sql`length(${table.resultJson}) between 2 and 65536`,
    ),
  }),
)
