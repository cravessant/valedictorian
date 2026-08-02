/**
 * Workspace ownership root.
 *
 * Lives in src/db (not a module) so every module schema can add a workspace_id
 * foreign key to `workspaces` without importing the barrel (which would cycle).
 *
 * Registry-id mapping: each local workspace owns its OWN PGlite database
 * (packages/local-runtime/src/server/local-workspaces.ts resolves one client per workspace), and there
 * is no in-database workspace registry — the registry is a JSON file keyed by a
 * random workspace UUID outside the database. A per-workspace database therefore
 * cannot know its own registry id at migration time, so the runtime seeds its
 * registry workspace row when it opens the database. The cloud deployment, which
 * hosts many workspaces per database, will assign real workspace ids in its own
 * (separate) path.
 */
import { sql } from 'drizzle-orm'
import { check, pgTable, text } from 'drizzle-orm/pg-core'

/**
 * Owns work that is scheduled outside any registry workspace — connector capture
 * work is keyed by connector instance and filter signature, not by workspace, so
 * it needs a workspace row that exists before any registry workspace is known.
 * `migratePgliteDatabase` seeds this row, so every migrated database has it.
 */
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
