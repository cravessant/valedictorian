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

export const companyCapabilityState = pgTable(
  'company_capability_state',
  {
    workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id),
    status: text('status').notNull(),
    completed: integer('completed').notNull(),
    total: integer('total').notNull(),
    issueCount: integer('issue_count').notNull(),
    blockedReason: text('blocked_reason'),
    message: text('message'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    statusCheck: check(
      'chk_company_capability_status',
      sql`${table.status} in ('migrating','blocked','ready')`,
    ),
    countsCheck: check(
      'chk_company_capability_counts',
      sql`${table.completed} >= 0 and ${table.total} >= 0
        and ${table.completed} <= ${table.total} and ${table.issueCount} >= 0`,
    ),
    blockedCheck: check(
      'chk_company_capability_blocked',
      sql`(${table.status} = 'blocked') =
        (${table.blockedReason} is not null and ${table.message} is not null)`,
    ),
    reasonCheck: check(
      'chk_company_capability_reason',
      sql`${table.blockedReason} is null or ${table.blockedReason} in
        ('migration_failed','invalid_legacy_data','integrity_check_failed')`,
    ),
    messageCheck: check(
      'chk_company_capability_message',
      sql`${table.message} is null or length(btrim(${table.message})) between 1 and 500`,
    ),
  }),
)

export const companyBackfillJournal = pgTable(
  'company_backfill_journal',
  {
    workspaceId: text('workspace_id').notNull(),
    jobId: text('job_id').notNull(),
    companyId: text('company_id').notNull(),
    usedUnknownName: integer('used_unknown_name').notNull(),
    completedAt: text('completed_at').notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({ columns: [table.workspaceId, table.jobId] }),
    companyKey: uniqueIndex('idx_company_backfill_journal_company')
      .on(table.workspaceId, table.companyId),
    jobFk: foreignKey({
      name: 'fk_company_backfill_journal_job',
      columns: [table.jobId],
      foreignColumns: [jobs.id],
    }),
    companyFk: foreignKey({
      name: 'fk_company_backfill_journal_company',
      columns: [table.workspaceId, table.companyId],
      foreignColumns: [workspaceCompanies.workspaceId, workspaceCompanies.id],
    }),
    unknownCheck: check(
      'chk_company_backfill_journal_unknown',
      sql`${table.usedUnknownName} in (0, 1)`,
    ),
  }),
)
