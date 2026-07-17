import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import {
  connectorCheckpoints,
  connectorInstances,
  connectorObservations,
  connectorRuns,
  connectorScheduleEvents,
  connectorScheduleOccurrences,
  connectorScheduleRevisions,
  connectorSchedules,
} from './schema.connectors'

export {
  connectorCheckpoints,
  connectorInstances,
  connectorObservations,
  connectorRuns,
  connectorScheduleEvents,
  connectorScheduleOccurrences,
  connectorScheduleRevisions,
  connectorSchedules,
} from './schema.connectors'

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

export const profileSecrets = sqliteTable('profile_secrets', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  kind: text('kind').notNull(),
  encryptedValue: text('encrypted_value').notNull(),
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

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    identityKind: text('identity_kind').notNull(),
    identityNamespace: text('identity_namespace').notNull(),
    identityValue: text('identity_value').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    identityIdx: uniqueIndex('idx_jobs_identity').on(
      table.identityKind,
      table.identityNamespace,
      table.identityValue,
    ),
    identityKindLength: check(
      'chk_jobs_identity_kind_length',
      sql`length(${table.identityKind}) between 1 and 64`,
    ),
    identityNamespaceLength: check(
      'chk_jobs_identity_namespace_length',
      sql`length(${table.identityNamespace}) between 1 and 4096`,
    ),
    identityValueLength: check(
      'chk_jobs_identity_value_length',
      sql`length(${table.identityValue}) between 1 and 2048`,
    ),
  }),
)

export const jobIdentities = sqliteTable(
  'job_identities',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id').notNull().references(() => jobs.id),
    identityKind: text('identity_kind').notNull(),
    identityNamespace: text('identity_namespace').notNull(),
    identityValue: text('identity_value').notNull(),
    provenanceKind: text('provenance_kind').notNull(),
    provenanceVersion: text('provenance_version').notNull(),
    evidenceJson: text('evidence_json').notNull(),
    captureEvidenceVersionId: text('capture_evidence_version_id').references(() => captureEvidenceVersions.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    identityIdx: uniqueIndex('idx_job_identities_identity').on(
      table.identityKind,
      table.identityNamespace,
      table.identityValue,
    ),
    entityChronologyIdx: index('idx_job_identities_job_chronology').on(
      table.jobId,
      table.createdAt,
      table.id,
    ),
    kindCheck: check('chk_job_identities_kind', sql`${table.identityKind} in ('provider_job','canonical_destination','intermediary_alias','destination_alias')`),
    namespaceLength: check('chk_job_identities_namespace_length', sql`length(${table.identityNamespace}) between 1 and 512`),
    valueLength: check('chk_job_identities_value_length', sql`length(${table.identityValue}) between 1 and 2048`),
    provenanceKindCheck: check('chk_job_identities_provenance_kind', sql`${table.provenanceKind} in ('primary_backfill','capture','normalization')`),
    provenanceVersionLength: check('chk_job_identities_provenance_version_length', sql`length(${table.provenanceVersion}) between 1 and 128`),
    evidenceLength: check('chk_job_identities_evidence_length', sql`length(${table.evidenceJson}) between 2 and 16384`),
  }),
)

export const jobIdentityConflicts = sqliteTable(
  'job_identity_conflicts',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id').notNull().references(() => jobs.id),
    conflictingJobId: text('conflicting_job_id').references(() => jobs.id),
    captureEvidenceVersionId: text('capture_evidence_version_id').notNull().references(() => captureEvidenceVersions.id),
    identityKind: text('identity_kind').notNull(),
    identityNamespace: text('identity_namespace').notNull(),
    identityValue: text('identity_value').notNull(),
    reason: text('reason').notNull(),
    provenanceVersion: text('provenance_version').notNull(),
    evidenceJson: text('evidence_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    captureIdx: uniqueIndex('idx_job_identity_conflicts_capture').on(
      table.jobId,
      table.captureEvidenceVersionId,
      table.identityKind,
      table.identityNamespace,
      table.identityValue,
      table.reason,
    ),
    chronologyIdx: index('idx_job_identity_conflicts_chronology').on(table.createdAt, table.id),
    kindCheck: check('chk_job_identity_conflicts_kind', sql`${table.identityKind} in ('provider_job','canonical_destination','intermediary_alias','destination_alias')`),
    namespaceLength: check('chk_job_identity_conflicts_namespace_length', sql`length(${table.identityNamespace}) between 1 and 512`),
    valueLength: check('chk_job_identity_conflicts_value_length', sql`length(${table.identityValue}) between 1 and 2048`),
    reasonLength: check('chk_job_identity_conflicts_reason_length', sql`length(${table.reason}) between 1 and 512`),
    provenanceVersionLength: check('chk_job_identity_conflicts_provenance_version_length', sql`length(${table.provenanceVersion}) between 1 and 128`),
    evidenceLength: check('chk_job_identity_conflicts_evidence_length', sql`length(${table.evidenceJson}) between 2 and 16384`),
  }),
)

