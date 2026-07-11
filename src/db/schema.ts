import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

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
  timingMode: text('timing_mode').notNull().default('unknown'),
  termsJson: text('terms_json').notNull().default('[]'),
  startDate: text('start_date'),
  endDate: text('end_date'),
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

export const connectorInstances = sqliteTable(
  'connector_instances',
  {
    id: text('id').primaryKey(),
    connectorId: text('connector_id').notNull(),
    connectorVersion: text('connector_version').notNull(),
    displayName: text('display_name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    configJson: text('config_json').notNull(),
    authJson: text('auth_json').notNull().default('[]'),
    filtersJson: text('filters_json').notNull().default('{}'),
    ...timestamps,
  },
  (table) => ({
    connectorIdx: index('idx_connector_instances_connector').on(table.connectorId),
    enabledIdx: index('idx_connector_instances_enabled').on(table.enabled),
  }),
)

export const connectorRuns = sqliteTable(
  'connector_runs',
  {
    id: text('id').primaryKey(),
    connectorInstanceId: text('connector_instance_id')
      .notNull()
      .references(() => connectorInstances.id),
    mode: text('mode').notNull(),
    status: text('status').notNull(),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
    coverageStartedAt: text('coverage_started_at'),
    coverageEndedAt: text('coverage_ended_at'),
    configJson: text('config_json').notNull().default('{}'),
    filtersJson: text('filters_json').notNull().default('{}'),
    filterSignature: text('filter_signature').notNull().default('filters:{}'),
    observationCount: integer('observation_count').notNull(),
    warningCount: integer('warning_count').notNull(),
    statsJson: text('stats_json').notNull(),
    warningsJson: text('warnings_json').notNull(),
    retryHintsJson: text('retry_hints_json').notNull(),
    ...timestamps,
  },
  (table) => ({
    ownerIdx: uniqueIndex('idx_connector_runs_id_instance').on(
      table.id,
      table.connectorInstanceId,
    ),
    instanceIdx: index('idx_connector_runs_instance').on(table.connectorInstanceId),
    instanceStatusStartedIdx: index('idx_connector_runs_instance_status_started').on(
      table.connectorInstanceId,
      table.status,
      table.startedAt,
    ),
  }),
)

export const connectorCheckpoints = sqliteTable(
  'connector_checkpoints',
  {
    connectorInstanceId: text('connector_instance_id')
      .notNull()
      .references(() => connectorInstances.id),
    filterSignature: text('filter_signature').notNull().default('filters:{}'),
    checkpointJson: text('checkpoint_json').notNull(),
    schemaVersion: text('schema_version').notNull(),
    coverageStartedAt: text('coverage_started_at'),
    coverageEndedAt: text('coverage_ended_at'),
    savedAt: text('saved_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.connectorInstanceId, table.filterSignature] }),
    instanceIdx: index('idx_connector_checkpoints_instance').on(table.connectorInstanceId),
  }),
)

export const connectorObservations = sqliteTable(
  'connector_observations',
  {
    id: text('id').primaryKey(),
    connectorInstanceId: text('connector_instance_id')
      .notNull()
      .references(() => connectorInstances.id),
    connectorRunId: text('connector_run_id')
      .notNull()
      .references(() => connectorRuns.id),
    connectorId: text('connector_id').notNull(),
    connectorVersion: text('connector_version').notNull(),
    parserVersion: text('parser_version'),
    observationSchemaVersion: text('observation_schema_version'),
    sourceRecordKey: text('source_record_key').notNull(),
    observedAt: text('observed_at').notNull(),
    companyName: text('company_name').notNull(),
    roleTitle: text('role_title').notNull(),
    locationRaw: text('location_raw'),
    descriptionText: text('description_text'),
    payJson: text('pay_json').notNull(),
    linksJson: text('links_json').notNull(),
    resolutionJson: text('resolution_json').notNull(),
    dedupeKeysJson: text('dedupe_keys_json').notNull(),
    sourceMetadataJson: text('source_metadata_json').notNull(),
    evidenceJson: text('evidence_json').notNull(),
    rawJson: text('raw_json').notNull(),
    ...timestamps,
  },
  (table) => ({
    instanceIdx: index('idx_connector_observations_instance').on(table.connectorInstanceId),
    runIdx: index('idx_connector_observations_run').on(table.connectorRunId),
    sourceRecordIdx: index('idx_connector_observations_source_record').on(
      table.connectorInstanceId,
      table.sourceRecordKey,
    ),
  }),
)

export const sourceEntities = sqliteTable(
  'source_entities',
  {
    id: text('id').primaryKey(),
    identityKind: text('identity_kind').notNull(),
    identityNamespace: text('identity_namespace').notNull(),
    identityValue: text('identity_value').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    identityIdx: uniqueIndex('idx_source_entities_identity').on(
      table.identityKind,
      table.identityNamespace,
      table.identityValue,
    ),
    identityKindLength: check(
      'chk_source_entities_identity_kind_length',
      sql`length(${table.identityKind}) between 1 and 64`,
    ),
    identityNamespaceLength: check(
      'chk_source_entities_identity_namespace_length',
      sql`length(${table.identityNamespace}) between 1 and 4096`,
    ),
    identityValueLength: check(
      'chk_source_entities_identity_value_length',
      sql`length(${table.identityValue}) between 1 and 2048`,
    ),
  }),
)

