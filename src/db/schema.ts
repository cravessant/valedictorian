import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
}

export const companies = sqliteTable('companies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  websiteUrl: text('website_url'),
  ...timestamps,
})

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  accountHint: text('account_hint'),
  ...timestamps,
})

export const applications = sqliteTable('applications', {
  id: text('id').primaryKey(),
  companyId: text('company_id')
    .notNull()
    .references(() => companies.id),
  sourceId: text('source_id')
    .notNull()
    .references(() => sources.id),
  roleTitle: text('role_title').notNull(),
  roleKind: text('role_kind').notNull(),
  term: text('term'),
  city: text('city'),
  region: text('region'),
  country: text('country').notNull(),
  workMode: text('work_mode').notNull(),
  locationRaw: text('location_raw'),
  status: text('status').notNull(),
  hasApplied: integer('has_applied', { mode: 'boolean' }).notNull(),
  currentPriorityScore: integer('current_priority_score'),
  currentPriorityBand: text('current_priority_band'),
  currentResumeVariant: text('current_resume_variant'),
  notes: text('notes'),
  ...timestamps,
})

export const applicationLinks = sqliteTable('application_links', {
  id: text('id').primaryKey(),
  applicationId: text('application_id')
    .notNull()
    .references(() => applications.id),
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  url: text('url').notNull(),
  externalId: text('external_id'),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull(),
  discoveredAt: text('discovered_at').notNull(),
  ...timestamps,
})

export const applicationScores = sqliteTable('application_scores', {
  id: text('id').primaryKey(),
  applicationId: text('application_id')
    .notNull()
    .references(() => applications.id),
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
})

export const schema = {
  applicationLinks,
  applicationScores,
  applications,
  companies,
  sources,
}
