/**
 * Lifecycle vocabulary mirror (issue #298).
 *
 * These literals mirror the merged sparxie lifecycle contract
 * (KennyKeni/sparxie#84) as the single SOURCE OF TRUTH. #298 deliberately does
 * NOT import the sparxie lifecycle modules — package publication is a separate,
 * human-gated release step, and a local worktree reference would break hosted
 * CI. Typed alignment against the published package is tracked by #304.
 *
 * The journaled schema (drizzle/) and its CHECK constraints consume these exact
 * literal sets. `lifecycle-vocabulary.test.ts` asserts the literal values so any
 * drift from the contract is loud and intentional rather than silent.
 *
 * Contract sources: sparxie `src/lifecycle-shared.ts`, `src/capture.ts`,
 * `src/job.ts`.
 */

// --- Shared (lifecycle-shared.ts) ---

/** UUIDv7 canonical form: version nibble 7, variant nibble 8/9/a/b, matched case-insensitively. */
export const UUID_V7_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'

export const lifecycleActorTypes = ['user', 'agent', 'system'] as const

export const lifecycleBlockerCodes = [
  'invalid_input',
  'missing_lineage',
  'foreign_lineage',
  'workspace_ownership',
  'strong_identity_conflict',
  'impossible_state',
  'bounded_data_violation',
  'security_violation',
  'deterministic_duplicate',
] as const

export const lifecycleWarningCodes = [
  'fit',
  'rank',
  'cutoff',
  'missing_optional_facts',
  'third_party_destination',
  'weak_possible_match',
] as const

/** Bounds: lifecycle ids are trimmed strings 1..200; text 1..2000; urls <= 4096. */
export const LIFECYCLE_ID_MAX_LENGTH = 200
export const LIFECYCLE_TEXT_MAX_LENGTH = 2_000

// --- Capture (capture.ts) ---

export const captureEvidenceModes = ['reported', 'ats_details_provided'] as const
export const captureSourceAdapterKinds = ['connector', 'cli', 'manual', 'import'] as const
export const captureRevisionKinds = ['created', 'corrected', 'removed', 'restored'] as const

/** Capture bounds. */
export const CAPTURE_PAYLOAD_MAX_BYTES = 262_144
export const CAPTURE_EVIDENCE_VALUE_MAX_BYTES = 16_384
export const CAPTURE_EVIDENCE_MAX_ITEMS = 50
export const CAPTURE_ADAPTER_VERSION_MAX_LENGTH = 100
export const CAPTURE_PROVIDER_FIELD_MAX_LENGTH = 500
export const CAPTURE_EVIDENCE_KIND_MAX_LENGTH = 100
export const CAPTURE_EVIDENCE_LABEL_MAX_LENGTH = 200
/** Forbidden sensitive evidence keys (capture.ts forbiddenEvidenceKey). */
export const CAPTURE_FORBIDDEN_EVIDENCE_KEY_PATTERN = '^(?:authorization|cookie|password|secret|token|ssn)$'

// --- Job (job.ts) ---

export const jobExternalIdentityKinds = ['ats_job', 'employer_job', 'canonical_destination', 'posting'] as const
export const jobIdentityStrengths = ['strong', 'provisional'] as const
export const jobAvailabilityStates = ['open', 'closed', 'unknown'] as const
export const jobHistoryKinds = [
  'created',
  'facts_corrected',
  'availability_changed',
  'identity_added',
  'identity_removed',
  'removed',
  'restored',
] as const

/** Job bounds. */
export const JOB_EXTERNAL_IDENTITY_MAX = 100
export const JOB_CAPTURE_EVIDENCE_REFERENCE_MAX = 100
export const JOB_EVIDENCE_INDEXES_MAX = 50
export const JOB_IDENTITY_PROVIDER_MAX_LENGTH = 200
export const JOB_IDENTITY_ACCOUNT_MAX_LENGTH = 500
export const JOB_IDENTITY_VALUE_MAX_LENGTH = 2_000

// --- Opportunity (opportunity.ts) ---

export const opportunityFitStates = ['fit', 'possible', 'not_fit', 'unknown'] as const
export const opportunityCutoffStates = ['above', 'below', 'not_evaluated'] as const
export const opportunityDispositions = ['reviewing', 'pursue', 'hold', 'declined', 'archived'] as const
export const opportunityHistoryKinds = [
  'created',
  'evaluation_changed',
  'disposition_changed',
  'removed',
  'restored',
] as const

// --- Application (lifecycle-application.ts) ---

export const pursuitApplicationStatuses = [
  'active',
  'submitted',
  'interviewing',
  'offered',
  'withdrawn',
  'rejected',
  'accepted',
] as const
export const applicationHistoryKinds = [
  'created',
  'status_changed',
  'company_edited',
  'source_edited',
  'link_created',
  'link_updated',
  'link_removed',
  'snapshot_refreshed',
  'removed',
  'restored',
] as const
export const applicationTechnicalStates = ['pending', 'running', 'succeeded', 'failed'] as const

/** Application bounds. */
export const APPLICATION_LINKS_MAX = 100
export const APPLICATION_SNAPSHOT_LINKS_MAX = 50
export const APPLICATION_DISPLAY_MAX_LENGTH = 500
export const APPLICATION_SUMMARY_MAX_LENGTH = 2_000

// --- Bounded JSON column classes (AC4/AC5) ---

/** Aggregate/payload-class snapshots. */
export const SNAPSHOT_JSON_MAX_BYTES = 262_144
/** Provenance and audit evidence — tighter than snapshots. */
export const AUDIT_JSON_MAX_BYTES = 16_384