export const captureLineages = sqliteTable(
  'capture_lineages',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id').references(() => jobs.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    jobIdx: uniqueIndex('idx_capture_lineages_job').on(table.jobId),
  }),
)

export const sourceExecutionScopes = sqliteTable(
  'source_execution_scopes',
  {
    id: text('id').primaryKey(),
    status: text('status').notNull().default('available'),
    blockedUntil: text('blocked_until'),
    backoffAttempt: integer('backoff_attempt').notNull().default(0),
    authGeneration: integer('auth_generation').notNull().default(0),
    refreshLeaseToken: text('refresh_lease_token'),
    refreshLeaseExpiresAt: text('refresh_lease_expires_at'),
    actionReason: text('action_reason'),
    ...timestamps,
  },
  (table) => ({
    availabilityIdx: index('idx_source_execution_scopes_availability').on(table.status, table.blockedUntil),
    statusCheck: check('chk_source_execution_scopes_status', sql`${table.status} in ('available','cooldown','refreshing','action_required')`),
    idCheck: check('chk_source_execution_scopes_id', sql`length(${table.id}) between 8 and 256 and ${table.id} not glob '*[^A-Za-z0-9._~-]*'`),
    backoffCheck: check('chk_source_execution_scopes_backoff', sql`${table.backoffAttempt} >= 0`),
    generationCheck: check('chk_source_execution_scopes_generation', sql`${table.authGeneration} >= 0`),
  }),
)

export const connectorRunSynchronizations = sqliteTable(
  'connector_run_synchronizations',
  {
    connectorRunId: text('connector_run_id').primaryKey().references(() => connectorRuns.id),
    snapshotJson: text('snapshot_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    snapshotLength: check('chk_connector_run_synchronizations_length', sql`length(${table.snapshotJson}) between 2 and 8192`),
  }),
)

export const sourceExecutionSessions = sqliteTable(
  'source_execution_sessions',
  {
    executionScopeId: text('execution_scope_id').primaryKey().references(() => sourceExecutionScopes.id),
    encryptedSession: text('encrypted_session').notNull(),
    authGeneration: integer('auth_generation').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    sessionLength: check('chk_source_execution_sessions_length', sql`length(${table.encryptedSession}) between 1 and 1048576`),
    generationCheck: check('chk_source_execution_sessions_generation', sql`${table.authGeneration} >= 1`),
  }),
)

export const captureEvidenceVersions = sqliteTable(
  'capture_evidence_versions',
  {
    id: text('id').primaryKey(),
    captureLineageId: text('capture_lineage_id')
      .notNull()
      .references(() => captureLineages.id),
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
    recordIdIdx: uniqueIndex('idx_capture_evidence_versions_id_lineage').on(
      table.id,
      table.captureLineageId,
    ),
    recordRevisionIdx: uniqueIndex('idx_capture_evidence_versions_lineage_revision').on(
      table.captureLineageId,
      table.revision,
    ),
    recordHashIdx: uniqueIndex('idx_capture_evidence_versions_lineage_hash').on(
      table.captureLineageId,
      table.contentHash,
    ),
    providerCurrentIdx: index('idx_capture_evidence_versions_provider_current').on(
      table.providerRecordId, table.id, table.captureLineageId, table.revision,
    ),
  }),
)

