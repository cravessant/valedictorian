/**
 * Opportunity aggregate schema (issue #298). Owned by the opportunity module.
 *
 * Canonical root uses the interim physical name `lifecycle_opportunities` (avoids
 * colliding with the still-live legacy `opportunities`). #298 installs and
 * one-time-transforms these tables but does not rewire the runtime; the Opportunity
 * leaf (#301) adopts them and the clean-cutover leaf (#307) drops legacy and renames
 * it to `opportunities` (see drizzle/lifecycle-migration.md).
 * "Normalized Opportunity identity" is the direct workspace-scoped Job reference
 * plus a partial unique on (workspace_id, job_id) — replacing the legacy
 * JSON-scanned projection aliases. Vocabulary mirrors the sparxie contract
 * (src/db/lifecycle-vocabulary.ts). The Job-workspace and append-only history
 * triggers are installed by the journaled migration and not modeled here.
 */
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { FORBIDDEN_JSON_KEY_PREDICATE } from '../../db/sensitive-keys'
import { lifecycleJobs } from '../job/job.schema'
import { workspaces } from '../../db/workspaces.schema'

const FORBIDDEN_KEY = FORBIDDEN_JSON_KEY_PREDICATE

export const lifecycleOpportunities = pgTable(
  'lifecycle_opportunities',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
    jobId: text('job_id').notNull(),
    revision: integer('revision').notNull(),
    fit: text('fit').notNull(),
    rank: integer('rank'),
    cutoff: text('cutoff').notNull(),
    disposition: text('disposition').notNull(),
    overrideJson: text('override_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    removedAt: text('removed_at'),
  },
  (table) => ({
    jobIdx: uniqueIndex('idx_lifecycle_opportunities_job').on(table.workspaceId, table.jobId).where(sql`${table.removedAt} is null`),
    jobRefIdx: index('idx_lifecycle_opportunities_job_ref').on(table.jobId),
    jobFk: foreignKey({ name: 'fk_lifecycle_opportunities_job', columns: [table.jobId], foreignColumns: [lifecycleJobs.id] }),
    workspaceCheck: check('chk_lifecycle_opportunities_workspace', sql`length(${table.workspaceId}) between 1 and 200`),
    revisionCheck: check('chk_lifecycle_opportunities_revision', sql`${table.revision} > 0`),
    fitCheck: check('chk_lifecycle_opportunities_fit', sql`${table.fit} in ('fit','possible','not_fit','unknown')`),
    rankCheck: check('chk_lifecycle_opportunities_rank', sql`${table.rank} is null or ${table.rank} > 0`),
    cutoffCheck: check('chk_lifecycle_opportunities_cutoff', sql`${table.cutoff} in ('above','below','not_evaluated')`),
    dispositionCheck: check('chk_lifecycle_opportunities_disposition', sql`${table.disposition} in ('reviewing','pursue','hold','declined','archived')`),
    overrideBoundCheck: check('chk_lifecycle_opportunities_override_bound', sql`${table.overrideJson} is null or length(${table.overrideJson}) <= 16384`),
  }),
)

export const opportunityHistory = pgTable(
  'opportunity_history',
  {
    opportunityId: text('opportunity_id').notNull(),
    revision: integer('revision').notNull(),
    kind: text('kind').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    auditJson: text('audit_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: 'opportunity_history_pk', columns: [table.opportunityId, table.revision] }),
    opportunityFk: foreignKey({ name: 'fk_opportunity_history_opportunity', columns: [table.opportunityId], foreignColumns: [lifecycleOpportunities.id] }),
    revisionCheck: check('chk_opportunity_history_revision', sql`${table.revision} > 0`),
    kindCheck: check('chk_opportunity_history_kind', sql`${table.kind} in ('created','evaluation_changed','disposition_changed','removed','restored')`),
    snapshotBoundCheck: check('chk_opportunity_history_snapshot_bound', sql`length(${table.snapshotJson}) <= 262144`),
    auditBoundCheck: check('chk_opportunity_history_audit_bound', sql`length(${table.auditJson}) <= 16384`),
    auditKeysCheck: check('chk_opportunity_history_audit_keys', sql`${table.auditJson} ${sql.raw(FORBIDDEN_KEY)}`),
  }),
)