export const sourceEntityIdentities = sqliteTable(
  'source_entity_identities',
  {
    id: text('id').primaryKey(),
    sourceEntityId: text('source_entity_id').notNull().references(() => sourceEntities.id),
    identityKind: text('identity_kind').notNull(),
    identityNamespace: text('identity_namespace').notNull(),
    identityValue: text('identity_value').notNull(),
    provenanceKind: text('provenance_kind').notNull(),
    provenanceVersion: text('provenance_version').notNull(),
    evidenceJson: text('evidence_json').notNull(),
    rawRevisionId: text('raw_revision_id').references(() => rawSourceRevisions.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    identityIdx: uniqueIndex('idx_source_entity_identities_identity').on(
      table.identityKind,
      table.identityNamespace,
      table.identityValue,
    ),
    entityChronologyIdx: index('idx_source_entity_identities_entity_chronology').on(
      table.sourceEntityId,
      table.createdAt,
      table.id,
    ),
    kindCheck: check('chk_source_entity_identities_kind', sql`${table.identityKind} in ('provider_job','canonical_destination','intermediary_alias','destination_alias')`),
    namespaceLength: check('chk_source_entity_identities_namespace_length', sql`length(${table.identityNamespace}) between 1 and 512`),
    valueLength: check('chk_source_entity_identities_value_length', sql`length(${table.identityValue}) between 1 and 2048`),
    provenanceKindCheck: check('chk_source_entity_identities_provenance_kind', sql`${table.provenanceKind} in ('primary_backfill','capture','normalization')`),
    provenanceVersionLength: check('chk_source_entity_identities_provenance_version_length', sql`length(${table.provenanceVersion}) between 1 and 128`),
    evidenceLength: check('chk_source_entity_identities_evidence_length', sql`length(${table.evidenceJson}) between 2 and 16384`),
  }),
)

export const sourceIdentityConflicts = sqliteTable(
  'source_identity_conflicts',
  {
    id: text('id').primaryKey(),
    sourceEntityId: text('source_entity_id').notNull().references(() => sourceEntities.id),
    conflictingSourceEntityId: text('conflicting_source_entity_id').references(() => sourceEntities.id),
    rawRevisionId: text('raw_revision_id').notNull().references(() => rawSourceRevisions.id),
    identityKind: text('identity_kind').notNull(),
    identityNamespace: text('identity_namespace').notNull(),
    identityValue: text('identity_value').notNull(),
    reason: text('reason').notNull(),
    provenanceVersion: text('provenance_version').notNull(),
    evidenceJson: text('evidence_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    occurrenceIdx: uniqueIndex('idx_source_identity_conflicts_occurrence').on(
      table.sourceEntityId,
      table.rawRevisionId,
      table.identityKind,
      table.identityNamespace,
      table.identityValue,
      table.reason,
    ),
    chronologyIdx: index('idx_source_identity_conflicts_chronology').on(table.createdAt, table.id),
    kindCheck: check('chk_source_identity_conflicts_kind', sql`${table.identityKind} in ('provider_job','canonical_destination','intermediary_alias','destination_alias')`),
    namespaceLength: check('chk_source_identity_conflicts_namespace_length', sql`length(${table.identityNamespace}) between 1 and 512`),
    valueLength: check('chk_source_identity_conflicts_value_length', sql`length(${table.identityValue}) between 1 and 2048`),
    reasonLength: check('chk_source_identity_conflicts_reason_length', sql`length(${table.reason}) between 1 and 512`),
    provenanceVersionLength: check('chk_source_identity_conflicts_provenance_version_length', sql`length(${table.provenanceVersion}) between 1 and 128`),
    evidenceLength: check('chk_source_identity_conflicts_evidence_length', sql`length(${table.evidenceJson}) between 2 and 16384`),
  }),
)