export const retryWork = sqliteTable(
  'retry_work',
  {
    id: text('id').primaryKey(),
    executionScopeId: text('execution_scope_id').notNull().references(() => sourceExecutionScopes.id),
    kind: text('kind').notNull(),
    connectorInstanceId: text('connector_instance_id').references(() => connectorInstances.id),
    filterSignature: text('filter_signature'),
    checkpointSchemaVersion: text('checkpoint_schema_version'),
    checkpointGeneration: text('checkpoint_generation'),
    captureEvidenceVersionId: text('capture_evidence_version_id').references(() => captureEvidenceVersions.id),
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
      table.captureEvidenceVersionId,
      table.resolverId,
      table.resolverVersion,
      table.inputHash,
    ).where(sql`${table.kind} = 'normalization' and ${table.deletedAt} is null`),
    dueIdx: index('idx_retry_work_due').on(table.state, table.nextAttemptAt),
    capturePendingIdx: index('idx_retry_work_capture_pending').on(
      table.kind, table.connectorInstanceId, table.filterSignature,
      table.state, table.nextAttemptAt, table.updatedAt,
    ).where(sql`${table.deletedAt} is null`),
    normalizationPendingIdx: index('idx_retry_work_normalization_pending').on(
      table.kind, table.executionScopeId, table.state,
      table.nextAttemptAt, table.createdAt, table.captureEvidenceVersionId,
    ).where(sql`${table.deletedAt} is null`),
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
      and ${table.captureEvidenceVersionId} is null
      and ${table.resolverId} is null
      and ${table.resolverVersion} is null
      and ${table.inputHash} is null
    ) or (
      ${table.kind} = 'normalization'
      and ${table.connectorInstanceId} is null
      and ${table.filterSignature} is null
      and ${table.checkpointSchemaVersion} is null
      and ${table.checkpointGeneration} is null
      and ${table.captureEvidenceVersionId} is not null
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

export const captures = sqliteTable(
  'captures',
  {
    id: text('id').primaryKey(),
    captureLineageId: text('capture_lineage_id')
      .notNull()
      .references(() => captureLineages.id),
    captureEvidenceVersionId: text('capture_evidence_version_id')
      .notNull()
      .references(() => captureEvidenceVersions.id),
    connectorInstanceId: text('connector_instance_id').references(() => connectorInstances.id),
    connectorRunId: text('connector_run_id').references(() => connectorRuns.id),
    executionScopeId: text('execution_scope_id').references(() => sourceExecutionScopes.id),
    observedAt: text('observed_at').notNull(),
    receivedAt: text('received_at').notNull(),
  },
  (table) => ({
    lineageIdx: uniqueIndex('idx_captures_lineage').on(
      table.id,
      table.captureEvidenceVersionId,
      table.captureLineageId,
    ),
    connectorLineageIdx: uniqueIndex('idx_captures_connector_lineage').on(
      table.id,
      table.captureEvidenceVersionId,
      table.captureLineageId,
      table.connectorInstanceId,
      table.connectorRunId,
    ),
    recordChronologyIdx: index('idx_captures_lineage_chronology').on(
      table.captureLineageId,
      table.observedAt,
      table.receivedAt,
      table.id,
    ),
    revisionIdx: index('idx_captures_evidence_version').on(table.captureEvidenceVersionId),
    connectorRunIdx: index('idx_captures_connector_run').on(table.connectorRunId),
    connectorCaptureCheck: check(
      'chk_captures_connector_capture',
      sql`(${table.connectorInstanceId} is null and ${table.connectorRunId} is null and ${table.executionScopeId} is null) or (${table.connectorInstanceId} is not null and ${table.connectorRunId} is not null and ${table.executionScopeId} is not null)`,
    ),
    rawOwnerFk: foreignKey({
      columns: [table.captureEvidenceVersionId, table.captureLineageId],
      foreignColumns: [captureEvidenceVersions.id, captureEvidenceVersions.captureLineageId],
      name: 'fk_captures_evidence_version_lineage',
    }),
    connectorOwnerFk: foreignKey({
      columns: [table.connectorRunId, table.connectorInstanceId],
      foreignColumns: [connectorRuns.id, connectorRuns.connectorInstanceId],
      name: 'fk_captures_run_instance',
    }),
  }),
)

export const normalizationRuns = sqliteTable(
  'normalization_runs',
  {
    id: text('id').primaryKey(),
    captureLineageId: text('capture_lineage_id').notNull().references(() => captureLineages.id),
    captureEvidenceVersionId: text('capture_evidence_version_id').notNull().references(() => captureEvidenceVersions.id),
    triggerCaptureId: text('trigger_capture_id'),
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
      table.captureEvidenceVersionId,
      table.inputHash,
      table.resolverSetHash,
      table.canonicalSchemaVersion,
      table.gatePolicyVersion,
    ).where(sql`${table.triggerId} is null`),
    captureLineageIdx: index('idx_normalization_runs_capture_lineage').on(table.captureLineageId, table.createdAt),
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
    captureLineageId: text('capture_lineage_id').notNull().references(() => captureLineages.id),
    captureEvidenceVersionId: text('capture_evidence_version_id').notNull().references(() => captureEvidenceVersions.id),
    inputHash: text('input_hash').notNull(),
    sequence: integer('sequence').notNull(),
    status: text('status').notNull(),
    normalizationRunId: text('normalization_run_id').references(() => normalizationRuns.id),
    failureJson: text('failure_json'),
    completedAt: text('completed_at'),
  },
  (table) => ({
    sequenceIdx: uniqueIndex('idx_normalization_replay_items_sequence').on(table.replayId, table.sequence),
    revisionIdx: uniqueIndex('idx_normalization_replay_items_evidence_version').on(table.replayId, table.captureEvidenceVersionId),
    statusCheck: check('chk_normalization_replay_items_status', sql`${table.status} in ('pending','completed','failed')`),
  }),
)

