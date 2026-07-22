/**
 * Durable scheduled-work identities (issue #298). Owned by the scheduling module.
 *
 * One durable identity per umbrella-named operation, each with a typed subject
 * foreign key and bounded columns rather than unbounded payload ownership:
 *
 *   - connector_capture_work        : connector capture intake resumption
 *   - normalization_work            : Capture -> Job normalization
 *   - provider_url_resolution_work  : provider intermediary URL resolution (#233)
 *   - hosted_submission_work        : hosted Job-resolution submission/connectivity
 *   - hosted_result_polling_work    : hosted resolution result polling
 *
 * Separate rows in separate tables give each operation its own attempt budget,
 * status, and concurrency claim, so one operation can never exhaust or complete
 * another. Statuses and reasons are app-internal coordination values.
 */
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, pgTable, type PgColumn, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { FORBIDDEN_JSON_KEY_PREDICATE } from '../../db/sensitive-keys'
import { captureRevisions, captures } from '../capture/capture.schema'
import { connectorInstances } from '../../db/schema.connectors'
import { workspaces } from '../../db/workspaces.schema'

// 'terminal' is a typed deterministic failure, distinct from 'exhausted' (retryable
// budget ran out) and 'cancelled' (deliberate user/system cancellation).
export const scheduledWorkStatuses = ['scheduled', 'claimed', 'completed', 'exhausted', 'cancelled', 'terminal'] as const
// Retryable transient reasons shared by scheduled operations.
export const scheduledWorkRetryableReasons = ['rate_limit', 'server_failure', 'network_interruption', 'operation_timeout'] as const
// Deterministic terminal reasons (app-internal; not the sparxie contract). A row is
// 'terminal' iff its reason is one of these, and only 'terminal' rows carry them.
export const scheduledWorkDeterministicReasons = ['invalid_target', 'unresolvable', 'unsupported_provider', 'security_rejected'] as const

const FORBIDDEN_KEY = FORBIDDEN_JSON_KEY_PREDICATE

