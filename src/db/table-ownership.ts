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
 * Capture, Job, Opportunity, and Application own their write conversations in
 * their aggregate modules. The final cutover has one physical root per aggregate.
 *
 * The aggregate vocabulary and resource shapes mirror the merged sparxie
 * lifecycle contract (KennyKeni/sparxie#84) as the source of truth. #298 does
 * not import the sparxie lifecycle modules; typed alignment against the
 * published package is tracked separately by #304.
 */
export type LifecycleModule = 'capture' | 'job' | 'opportunity' | 'applications' | 'connectors' | 'scheduling'

/**
 * Drizzle export identifier -> owning module.
 */
export const lifecycleTableOwnership = {
  // Capture aggregate (owned by src/modules/capture/).
  captures: 'capture',
  captureRevisions: 'capture',
  captureOccurrences: 'capture',
  captureEvidenceItems: 'capture',
  // Job aggregate (owned by src/modules/job/).
  jobs: 'job',
  jobExternalIdentities: 'job',
  jobCaptureEvidenceReferences: 'job',
  jobHistory: 'job',
  // Opportunity aggregate (owned by src/modules/opportunity/).
  opportunities: 'opportunity',
  opportunityHistory: 'opportunity',
  // Application aggregate (owned by src/modules/applications/).
  applicationScores: 'applications',
  applicationWorkflowStates: 'applications',
  applications: 'applications',
  pursuitLinks: 'applications',
  applicationAttemptRecords: 'applications',
  applicationEventRecords: 'applications',
  applicationHistory: 'applications',
  // Connector capture resumption is owned by the connector module; the remaining
  // generic durable operations are owned by scheduling.
  connectorCaptureWork: 'connectors',
  normalizationWork: 'scheduling',
  providerUrlResolutionWork: 'scheduling',
  captureDestinationResolutionWork: 'scheduling',
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
  capture_revisions: 'capture',
  capture_occurrences: 'capture',
  capture_evidence_items: 'capture',
  jobs: 'job',
  job_external_identities: 'job',
  job_capture_evidence_references: 'job',
  job_history: 'job',
  opportunities: 'opportunity',
  opportunity_history: 'opportunity',
  applications: 'applications',
  application_scores: 'applications',
  application_workflow_states: 'applications',
  pursuit_links: 'applications',
  application_attempt_records: 'applications',
  application_event_records: 'applications',
  application_history: 'applications',
  connector_capture_work: 'connectors',
  normalization_work: 'scheduling',
  provider_url_resolution_work: 'scheduling',
  capture_destination_resolution_work: 'scheduling',
  hosted_submission_work: 'scheduling',
  hosted_result_polling_work: 'scheduling',
} as const satisfies Record<string, LifecycleModule>
