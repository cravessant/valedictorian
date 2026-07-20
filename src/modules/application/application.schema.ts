/**
 * Application aggregate schema (issue #298). Owned by the application module.
 *
 * Canonical root uses the interim physical name `lifecycle_applications` (avoids
 * colliding with the still-live legacy `applications`/`application_*`). #298
 * installs and one-time-transforms these tables but does not rewire the runtime;
 * the Application leaf (#302) adopts them and the clean-cutover leaf (#307) drops
 * legacy and renames it to `applications` (see drizzle/lifecycle-migration.md).
 * Relation tables use distinct canonical names (`pursuit_links`,
 * `application_attempt_records`, `application_event_records`, `application_history`),
 * so they need no rename. Vocabulary mirrors the sparxie contract
 * (src/db/lifecycle-vocabulary.ts). The Opportunity-and-Job lineage and
 * append-only history triggers are installed by the journaled migration.
 */
import { sql } from 'drizzle-orm'
import { boolean, check, foreignKey, index, integer, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { FORBIDDEN_JSON_KEY_PREDICATE } from '../../db/sensitive-keys'
import { lifecycleJobs } from '../job/job.schema'
import { lifecycleOpportunities } from '../opportunity/opportunity.schema'
import { workspaces } from '../../db/workspaces.schema'

const FORBIDDEN_KEY = FORBIDDEN_JSON_KEY_PREDICATE

export const lifecycleApplications = pgTable(
  'lifecycle_applications',
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
  },
  (table) => ({
    opportunityIdx: uniqueIndex('idx_lifecycle_applications_opportunity').on(table.workspaceId, table.opportunityId).where(sql`${table.removedAt} is null`),
    jobIdx: index('idx_lifecycle_applications_job').on(table.jobId),
    opportunityFk: foreignKey({ name: 'fk_lifecycle_applications_opportunity', columns: [table.opportunityId], foreignColumns: [lifecycleOpportunities.id] }),
    jobFk: foreignKey({ name: 'fk_lifecycle_applications_job', columns: [table.jobId], foreignColumns: [lifecycleJobs.id] }),
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
    applicationFk: foreignKey({ name: 'fk_pursuit_links_application', columns: [table.applicationId], foreignColumns: [lifecycleApplications.id] }),
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
    applicationFk: foreignKey({ name: 'fk_application_attempt_records_application', columns: [table.applicationId], foreignColumns: [lifecycleApplications.id] }),
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
    applicationFk: foreignKey({ name: 'fk_application_event_records_application', columns: [table.applicationId], foreignColumns: [lifecycleApplications.id] }),
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
    applicationFk: foreignKey({ name: 'fk_application_history_application', columns: [table.applicationId], foreignColumns: [lifecycleApplications.id] }),
    revisionCheck: check('chk_application_history_revision', sql`${table.revision} > 0`),
    kindCheck: check('chk_application_history_kind', sql`${table.kind} in ('created','status_changed','company_edited','source_edited','link_created','link_updated','link_removed','snapshot_refreshed','removed','restored')`),
    snapshotBoundCheck: check('chk_application_history_snapshot_bound', sql`length(${table.snapshotJson}) <= 262144`),
    auditBoundCheck: check('chk_application_history_audit_bound', sql`length(${table.auditJson}) <= 16384`),
    auditKeysCheck: check('chk_application_history_audit_keys', sql`${table.auditJson} ${sql.raw(FORBIDDEN_KEY)}`),
  }),
)
