import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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

export const sources = sqliteTable(
  'sources',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    accountHint: text('account_hint'),
    ...timestamps,
  },
  (table) => ({
    nameIdx: index('idx_sources_name').on(table.name),
  }),
)

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

export const applicationWorkflowStates = sqliteTable('application_workflow_states', {
  applicationId: text('application_id')
    .primaryKey()
    .references(() => applications.id),
  lockStartedAt: text('lock_started_at'),
  holdStartedAt: text('hold_started_at'),
  manualReviewKind: text('manual_review_kind'),
  missingUserInfo: text('missing_user_info'),
  blockerReason: text('blocker_reason'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const applicationEvents = sqliteTable('application_events', {
  id: text('id').primaryKey(),
  applicationId: text('application_id')
    .notNull()
    .references(() => applications.id),
  type: text('type').notNull(),
  message: text('message').notNull(),
  payloadJson: text('payload_json').notNull(),
  actor: text('actor').notNull(),
  createdAt: text('created_at').notNull(),
})

export const applicationAttempts = sqliteTable('application_attempts', {
  id: text('id').primaryKey(),
  applicationId: text('application_id')
    .notNull()
    .references(() => applications.id),
  status: text('status').notNull(),
  outcome: text('outcome'),
  actorType: text('actor_type').notNull(),
  actorName: text('actor_name'),
  entryUrl: text('entry_url'),
  resumeVariant: text('resume_variant'),
  resumeArtifactPath: text('resume_artifact_path'),
  summary: text('summary'),
  stopReason: text('stop_reason'),
  confirmationUrl: text('confirmation_url'),
  confirmationText: text('confirmation_text'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const applicationAttemptSteps = sqliteTable('application_attempt_steps', {
  id: text('id').primaryKey(),
  attemptId: text('attempt_id')
    .notNull()
    .references(() => applicationAttempts.id),
  applicationId: text('application_id')
    .notNull()
    .references(() => applications.id),
  sequence: integer('sequence').notNull(),
  type: text('type').notNull(),
  message: text('message').notNull(),
  payloadJson: text('payload_json').notNull(),
  actor: text('actor').notNull(),
  createdAt: text('created_at').notNull(),
})

export const workflowRuns = sqliteTable(
  'workflow_runs',
  {
    id: text('id').primaryKey(),
    runType: text('run_type').notNull(),
    status: text('status').notNull(),
    actorType: text('actor_type').notNull(),
    actorName: text('actor_name'),
    sourceId: text('source_id').references(() => sources.id),
    subjectApplicationId: text('subject_application_id').references(() => applications.id),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
    coverageStartedAt: text('coverage_started_at'),
    coverageEndedAt: text('coverage_ended_at'),
    timezone: text('timezone'),
    inputJson: text('input_json').notNull(),
    summary: text('summary'),
    outcome: text('outcome'),
    blocker: text('blocker'),
    metadataJson: text('metadata_json').notNull(),
    ...timestamps,
  },
  (table) => ({
    sourceIdx: index('idx_workflow_runs_source_id').on(table.sourceId),
    sourceTypeStatusStartedIdx: index('idx_workflow_runs_source_type_status_started').on(
      table.sourceId,
      table.runType,
      table.status,
      table.startedAt,
    ),
  }),
)

export const workflowRunSteps = sqliteTable('workflow_run_steps', {
  id: text('id').primaryKey(),
  workflowRunId: text('workflow_run_id')
    .notNull()
    .references(() => workflowRuns.id),
  sequence: integer('sequence').notNull(),
  type: text('type').notNull(),
  message: text('message').notNull(),
  payloadJson: text('payload_json').notNull(),
  actor: text('actor').notNull(),
  createdAt: text('created_at').notNull(),
})

export const userProfile = sqliteTable('user_profile', {
  id: text('id').primaryKey(),
  addressLine1: text('address_line_1'),
  addressLine2: text('address_line_2'),
  city: text('city'),
  country: text('country'),
  citizenship: text('citizenship'),
  classStanding: text('class_standing'),
  coverLetterPath: text('cover_letter_path'),
  degree: text('degree'),
  email: text('email'),
  fullName: text('full_name'),
  githubUrl: text('github_url'),
  graduationDate: text('graduation_date'),
  highSchool: text('high_school'),
  language: text('language'),
  linkedinUrl: text('linkedin_url'),
  major: text('major'),
  phone: text('phone'),
  phoneDeviceType: text('phone_device_type'),
  portfolioUrl: text('portfolio_url'),
  preferredName: text('preferred_name'),
  region: text('region'),
  relocation: text('relocation'),
  relocationNotes: text('relocation_notes'),
  requireSponsorship: text('require_sponsorship'),
  requireSponsorshipFuture: text('require_sponsorship_future'),
  satScore: text('sat_score'),
  school: text('school'),
  transcriptPath: text('transcript_path'),
  travel: text('travel'),
  travelNotes: text('travel_notes'),
  willingToRelocate: integer('willing_to_relocate', { mode: 'boolean' }),
  willingToTravel: integer('willing_to_travel', { mode: 'boolean' }),
  workAuthorization: text('work_authorization'),
  ...timestamps,
})

export const profileEducation = sqliteTable('profile_education', {
  id: text('id').primaryKey(),
  educationType: text('education_type').notNull(),
  school: text('school').notNull(),
  degree: text('degree'),
  major: text('major'),
  graduationDate: text('graduation_date'),
  classStanding: text('class_standing'),
  satScore: text('sat_score'),
  transcriptPath: text('transcript_path'),
  notes: text('notes'),
  sortOrder: integer('sort_order').notNull(),
  ...timestamps,
})

export const profileAnswers = sqliteTable('profile_answers', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  questionPattern: text('question_pattern').notNull(),
  answer: text('answer').notNull(),
  category: text('category'),
  includeInAgentContext: integer('include_in_agent_context', { mode: 'boolean' }).notNull(),
  ...timestamps,
})

export const profileSecrets = sqliteTable('profile_secrets', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  kind: text('kind').notNull(),
  encryptedValue: text('encrypted_value').notNull(),
  ...timestamps,
})

export const profileSensitiveDetails = sqliteTable('profile_sensitive_details', {
  id: text('id').primaryKey(),
  birthDayEncrypted: text('birth_day_encrypted'),
  birthMonthEncrypted: text('birth_month_encrypted'),
  birthYearEncrypted: text('birth_year_encrypted'),
  dateOfBirthEncrypted: text('date_of_birth_encrypted'),
  disabilityStatusEncrypted: text('disability_status_encrypted'),
  genderEncrypted: text('gender_encrypted'),
  hispanicLatinoEncrypted: text('hispanic_latino_encrypted'),
  raceEthnicityEncrypted: text('race_ethnicity_encrypted'),
  ssnLast4Encrypted: text('ssn_last_4_encrypted'),
  veteranStatusEncrypted: text('veteran_status_encrypted'),
  ...timestamps,
})

export const policyConfig = sqliteTable('policy_config', {
  id: text('id').primaryKey(),
  configJson: text('config_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const policyEvidence = sqliteTable(
  'policy_evidence',
  {
    id: text('id').primaryKey(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    tag: text('tag').notNull(),
    source: text('source').notNull(),
    note: text('note'),
    payloadJson: text('payload_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    subjectIdx: index('idx_policy_evidence_subject').on(table.subjectType, table.subjectId),
    subjectTagIdx: index('idx_policy_evidence_subject_tag').on(
      table.subjectType,
      table.subjectId,
      table.tag,
    ),
  }),
)

export const sourcingFindings = sqliteTable(
  'sourcing_findings',
  {
    id: text('id').primaryKey(),
    workflowRunId: text('workflow_run_id')
      .notNull()
      .references(() => workflowRuns.id),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id),
    companyName: text('company_name').notNull(),
    roleTitle: text('role_title').notNull(),
    roleKind: text('role_kind').notNull(),
    term: text('term'),
    city: text('city'),
    region: text('region'),
    country: text('country').notNull(),
    workMode: text('work_mode').notNull(),
    locationRaw: text('location_raw'),
    officialUrl: text('official_url'),
    sourceUrl: text('source_url'),
    postedAge: text('posted_age'),
    priorityScore: integer('priority_score'),
    priorityBand: text('priority_band'),
    fitNotes: text('fit_notes'),
    duplicateNotes: text('duplicate_notes'),
    blocker: text('blocker'),
    policyBlocker: text('policy_blocker'),
    dispositionReason: text('disposition_reason'),
    mergeStatus: text('merge_status').notNull(),
    mergedApplicationId: text('merged_application_id').references(() => applications.id),
    mergeNotes: text('merge_notes'),
    discoveredAt: text('discovered_at').notNull(),
    ...timestamps,
  },
  (table) => ({
    sourceIdx: index('idx_sourcing_findings_source_id').on(table.sourceId),
    sourceStatusDiscoveredIdx: index('idx_sourcing_findings_source_status_discovered').on(
      table.sourceId,
      table.mergeStatus,
      table.discoveredAt,
    ),
  }),
)

export const schema = {
  applicationAttemptSteps,
  applicationAttempts,
  applicationEvents,
  applicationLinks,
  applicationScores,
  applicationWorkflowStates,
  applications,
  companies,
  policyConfig,
  policyEvidence,
  profileAnswers,
  profileEducation,
  profileSensitiveDetails,
  profileSecrets,
  sourcingFindings,
  sources,
  userProfile,
  workflowRunSteps,
  workflowRuns,
}