export const rawSourceRecords = sqliteTable(
  'raw_source_records',
  {
    id: text('id').primaryKey(),
    sourceEntityId: text('source_entity_id').references(() => sourceEntities.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    sourceEntityIdx: uniqueIndex('idx_raw_source_records_source_entity').on(table.sourceEntityId),
  }),
)

export const rawSourceRevisions = sqliteTable(
  'raw_source_revisions',
  {
    id: text('id').primaryKey(),
    rawRecordId: text('raw_record_id')
      .notNull()
      .references(() => rawSourceRecords.id),
    revision: integer('revision').notNull(),
    contentHash: text('content_hash').notNull(),
    adapterId: text('adapter_id').notNull(),
    adapterKind: text('adapter_kind').notNull(),
    adapterVersion: text('adapter_version').notNull(),
    reportedOriginKind: text('reported_origin_kind'),
    reportedOriginName: text('reported_origin_name'),
    reportedOriginProviderId: text('reported_origin_provider_id'),
    reportedOriginUrl: text('reported_origin_url'),
    observedAt: text('observed_at').notNull(),
    providerRecordId: text('provider_record_id'),
    providerSchema: text('provider_schema'),
    payloadJson: text('payload_json'),
    evidenceJson: text('evidence_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    recordIdIdx: uniqueIndex('idx_raw_source_revisions_id_record').on(
      table.id,
      table.rawRecordId,
    ),
    recordRevisionIdx: uniqueIndex('idx_raw_source_revisions_record_revision').on(
      table.rawRecordId,
      table.revision,
    ),
    recordHashIdx: uniqueIndex('idx_raw_source_revisions_record_hash').on(
      table.rawRecordId,
      table.contentHash,
    ),
  }),
)

export const retryWork = sqliteTable(
  'retry_work',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    connectorInstanceId: text('connector_instance_id').references(() => connectorInstances.id),
    filterSignature: text('filter_signature'),
    checkpointSchemaVersion: text('checkpoint_schema_version'),
    checkpointGeneration: text('checkpoint_generation'),
    rawRevisionId: text('raw_revision_id').references(() => rawSourceRevisions.id),
    resolverId: text('resolver_id'),
    resolverVersion: text('resolver_version'),
    inputHash: text('input_hash'),
    reason: text('reason').notNull(),
    attempt: integer('attempt').notNull(),
    maxAttempts: integer('max_attempts').notNull(),
    lastAttemptAt: text('last_attempt_at').notNull(),
    computedDelayMs: integer('computed_delay_ms'),
    serverMinimumDelayMs: integer('server_minimum_delay_ms'),
    nextAttemptAt: text('next_attempt_at'),
    horizonAt: text('horizon_at').notNull(),
    state: text('state').notNull(),
    ownerVersion: text('owner_version').notNull(),
    lineageJson: text('lineage_json').notNull(),
    acquiredAt: text('acquired_at'),
    acquisitionToken: text('acquisition_token'),
    acquisitionRunId: text('acquisition_run_id').references(() => connectorRuns.id),
    skippedRunId: text('skipped_run_id').references(() => connectorRuns.id),
    ...timestamps,
  },
  (table) => ({
    captureIdentityIdx: uniqueIndex('idx_retry_work_capture_identity').on(
      table.connectorInstanceId,
      table.filterSignature,
      table.checkpointSchemaVersion,
      table.checkpointGeneration,
    ).where(sql`${table.kind} = 'connector_capture' and ${table.deletedAt} is null`),
    normalizationIdentityIdx: uniqueIndex('idx_retry_work_normalization_identity').on(
      table.rawRevisionId,
      table.resolverId,
      table.resolverVersion,
      table.inputHash,
    ).where(sql`${table.kind} = 'normalization' and ${table.deletedAt} is null`),
    dueIdx: index('idx_retry_work_due').on(table.state, table.nextAttemptAt),
    kindCheck: check('chk_retry_work_kind', sql`${table.kind} in ('connector_capture','normalization')`),
    reasonCheck: check('chk_retry_work_reason', sql`${table.reason} in ('rate_limit','server_failure','network_interruption','operation_timeout')`),
    stateCheck: check('chk_retry_work_state', sql`${table.state} in ('scheduled','acquired','completed','exhausted','cancelled')`),
    attemptCheck: check('chk_retry_work_attempt', sql`${table.attempt} >= 1 and ${table.maxAttempts} >= ${table.attempt}`),
    serverMinimumCheck: check('chk_retry_work_server_minimum', sql`${table.serverMinimumDelayMs} is null or ${table.serverMinimumDelayMs} >= 0`),
    scopeCheck: check('chk_retry_work_scope', sql`(
      ${table.kind} = 'connector_capture'
      and ${table.connectorInstanceId} is not null
      and ${table.filterSignature} is not null
      and ${table.checkpointSchemaVersion} is not null
      and ${table.checkpointGeneration} is not null
      and ${table.rawRevisionId} is null
      and ${table.resolverId} is null
      and ${table.resolverVersion} is null
      and ${table.inputHash} is null
    ) or (
      ${table.kind} = 'normalization'
      and ${table.connectorInstanceId} is null
      and ${table.filterSignature} is null
      and ${table.checkpointSchemaVersion} is null
      and ${table.checkpointGeneration} is null
      and ${table.rawRevisionId} is not null
      and ${table.resolverId} is not null
      and ${table.resolverVersion} is not null
      and ${table.inputHash} is not null
    )`),
    timingCheck: check('chk_retry_work_timing', sql`(
      ${table.state} in ('scheduled','acquired')
      and ${table.computedDelayMs} is not null
      and ${table.computedDelayMs} >= 0
      and ${table.nextAttemptAt} is not null
    ) or (
      ${table.state} in ('completed','exhausted','cancelled')
      and ${table.nextAttemptAt} is null
    )`),
  }),
)