/** Fresh common column builders for every scheduled-work identity table. */
const scheduledWorkColumns = () => ({
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  idempotencyKey: text('idempotency_key').notNull(),
  attempt: integer('attempt').notNull(),
  maxAttempts: integer('max_attempts').notNull(),
  status: text('status').notNull(),
  nextEligibleAt: text('next_eligible_at'),
  failureReason: text('failure_reason'),
  failureDetail: text('failure_detail'),
  ownerVersion: text('owner_version').notNull(),
  acquisitionToken: text('acquisition_token'),
  claimedAt: text('claimed_at'),
  claimExpiresAt: text('claim_expires_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

interface ScheduledWorkColumns {
  workspaceId: PgColumn
  idempotencyKey: PgColumn
  attempt: PgColumn
  maxAttempts: PgColumn
  status: PgColumn
  nextEligibleAt: PgColumn
  failureReason: PgColumn
  failureDetail: PgColumn
  acquisitionToken: PgColumn
  claimedAt: PgColumn
}

/** Common workspace-ownership, idempotency-bound, budget, status, failure, and claim checks. */
function scheduledWorkChecks(prefix: string, t: ScheduledWorkColumns) {
  return {
    workspaceCheck: check(`chk_${prefix}_workspace`, sql`length(${t.workspaceId}) between 1 and 200`),
    idempotencyCheck: check(`chk_${prefix}_idempotency`, sql`length(${t.idempotencyKey}) between 1 and 200`),
    budgetCheck: check(`chk_${prefix}_budget`, sql`${t.attempt} >= 1 and ${t.maxAttempts} >= ${t.attempt}`),
    statusCheck: check(`chk_${prefix}_status`, sql`${t.status} in ('scheduled','claimed','completed','exhausted','cancelled','terminal')`),
    // A 'terminal' row carries exactly one deterministic reason; every other status
    // carries either no reason or a retryable one. Deterministic reasons appear only on terminal rows.
    reasonCheck: check(`chk_${prefix}_reason`, sql`(${t.status} = 'terminal' and ${t.failureReason} in ('invalid_target','unresolvable','unsupported_provider','security_rejected')) or (${t.status} <> 'terminal' and (${t.failureReason} is null or ${t.failureReason} in ('rate_limit','server_failure','network_interruption','operation_timeout')))`),
    detailCheck: check(`chk_${prefix}_detail`, sql`${t.failureDetail} is null or (length(${t.failureDetail}) between 1 and 2000 and ${t.failureDetail} ${sql.raw(FORBIDDEN_KEY)})`),
    timingCheck: check(`chk_${prefix}_timing`, sql`(${t.status} in ('scheduled','claimed') and ${t.nextEligibleAt} is not null) or (${t.status} in ('completed','exhausted','cancelled','terminal') and ${t.nextEligibleAt} is null)`),
    claimPairCheck: check(`chk_${prefix}_claim_pair`, sql`(${t.acquisitionToken} is null and ${t.claimedAt} is null) or (${t.acquisitionToken} is not null and ${t.claimedAt} is not null)`),
    scheduledUnclaimedCheck: check(`chk_${prefix}_scheduled_unclaimed`, sql`${t.status} <> 'scheduled' or ${t.acquisitionToken} is null`),
  }
}

export const connectorCaptureWork = pgTable(
  'connector_capture_work',
  {
    ...scheduledWorkColumns(),
    connectorInstanceId: text('connector_instance_id').notNull(),
    filterSignature: text('filter_signature').notNull(),
    checkpointSchemaVersion: text('checkpoint_schema_version').notNull(),
    checkpointGeneration: text('checkpoint_generation').notNull(),
    lastAttemptAt: text('last_attempt_at').notNull(),
    computedDelayMs: integer('computed_delay_ms'),
    serverMinimumDelayMs: integer('server_minimum_delay_ms'),
    horizonAt: text('horizon_at').notNull(),
    acquisitionRunId: text('acquisition_run_id'),
    skippedRunId: text('skipped_run_id'),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex('idx_connector_capture_work_idempotency').on(table.idempotencyKey),
    dueIdx: index('idx_connector_capture_work_due').on(table.status, table.nextEligibleAt),
    subjectIdx: index('idx_connector_capture_work_subject').on(table.connectorInstanceId, table.filterSignature),
    // AC5 concurrency serialization: at most one ACTIVE row per subject.
    activeSubjectIdx: uniqueIndex('idx_connector_capture_work_active_subject')
      .on(table.connectorInstanceId, table.filterSignature)
      .where(sql`${table.status} in ('scheduled','claimed')`),
    connectorFk: foreignKey({ name: 'fk_connector_capture_work_instance', columns: [table.connectorInstanceId], foreignColumns: [connectorInstances.id] }),
    filterCheck: check('chk_connector_capture_work_filter', sql`length(${table.filterSignature}) between 1 and 512`),
    serverMinimumCheck: check('chk_connector_capture_work_server_minimum', sql`${table.serverMinimumDelayMs} is null or ${table.serverMinimumDelayMs} >= 0`),
    ...scheduledWorkChecks('connector_capture_work', table),
  }),
)

export const normalizationWork = pgTable(
  'normalization_work',
  {
    ...scheduledWorkColumns(),
    captureId: text('capture_id').notNull(),
    captureRevision: integer('capture_revision').notNull(),
    resolverId: text('resolver_id').notNull(),
    resolverVersion: text('resolver_version').notNull(),
    inputHash: text('input_hash').notNull(),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex('idx_normalization_work_idempotency').on(table.idempotencyKey),
    dueIdx: index('idx_normalization_work_due').on(table.status, table.nextEligibleAt),
    subjectIdx: index('idx_normalization_work_subject').on(table.captureId, table.captureRevision),
    activeSubjectIdx: uniqueIndex('idx_normalization_work_active_subject')
      .on(table.captureId, table.captureRevision)
      .where(sql`${table.status} in ('scheduled','claimed')`),
    revisionFk: foreignKey({
      name: 'fk_normalization_work_revision',
      columns: [table.captureId, table.captureRevision],
      foreignColumns: [captureRevisions.captureId, captureRevisions.revision],
    }),
    revisionCheck: check('chk_normalization_work_revision', sql`${table.captureRevision} > 0`),
    resolverCheck: check('chk_normalization_work_resolver', sql`length(${table.resolverId}) between 1 and 256 and length(${table.resolverVersion}) between 1 and 128 and length(${table.inputHash}) between 1 and 256`),
    ...scheduledWorkChecks('normalization_work', table),
  }),
)

export const providerUrlResolutionWork = pgTable(
  'provider_url_resolution_work',
  {
    ...scheduledWorkColumns(),
    captureId: text('capture_id').notNull(),
    resolverId: text('resolver_id').notNull(),
    resolverVersion: text('resolver_version').notNull(),
    intermediaryUrlHash: text('intermediary_url_hash').notNull(),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex('idx_provider_url_resolution_work_idempotency').on(table.idempotencyKey),
    dueIdx: index('idx_provider_url_resolution_work_due').on(table.status, table.nextEligibleAt),
    subjectIdx: index('idx_provider_url_resolution_work_subject').on(table.captureId),
    activeSubjectIdx: uniqueIndex('idx_provider_url_resolution_work_active_subject')
      .on(table.captureId)
      .where(sql`${table.status} in ('scheduled','claimed')`),
    captureFk: foreignKey({ name: 'fk_provider_url_resolution_work_capture', columns: [table.captureId], foreignColumns: [captures.id] }),
    resolverCheck: check('chk_provider_url_resolution_work_resolver', sql`length(${table.resolverId}) between 1 and 256 and length(${table.resolverVersion}) between 1 and 128 and length(${table.intermediaryUrlHash}) between 1 and 256`),
    ...scheduledWorkChecks('provider_url_resolution_work', table),
  }),
)