export const normalizationAttempts = sqliteTable(
  'normalization_attempts',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => normalizationRuns.id),
    captureEvidenceVersionId: text('capture_evidence_version_id').notNull().references(() => captureEvidenceVersions.id),
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

export const jobFactVersions = sqliteTable(
  'job_fact_versions',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => normalizationRuns.id),
    jobId: text('job_id').notNull().references(() => jobs.id),
    captureLineageId: text('capture_lineage_id').notNull().references(() => captureLineages.id),
    captureEvidenceVersionId: text('capture_evidence_version_id').notNull().references(() => captureEvidenceVersions.id),
    schemaVersion: text('schema_version').notNull(),
    jobFactVersionJson: text('job_fact_version_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    runIdx: uniqueIndex('idx_job_fact_versions_run').on(table.runId),
    lineageIdx: uniqueIndex('idx_job_fact_versions_lineage').on(
      table.id,
      table.captureLineageId,
      table.captureEvidenceVersionId,
    ),
    revisionSchemaIdx: index('idx_job_fact_versions_evidence_version_schema').on(table.captureEvidenceVersionId, table.schemaVersion),
  }),
)

export const sourcingProjectionOutcomes = sqliteTable(
  'sourcing_projection_outcomes',
  {
    id: text('id').primaryKey(),
    captureLineageId: text('capture_lineage_id').notNull().references(() => captureLineages.id),
    captureEvidenceVersionId: text('capture_evidence_version_id').notNull().references(() => captureEvidenceVersions.id),
    jobFactVersionId: text('job_fact_version_id').notNull().references(() => jobFactVersions.id),
    status: text('status').notNull(),
    opportunityId: text('opportunity_id').references(() => opportunities.id),
    failureCode: text('failure_code'),
    failureRetryable: integer('failure_retryable', { mode: 'boolean' }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    projectedAt: text('projected_at'),
    failedAt: text('failed_at'),
  },
  (table) => ({
    revisionIdx: index('idx_sourcing_projection_outcomes_evidence_version').on(table.captureEvidenceVersionId, table.createdAt),
    jobFactVersionIdx: uniqueIndex('idx_sourcing_projection_outcomes_job_fact_version').on(table.jobFactVersionId),
    revisionLineageFk: foreignKey({
      columns: [table.captureEvidenceVersionId, table.captureLineageId],
      foreignColumns: [captureEvidenceVersions.id, captureEvidenceVersions.captureLineageId],
      name: 'fk_sourcing_projection_outcomes_revision_lineage',
    }),
    jobFactVersionLineageFk: foreignKey({
      columns: [table.jobFactVersionId, table.captureLineageId, table.captureEvidenceVersionId],
      foreignColumns: [jobFactVersions.id, jobFactVersions.captureLineageId, jobFactVersions.captureEvidenceVersionId],
      name: 'fk_sourcing_projection_outcomes_job_fact_version_lineage',
    }),
    statusCheck: check('chk_sourcing_projection_outcomes_status', sql`${table.status} in ('pending','projected','failed')`),
    fieldsCheck: check('chk_sourcing_projection_outcomes_fields', sql`
      (${table.status} = 'pending' and ${table.opportunityId} is null and ${table.failureCode} is null and ${table.failureRetryable} is null and ${table.projectedAt} is null and ${table.failedAt} is null)
      or (${table.status} = 'projected' and ${table.opportunityId} is not null and ${table.failureCode} is null and ${table.failureRetryable} is null and ${table.projectedAt} is not null and ${table.failedAt} is null)
      or (${table.status} = 'failed' and ${table.opportunityId} is null and ${table.failureCode} in ('projection_failed','persistence_failed','internal_error') and ${table.failureRetryable} in (0, 1) and ${table.projectedAt} is null and ${table.failedAt} is not null)
    `),
  }),
)

export const normalizationGates = sqliteTable(
  'normalization_gates',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => normalizationRuns.id),
    policyVersion: text('policy_version').notNull(),
    status: text('status').notNull(),
    jobFactVersionId: text('job_fact_version_id').references(() => jobFactVersions.id),
    gateJson: text('gate_json').notNull(),
    evaluatedAt: text('evaluated_at').notNull(),
  },
  (table) => ({
    runIdx: uniqueIndex('idx_normalization_gates_run').on(table.runId),
    policyIdx: index('idx_normalization_gates_policy').on(table.policyVersion, table.status),
    statusCheck: check('chk_normalization_gates_status', sql`${table.status} in ('passed','needs_enrichment','rejected','failed')`),
    jobFactVersionCheck: check('chk_normalization_gates_job_fact_version', sql`(${table.status} = 'passed' and ${table.jobFactVersionId} is not null) or (${table.status} <> 'passed' and ${table.jobFactVersionId} is null)`),
  }),
)