export const rawSourceOccurrences = sqliteTable(
  'raw_source_occurrences',
  {
    id: text('id').primaryKey(),
    rawRecordId: text('raw_record_id')
      .notNull()
      .references(() => rawSourceRecords.id),
    rawRevisionId: text('raw_revision_id')
      .notNull()
      .references(() => rawSourceRevisions.id),
    connectorInstanceId: text('connector_instance_id').references(() => connectorInstances.id),
    connectorRunId: text('connector_run_id').references(() => connectorRuns.id),
    observedAt: text('observed_at').notNull(),
    receivedAt: text('received_at').notNull(),
  },
  (table) => ({
    lineageIdx: uniqueIndex('idx_raw_source_occurrences_lineage').on(
      table.id,
      table.rawRevisionId,
      table.rawRecordId,
    ),
    connectorLineageIdx: uniqueIndex('idx_raw_source_occurrences_connector_lineage').on(
      table.id,
      table.rawRevisionId,
      table.rawRecordId,
      table.connectorInstanceId,
      table.connectorRunId,
    ),
    recordChronologyIdx: index('idx_raw_source_occurrences_record_chronology').on(
      table.rawRecordId,
      table.observedAt,
      table.receivedAt,
      table.id,
    ),
    revisionIdx: index('idx_raw_source_occurrences_revision').on(table.rawRevisionId),
    connectorRunIdx: index('idx_raw_source_occurrences_connector_run').on(table.connectorRunId),
    connectorCaptureCheck: check(
      'chk_raw_source_occurrences_connector_capture',
      sql`(${table.connectorInstanceId} is null and ${table.connectorRunId} is null) or (${table.connectorInstanceId} is not null and ${table.connectorRunId} is not null)`,
    ),
    rawOwnerFk: foreignKey({
      columns: [table.rawRevisionId, table.rawRecordId],
      foreignColumns: [rawSourceRevisions.id, rawSourceRevisions.rawRecordId],
      name: 'fk_raw_source_occurrences_revision_record',
    }),
    connectorOwnerFk: foreignKey({
      columns: [table.connectorRunId, table.connectorInstanceId],
      foreignColumns: [connectorRuns.id, connectorRuns.connectorInstanceId],
      name: 'fk_raw_source_occurrences_run_instance',
    }),
  }),
)