export const hostedSubmissionWork = pgTable(
  'hosted_submission_work',
  {
    ...scheduledWorkColumns(),
    captureId: text('capture_id').notNull(),
    canonicalUrlHash: text('canonical_url_hash').notNull(),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex('idx_hosted_submission_work_idempotency').on(table.idempotencyKey),
    dueIdx: index('idx_hosted_submission_work_due').on(table.status, table.nextEligibleAt),
    subjectIdx: index('idx_hosted_submission_work_subject').on(table.captureId),
    activeSubjectIdx: uniqueIndex('idx_hosted_submission_work_active_subject')
      .on(table.captureId)
      .where(sql`${table.status} in ('scheduled','claimed')`),
    captureFk: foreignKey({ name: 'fk_hosted_submission_work_capture', columns: [table.captureId], foreignColumns: [captures.id] }),
    urlCheck: check('chk_hosted_submission_work_url', sql`length(${table.canonicalUrlHash}) between 1 and 256`),
    ...scheduledWorkChecks('hosted_submission_work', table),
  }),
)

export const hostedResultPollingWork = pgTable(
  'hosted_result_polling_work',
  {
    ...scheduledWorkColumns(),
    captureId: text('capture_id').notNull(),
    resolutionRequestId: text('resolution_request_id').notNull(),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex('idx_hosted_result_polling_work_idempotency').on(table.idempotencyKey),
    dueIdx: index('idx_hosted_result_polling_work_due').on(table.status, table.nextEligibleAt),
    subjectIdx: index('idx_hosted_result_polling_work_subject').on(table.captureId),
    activeSubjectIdx: uniqueIndex('idx_hosted_result_polling_work_active_subject')
      .on(table.captureId)
      .where(sql`${table.status} in ('scheduled','claimed')`),
    captureFk: foreignKey({ name: 'fk_hosted_result_polling_work_capture', columns: [table.captureId], foreignColumns: [captures.id] }),
    requestCheck: check('chk_hosted_result_polling_work_request', sql`length(${table.resolutionRequestId}) between 1 and 256`),
    ...scheduledWorkChecks('hosted_result_polling_work', table),
  }),
)
