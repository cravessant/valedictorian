/**
 * Workspace ownership root and the migration integrity report (issue #298).
 *
 * Lives in src/db (not a module) so every module schema can add a workspace_id
 * foreign key to `workspaces` without importing the barrel (which would cycle).
 *
 * Registry-id mapping: each local workspace owns its OWN PGlite database
 * (src/server/local-workspaces.ts resolves one client per workspace), and there
 * is no in-database workspace registry — the registry is a JSON file keyed by a
 * random workspace UUID outside the database. A per-workspace database therefore
 * cannot know its own registry id at migration time, so the journaled migration
 * seeds ONE deterministic default workspace row (the nil UUID) inside its
 * transaction and backfills every pre-lifecycle row to it. Runtime maps the
 * registry's workspace id to this fixed nil-UUID row for the local deployment;
 * the cloud deployment, which hosts many workspaces per database, will assign
 * real workspace ids in its own (separate) path.
 */
import { sql } from 'drizzle-orm'
import { check, index, pgTable, text } from 'drizzle-orm/pg-core'
import { FORBIDDEN_JSON_KEY_PREDICATE } from './sensitive-keys'

/** The deterministic default workspace seeded by the 0001 transform. */
export const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000000'

export const workspaces = pgTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    idCheck: check('chk_workspaces_id', sql`length(${table.id}) between 1 and 200`),
    nameCheck: check('chk_workspaces_name', sql`length(${table.name}) between 1 and 200`),
  }),
)

/**
 * Bounded, sanitized enumeration of every deterministic reset, quarantine, or
 * synthesis the 0001 transform performed. Append-only history of what the
 * migration could not carry over verbatim, with the source row identity.
 */
export const lifecycleMigrationReport = pgTable(
  'lifecycle_migration_report',
  {
    id: text('id').primaryKey(),
    category: text('category').notNull(),
    sourceTable: text('source_table').notNull(),
    sourceId: text('source_id').notNull(),
    reason: text('reason').notNull(),
    detailJson: text('detail_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    categoryIdx: index('idx_lifecycle_migration_report_category').on(table.category, table.sourceTable),
    categoryCheck: check('chk_lifecycle_migration_report_category', sql`${table.category} in ('reset','quarantine','synthesized')`),
    sourceTableCheck: check('chk_lifecycle_migration_report_source_table', sql`length(${table.sourceTable}) between 1 and 128`),
    sourceIdCheck: check('chk_lifecycle_migration_report_source_id', sql`length(${table.sourceId}) between 1 and 256`),
    reasonCheck: check('chk_lifecycle_migration_report_reason', sql`length(${table.reason}) between 1 and 512`),
    detailBoundCheck: check('chk_lifecycle_migration_report_detail_bound', sql`length(${table.detailJson}) <= 16384`),
    detailKeysCheck: check('chk_lifecycle_migration_report_detail_keys', sql`${table.detailJson} ${sql.raw(FORBIDDEN_JSON_KEY_PREDICATE)}`),
  }),
)