export const normalizationRuns = sqliteTable(
  'normalization_runs',
  {
    id: text('id').primaryKey(),
    rawRecordId: text('raw_record_id').notNull().references(() => rawSourceRecords.id),
    rawRevisionId: text('raw_revision_id').notNull().references(() => rawSourceRevisions.id),
    triggerOccurrenceId: text('trigger_occurrence_id'),
    triggerConnectorInstanceId: text('trigger_connector_instance_id'),
    triggerConnectorRunId: text('trigger_connector_run_id'),
    inputHash: text('input_hash').notNull(),
    resolverSetHash: text('resolver_set_hash').notNull(),
    canonicalSchemaVersion: text('canonical_schema_version').notNull(),
    gatePolicyVersion: text('gate_policy_version').notNull(),
    triggerKind: text('trigger_kind').notNull().default('intake'),
    triggerId: text('trigger_id'),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    cacheIdx: uniqueIndex('idx_normalization_runs_cache').on(
      table.rawRevisionId,
      table.inputHash,
      table.resolverSetHash,
      table.canonicalSchemaVersion,
      table.gatePolicyVersion,
    ).where(sql`${table.triggerId} is null`),
    rawRecordIdx: index('idx_normalization_runs_raw_record').on(table.rawRecordId, table.createdAt),
    statusCheck: check('chk_normalization_runs_status', sql`${table.status} in ('pending','in_progress','completed','blocked','failed')`),
    triggerCheck: check('chk_normalization_runs_trigger_kind', sql`${table.triggerKind} in ('intake')`),
  }),
)

export const normalizationReplayRequests = sqliteTable(
  'normalization_replay_requests',
  {
    id: text('id').primaryKey(),
    selectorJson: text('selector_json').notNull(),
    invalidationJson: text('invalidation_json').notNull(),
    targetVersionsJson: text('target_versions_json'),
    fieldDirectivesJson: text('field_directives_json').notNull(),
    status: text('status').notNull(),
    acceptedAt: text('accepted_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => ({
    chronologyIdx: index('idx_normalization_replay_requests_chronology').on(table.acceptedAt, table.id),
    statusCheck: check('chk_normalization_replay_requests_status', sql`${table.status} in ('accepted','in_progress','completed','completed_with_failures')`),
  }),
)

export const normalizationReplayItems = sqliteTable(
  'normalization_replay_items',
  {
    id: text('id').primaryKey(),
    replayId: text('replay_id').notNull().references(() => normalizationReplayRequests.id),
    rawRecordId: text('raw_record_id').notNull().references(() => rawSourceRecords.id),
    rawRevisionId: text('raw_revision_id').notNull().references(() => rawSourceRevisions.id),
    inputHash: text('input_hash').notNull(),
    sequence: integer('sequence').notNull(),
    status: text('status').notNull(),
    normalizationRunId: text('normalization_run_id').references(() => normalizationRuns.id),
    failureJson: text('failure_json'),
    completedAt: text('completed_at'),
  },
  (table) => ({
    sequenceIdx: uniqueIndex('idx_normalization_replay_items_sequence').on(table.replayId, table.sequence),
    revisionIdx: uniqueIndex('idx_normalization_replay_items_revision').on(table.replayId, table.rawRevisionId),
    statusCheck: check('chk_normalization_replay_items_status', sql`${table.status} in ('pending','completed','failed')`),
  }),
)

export const normalizationAttempts = sqliteTable(
  'normalization_attempts',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => normalizationRuns.id),
    rawRevisionId: text('raw_revision_id').notNull().references(() => rawSourceRevisions.id),
    sequence: integer('sequence').notNull(),
    resolverId: text('resolver_id').notNull(),
    resolverVersion: text('resolver_version').notNull(),
    inputHash: text('input_hash').notNull(),
    declarationJson: text('declaration_json').notNull(),
    applicabilityJson: text('applicability_json').notNull(),
    status: text('status').notNull(),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => ({
    sequenceIdx: uniqueIndex('idx_normalization_attempts_run_sequence').on(table.runId, table.sequence),
    resolverIdx: index('idx_normalization_attempts_resolver').on(table.resolverId, table.resolverVersion, table.inputHash),
  }),
)

export const normalizationFieldOutcomes = sqliteTable(
  'normalization_field_outcomes',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => normalizationRuns.id),
    attemptId: text('attempt_id').notNull().references(() => normalizationAttempts.id),
    sequence: integer('sequence').notNull(),
    attemptSequence: integer('attempt_sequence').notNull(),
    outcomeIndex: integer('outcome_index').notNull(),
    field: text('field').notNull(),
    status: text('status').notNull(),
    resolverId: text('resolver_id').notNull(),
    resolverVersion: text('resolver_version').notNull(),
    inputHash: text('input_hash').notNull(),
    outcomeJson: text('outcome_json').notNull(),
  },
  (table) => ({
    sequenceIdx: uniqueIndex('idx_normalization_field_outcomes_run_sequence').on(table.runId, table.sequence),
    selectorIdx: index('idx_normalization_field_outcomes_selector').on(table.runId, table.field, table.attemptSequence, table.outcomeIndex),
    resolverIdx: index('idx_normalization_field_outcomes_resolver').on(table.resolverId, table.resolverVersion, table.inputHash),
  }),
)

