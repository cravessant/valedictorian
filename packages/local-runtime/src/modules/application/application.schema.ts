/**
 * Application aggregate schema (issue #298). Owned by the application module.
 *
 * This module owns the canonical `applications` root.
 * Relation tables use distinct canonical names (`pursuit_links`,
 * `application_attempt_records`, `application_event_records`, `application_history`),
 * so they need no rename. Vocabulary mirrors the sparxie contract
 * (src/db/lifecycle-vocabulary.ts). The Opportunity-and-Job lineage and
 * append-only history triggers are installed by the operational baseline.
 */
import { sql } from 'drizzle-orm'
import { boolean, check, foreignKey, index, integer, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { FORBIDDEN_JSON_KEY_PREDICATE } from '../../db/sensitive-keys.js'
import { jobs } from '../job/job.schema.js'
import { opportunities } from '../opportunity/opportunity.schema.js'
import { workspaces } from '../../db/workspaces.schema.js'

const FORBIDDEN_KEY = FORBIDDEN_JSON_KEY_PREDICATE

export const applications = pgTable(
  'applications',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
    opportunityId: text('opportunity_id').notNull(),
    jobId: text('job_id').notNull(),
    revision: integer('revision').notNull(),
    status: text('status').notNull(),
    jobFactsRevision: integer('job_facts_revision').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    companyName: text('company_name').notNull(),
    sourceName: text('source_name').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    removedAt: text('removed_at'),
    // #304: create-dedup key (see capture.schema for the partial-index rationale).
    idempotencyKey: text('idempotency_key'),
  },
  (table) => ({
    opportunityIdx: uniqueIndex('idx_lifecycle_applications_opportunity').on(table.workspaceId, table.opportunityId).where(sql`${table.removedAt} is null`),
    idempotencyIdx: uniqueIndex('idx_lifecycle_applications_idempotency')
      .on(table.workspaceId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    idempotencyKeyCheck: check('chk_lifecycle_applications_idempotency_key', sql`${table.idempotencyKey} is null or length(${table.idempotencyKey}) between 1 and 200`),
    jobIdx: index('idx_lifecycle_applications_job').on(table.jobId),
    opportunityFk: foreignKey({ name: 'fk_lifecycle_applications_opportunity', columns: [table.opportunityId], foreignColumns: [opportunities.id] }),
    jobFk: foreignKey({ name: 'fk_lifecycle_applications_job', columns: [table.jobId], foreignColumns: [jobs.id] }),
    workspaceCheck: check('chk_lifecycle_applications_workspace', sql`length(${table.workspaceId}) between 1 and 200`),
    revisionCheck: check('chk_lifecycle_applications_revision', sql`${table.revision} > 0`),
    statusCheck: check('chk_lifecycle_applications_status', sql`${table.status} in ('active','submitted','interviewing','offered','withdrawn','rejected','accepted')`),
    jobFactsRevisionCheck: check('chk_lifecycle_applications_job_facts_revision', sql`${table.jobFactsRevision} > 0`),
    snapshotBoundCheck: check('chk_lifecycle_applications_snapshot_bound', sql`length(${table.snapshotJson}) <= 262144`),
    companyCheck: check('chk_lifecycle_applications_company', sql`length(${table.companyName}) between 1 and 500`),
    sourceCheck: check('chk_lifecycle_applications_source', sql`length(${table.sourceName}) between 1 and 500`),
  }),
)

// The contract's <=100-links-per-application count is service-enforced, not a DB
// constraint: pursuit links are mutable (link_updated/link_removed), so a bounded
// row-index (as used for immutable capture evidence items) would fight re-add and
// removal semantics. Per-link field bounds and the single-primary rule are
// enforced here; the count cap lives in the application repository.
export const pursuitLinks = pgTable(
  'pursuit_links',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id').notNull(),
    kind: text('kind').notNull(),
    label: text('label').notNull(),
    url: text('url').notNull(),
    isPrimary: boolean('is_primary').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    primaryIdx: uniqueIndex('idx_pursuit_links_primary').on(table.applicationId).where(sql`${table.isPrimary}`),
    applicationIdx: index('idx_pursuit_links_application').on(table.applicationId),
    applicationFk: foreignKey({ name: 'fk_pursuit_links_application', columns: [table.applicationId], foreignColumns: [applications.id] }),
    kindCheck: check('chk_pursuit_links_kind', sql`length(${table.kind}) between 1 and 100`),
    labelCheck: check('chk_pursuit_links_label', sql`length(${table.label}) between 1 and 200`),
    urlCheck: check('chk_pursuit_links_url', sql`length(${table.url}) between 1 and 4096`),
  }),
)

