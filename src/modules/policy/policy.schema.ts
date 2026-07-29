/** Policy configuration and the evidence recorded against policy subjects. */
import { index, pgTable, text } from 'drizzle-orm/pg-core'

export const policyConfig = pgTable('policy_config', {
  id: text('id').primaryKey(), configJson: text('config_json').notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
})

export const policyEvidence = pgTable('policy_evidence', {
  id: text('id').primaryKey(), subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(), tag: text('tag').notNull(),
  source: text('source').notNull(), note: text('note'),
  payloadJson: text('payload_json').notNull(), createdAt: text('created_at').notNull(),
}, (table) => ({
  subjectIdx: index('idx_policy_evidence_subject').on(table.subjectType, table.subjectId),
  subjectTagIdx: index('idx_policy_evidence_subject_tag').on(table.subjectType, table.subjectId, table.tag),
}))