export const canonicalSourceCandidates = sqliteTable(
  'canonical_source_candidates',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => normalizationRuns.id),
    sourceEntityId: text('source_entity_id').notNull().references(() => sourceEntities.id),
    rawRecordId: text('raw_record_id').notNull().references(() => rawSourceRecords.id),
    rawRevisionId: text('raw_revision_id').notNull().references(() => rawSourceRevisions.id),
    schemaVersion: text('schema_version').notNull(),
    candidateJson: text('candidate_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    runIdx: uniqueIndex('idx_canonical_source_candidates_run').on(table.runId),
    revisionSchemaIdx: index('idx_canonical_source_candidates_revision_schema').on(table.rawRevisionId, table.schemaVersion),
  }),
)

export const normalizationGates = sqliteTable(
  'normalization_gates',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => normalizationRuns.id),
    policyVersion: text('policy_version').notNull(),
    status: text('status').notNull(),
    candidateId: text('candidate_id').references(() => canonicalSourceCandidates.id),
    gateJson: text('gate_json').notNull(),
    evaluatedAt: text('evaluated_at').notNull(),
  },
  (table) => ({
    runIdx: uniqueIndex('idx_normalization_gates_run').on(table.runId),
    policyIdx: index('idx_normalization_gates_policy').on(table.policyVersion, table.status),
    statusCheck: check('chk_normalization_gates_status', sql`${table.status} in ('passed','needs_enrichment','rejected','failed')`),
    candidateCheck: check('chk_normalization_gates_candidate', sql`(${table.status} = 'passed' and ${table.candidateId} is not null) or (${table.status} <> 'passed' and ${table.candidateId} is null)`),
  }),
)

export const sourcingFindings = sqliteTable(
  'sourcing_findings',
  {
    id: text('id').primaryKey(),
    projectionIdentityKey: text('projection_identity_key'),
    projectionAliasesJson: text('projection_aliases_json').notNull().default('[]'),
    sourceEntityId: text('source_entity_id').references(() => sourceEntities.id),
    canonicalCandidateId: text('canonical_candidate_id').references(() => canonicalSourceCandidates.id),
    rawRevisionId: text('raw_revision_id').references(() => rawSourceRevisions.id),
    adapterId: text('adapter_id'),
    adapterKind: text('adapter_kind'),
    adapterVersion: text('adapter_version'),
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
    timingMode: text('timing_mode').notNull().default('unknown'),
    termsJson: text('terms_json').notNull().default('[]'),
    startDate: text('start_date'),
    endDate: text('end_date'),
    city: text('city'),
    region: text('region'),
    country: text('country'),
    workMode: text('work_mode').notNull(),
    locationRaw: text('location_raw'),
    employmentType: text('employment_type'),
    seniority: text('seniority'),
    locationJson: text('location_json'),
    compensationJson: text('compensation_json'),
    postedAtJson: text('posted_at_json'),
    officialUrl: text('official_url'),
    sourceUrl: text('source_url'),
    destinationClass: text('destination_class'),
    destinationUrl: text('destination_url'),
    intermediaryUrl: text('intermediary_url'),
    usability: text('usability'),
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
    projectionIdentityIdx: uniqueIndex('idx_sourcing_findings_projection_identity').on(table.projectionIdentityKey),
    sourceEntityIdx: index('idx_sourcing_findings_source_entity').on(table.sourceEntityId),
    candidateIdx: uniqueIndex('idx_sourcing_findings_canonical_candidate').on(table.canonicalCandidateId),
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
  connectorCheckpoints,
  connectorInstances,
  connectorObservations,
  connectorRuns,
  canonicalSourceCandidates,
  normalizationAttempts,
  normalizationFieldOutcomes,
  normalizationGates,
  normalizationReplayItems,
  normalizationReplayRequests,
  normalizationRuns,
  policyConfig,
  policyEvidence,
  profileAnswers,
  profileEducation,
  profileSensitiveDetails,
  profileSecrets,
  rawSourceOccurrences,
  rawSourceRecords,
  rawSourceRevisions,
  retryWork,
  sourceEntities,
  sourceEntityIdentities,
  sourceIdentityConflicts,
  sourcingFindings,
  sources,
  userProfile,
  workflowRunSteps,
  workflowRuns,
}
