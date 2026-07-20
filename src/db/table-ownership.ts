/**
 * Lifecycle aggregate -> owning-module manifest (issue #298, acceptance criterion 8).
 *
 * Single source of truth for "one owning module per aggregate". Each lifecycle
 * table's Drizzle export identifier maps to the module directory under
 * `src/modules/` that is its sole writer. The state-ownership policy
 * (`src/test/lifecycle-state-ownership.ts`) reports any other module that
 * issues insert/update/delete against one of these tables as a cross-module
 * write.
 *
 * Capture, Job, and Opportunity own their write conversations in their own modules
 * (`src/modules/{capture,job,opportunity}`) and every writer routes through the
 * owning module, so the policy is green. These conversations are still backed by
 * the LEGACY tables under #298 (which ships no runtime rewiring); the aggregate
 * leaves #299-#302 adopt the canonical `lifecycle_*` tables and #307 drops/renames
 * them. See drizzle/lifecycle-migration.md.
 *
 * The aggregate vocabulary and resource shapes mirror the merged sparxie
 * lifecycle contract (KennyKeni/sparxie#84) as the source of truth. #298 does
 * not import the sparxie lifecycle modules; typed alignment against the
 * published package is tracked separately by #304.
 */
export type LifecycleModule = 'capture' | 'job' | 'opportunity' | 'applications' | 'scheduling'

/**
 * Drizzle export identifier -> owning module. Covers both the LEGACY tables (the
 * live source until the adoption leaves repoint) and the CANONICAL tables + the
 * scheduled-work identities, so #299-#303 inherit enforcement from day one rather
 * than remembering to extend this manifest when they start writing the new tables.
 */
export const lifecycleTableOwnership = {
  // Capture aggregate (owned by src/modules/capture/).
  captures: 'capture',
  captureLineages: 'capture',
  captureEvidenceVersions: 'capture',
  lifecycleCaptures: 'capture',
  captureRevisions: 'capture',
  captureEvidenceItems: 'capture',
  // Job aggregate (owned by src/modules/job/).
  jobs: 'job',
  jobIdentities: 'job',
  jobIdentityConflicts: 'job',
  jobFactVersions: 'job',
  lifecycleJobs: 'job',
  jobExternalIdentities: 'job',
  jobCaptureEvidenceReferences: 'job',
  jobHistory: 'job',
  // Opportunity aggregate (owned by src/modules/opportunity/).
  opportunities: 'opportunity',
  sourcingProjectionOutcomes: 'opportunity',
  lifecycleOpportunities: 'opportunity',
  opportunityHistory: 'opportunity',
  // Application aggregate (owned by src/modules/applications/).
  applications: 'applications',
  applicationAttempts: 'applications',
  applicationAttemptSteps: 'applications',
  applicationEvents: 'applications',
  applicationLinks: 'applications',
  applicationScores: 'applications',
  applicationWorkflowStates: 'applications',
  lifecycleApplications: 'applications',
  pursuitLinks: 'applications',
  applicationAttemptRecords: 'applications',
  applicationEventRecords: 'applications',
  applicationHistory: 'applications',
  // Durable scheduled-work identities (owned by src/modules/scheduling/).
  connectorCaptureWork: 'scheduling',
  normalizationWork: 'scheduling',
  providerUrlResolutionWork: 'scheduling',
  hostedSubmissionWork: 'scheduling',
  hostedResultPollingWork: 'scheduling',
} as const satisfies Record<string, LifecycleModule>

export type LifecycleTableIdentifier = keyof typeof lifecycleTableOwnership

/**
 * Physical (SQL) table name -> owning module, for detecting raw-SQL DML that
 * bypasses the Drizzle query builder. Kept in lockstep with
 * `lifecycleTableOwnership`; a drift test asserts the two cover the same owners.
 */
export const lifecyclePhysicalTableOwnership = {
  captures: 'capture',
  capture_lineages: 'capture',
  capture_evidence_versions: 'capture',
  lifecycle_captures: 'capture',
  capture_revisions: 'capture',
  capture_evidence_items: 'capture',
  jobs: 'job',
  job_identities: 'job',
  job_identity_conflicts: 'job',
  job_fact_versions: 'job',
  lifecycle_jobs: 'job',
  job_external_identities: 'job',
  job_capture_evidence_references: 'job',
  job_history: 'job',
  opportunities: 'opportunity',
  sourcing_projection_outcomes: 'opportunity',
  lifecycle_opportunities: 'opportunity',
  opportunity_history: 'opportunity',
  applications: 'applications',
  application_attempts: 'applications',
  application_attempt_steps: 'applications',
  application_events: 'applications',
  application_links: 'applications',
  application_scores: 'applications',
  application_workflow_states: 'applications',
  lifecycle_applications: 'applications',
  pursuit_links: 'applications',
  application_attempt_records: 'applications',
  application_event_records: 'applications',
  application_history: 'applications',
  connector_capture_work: 'scheduling',
  normalization_work: 'scheduling',
  provider_url_resolution_work: 'scheduling',
  hosted_submission_work: 'scheduling',
  hosted_result_polling_work: 'scheduling',
} as const satisfies Record<string, LifecycleModule>