export const applicationAttemptRecords = pgTable(
  'application_attempt_records',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
    applicationId: text('application_id').notNull(),
    state: text('state').notNull(),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
    summary: text('summary'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    applicationIdx: index('idx_application_attempt_records_application').on(table.applicationId, table.startedAt),
    applicationFk: foreignKey({ name: 'fk_application_attempt_records_application', columns: [table.applicationId], foreignColumns: [applications.id] }),
    workspaceCheck: check('chk_application_attempt_records_workspace', sql`length(${table.workspaceId}) between 1 and 200`),
    stateCheck: check('chk_application_attempt_records_state', sql`${table.state} in ('pending','running','succeeded','failed')`),
    summaryCheck: check('chk_application_attempt_records_summary', sql`${table.summary} is null or length(${table.summary}) between 1 and 2000`),
  }),
)

export const applicationEventRecords = pgTable(
  'application_event_records',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
    applicationId: text('application_id').notNull(),
    type: text('type').notNull(),
    occurredAt: text('occurred_at').notNull(),
    actorId: text('actor_id').notNull(),
    actorType: text('actor_type').notNull(),
    actorDisplayName: text('actor_display_name'),
    summary: text('summary').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    applicationIdx: index('idx_application_event_records_application').on(table.applicationId, table.occurredAt),
    applicationFk: foreignKey({ name: 'fk_application_event_records_application', columns: [table.applicationId], foreignColumns: [applications.id] }),
    workspaceCheck: check('chk_application_event_records_workspace', sql`length(${table.workspaceId}) between 1 and 200`),
    typeCheck: check('chk_application_event_records_type', sql`length(${table.type}) between 1 and 100`),
    actorTypeCheck: check('chk_application_event_records_actor_type', sql`${table.actorType} in ('user','agent','system')`),
    summaryCheck: check('chk_application_event_records_summary', sql`length(${table.summary}) between 1 and 2000`),
  }),
)

export const applicationHistory = pgTable(
  'application_history',
  {
    applicationId: text('application_id').notNull(),
    revision: integer('revision').notNull(),
    kind: text('kind').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    auditJson: text('audit_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: 'application_history_pk', columns: [table.applicationId, table.revision] }),
    applicationFk: foreignKey({ name: 'fk_application_history_application', columns: [table.applicationId], foreignColumns: [applications.id] }),
    revisionCheck: check('chk_application_history_revision', sql`${table.revision} > 0`),
    kindCheck: check('chk_application_history_kind', sql`${table.kind} in ('created','status_changed','company_edited','source_edited','link_created','link_updated','link_removed','snapshot_refreshed','removed','restored')`),
    snapshotBoundCheck: check('chk_application_history_snapshot_bound', sql`length(${table.snapshotJson}) <= 262144`),
    auditBoundCheck: check('chk_application_history_audit_bound', sql`length(${table.auditJson}) <= 16384`),
    auditKeysCheck: check('chk_application_history_audit_keys', sql`${table.auditJson} ${sql.raw(FORBIDDEN_KEY)}`),
  }),
)

/** Application-owned operational projection state used by the derived Action Queue. */
export const applicationWorkflowStates = pgTable('application_workflow_states', {
  applicationId: text('application_id').primaryKey(),
  operationalStatus: text('operational_status').notNull().default('queued'),
  hasApplied: boolean('has_applied').notNull().default(false),
  lockStartedAt: text('lock_started_at'),
  holdStartedAt: text('hold_started_at'),
  manualReviewKind: text('manual_review_kind'),
  missingUserInfo: text('missing_user_info'),
  blockerReason: text('blocker_reason'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  applicationFk: foreignKey({
    name: 'fk_application_workflow_states_application',
    columns: [table.applicationId],
    foreignColumns: [applications.id],
  }),
}))

/** Immutable Application-owned score observations; the newest score drives queue priority. */
export const applicationScores = pgTable('application_scores', {
  id: text('id').primaryKey(),
  applicationId: text('application_id').notNull(),
  score: integer('score').notNull(),
  band: text('band').notNull(),
  roleRelevance: integer('role_relevance').notNull(),
  careerSignal: integer('career_signal').notNull(),
  cityWorkMode: integer('city_work_mode').notNull(),
  compensationLogistics: integer('compensation_logistics').notNull(),
  penaltiesJson: text('penalties_json').notNull(),
  rationale: text('rationale').notNull(),
  rubricVersion: text('rubric_version').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  applicationIdx: index('idx_application_scores_application').on(table.applicationId, table.createdAt),
  applicationFk: foreignKey({
    name: 'fk_application_scores_application',
    columns: [table.applicationId],
    foreignColumns: [applications.id],
  }),
}))
