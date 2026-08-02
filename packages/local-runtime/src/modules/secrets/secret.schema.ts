/** Encrypted workspace secret state owned by the secrets module. */
import { pgTable, text } from 'drizzle-orm/pg-core'

export const workspaceSecrets = pgTable('workspace_secrets', {
  key: text('key').primaryKey(), label: text('label').notNull(),
  kind: text('kind').notNull(), encryptedValue: text('encrypted_value').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})
