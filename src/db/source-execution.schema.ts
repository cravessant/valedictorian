/**
 * Source execution scopes and their encrypted sessions.
 *
 * Lives in src/db (not the barrel) so the connector schema can bind its
 * execution-scope foreign keys without importing the barrel (which would cycle).
 */
import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, text } from 'drizzle-orm/pg-core'

const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
}

export const sourceExecutionScopes = pgTable('source_execution_scopes', {
  id: text('id').primaryKey(),
  status: text('status').notNull().default('available'),
  blockedUntil: text('blocked_until'),
  backoffAttempt: integer('backoff_attempt').notNull().default(0),
  authGeneration: integer('auth_generation').notNull().default(0),
  refreshLeaseToken: text('refresh_lease_token'),
  refreshLeaseExpiresAt: text('refresh_lease_expires_at'),
  actionReason: text('action_reason'),
  ...timestamps,
}, (table) => ({
  availabilityIdx: index('idx_source_execution_scopes_availability').on(table.status, table.blockedUntil),
  statusCheck: check('chk_source_execution_scopes_status', sql`${table.status} in ('available','cooldown','refreshing','action_required')`),
  idCheck: check('chk_source_execution_scopes_id', sql`length(${table.id}) between 8 and 256 and ${table.id} ~ '^[A-Za-z0-9._~-]+$'`),
  backoffCheck: check('chk_source_execution_scopes_backoff', sql`${table.backoffAttempt} >= 0`),
  generationCheck: check('chk_source_execution_scopes_generation', sql`${table.authGeneration} >= 0`),
  actionReasonCheck: check('chk_source_execution_scopes_action_reason', sql`${table.actionReason} is null or ${table.actionReason} ~ '^[a-z0-9_]{1,64}$'`),
}))

export const sourceExecutionSessions = pgTable('source_execution_sessions', {
  executionScopeId: text('execution_scope_id').primaryKey().references(() => sourceExecutionScopes.id),
  encryptedSession: text('encrypted_session').notNull(),
  authGeneration: integer('auth_generation').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => ({
  sessionLength: check('chk_source_execution_sessions_length', sql`length(${table.encryptedSession}) between 1 and 1048576`),
  generationCheck: check('chk_source_execution_sessions_generation', sql`${table.authGeneration} >= 1`),
}))