export const opportunities = sqliteTable(
  'opportunities',
  {
    id: text('id').primaryKey(),
    projectionIdentityKey: text('projection_identity_key'),
    projectionAliasesJson: text('projection_aliases_json').notNull().default('[]'),
    jobId: text('job_id').references(() => jobs.id),
    jobFactVersionId: text('job_fact_version_id').references(() => jobFactVersions.id),
    captureEvidenceVersionId: text('capture_evidence_version_id').references(() => captureEvidenceVersions.id),
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
    applicationId: text('application_id').references(() => applications.id),
    mergeNotes: text('merge_notes'),
    discoveredAt: text('discovered_at').notNull(),
    ...timestamps,
  },
  (table) => ({
    projectionIdentityIdx: uniqueIndex('idx_opportunities_projection_identity').on(table.projectionIdentityKey),
    jobIdx: index('idx_opportunities_job').on(table.jobId),
    jobFactVersionIdx: uniqueIndex('idx_opportunities_job_fact_version').on(table.jobFactVersionId),
    sourceIdx: index('idx_opportunities_source_id').on(table.sourceId),
    sourceStatusDiscoveredIdx: index('idx_opportunities_source_status_discovered').on(
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
  connectorScheduleEvents,
  connectorScheduleOccurrences,
  connectorScheduleRevisions,
  connectorSchedules,
  jobFactVersions,
  normalizationAttempts,
  normalizationFieldOutcomes,
  normalizationGates,
  normalizationReplayItems,
  normalizationReplayRequests,
  normalizationRuns,
  policyConfig,
  policyEvidence,
  profileSecrets,
  captures,
  captureLineages,
  captureEvidenceVersions,
  retryWork,
  connectorRunSynchronizations,
  sourceExecutionScopes,
  sourceExecutionSessions,
  jobs,
  jobIdentities,
  jobIdentityConflicts,
  opportunities,
  sourcingProjectionOutcomes,
  sources,
  workflowRunSteps,
  workflowRuns,
}
