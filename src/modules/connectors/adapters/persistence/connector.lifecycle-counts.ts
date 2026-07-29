import { and, eq } from 'drizzle-orm'
import {
  captureOccurrences,
  jobCaptureEvidenceReferences,
  captures,
  jobs,
  opportunities,
} from '../../../../db/schema'
import type { PgliteDatabase } from '../../../../db/pglite'
import type { ConnectorRunRecord } from '../../ports/connector-run.records'

export const CONNECTOR_RUN_LIFECYCLE_COUNTS_VERSION = 'connector-run-lifecycle-counts/v1'

export type ProviderStatsGap =
  | 'missing_provider_returned'
  | 'missing_provider_valid'
  | 'missing_provider_invalid'
  | 'missing_source_duplicates'
  | 'invalid_provider_returned'
  | 'invalid_provider_valid'
  | 'invalid_provider_invalid'
  | 'invalid_source_duplicates'
  | 'provider_equation_mismatch'
  | 'source_duplicates_exceed_valid'

export interface ConnectorRunLifecycleCounts {
  version: typeof CONNECTOR_RUN_LIFECYCLE_COUNTS_VERSION
  source: 'live_current' | 'derived_pre_feature' | 'frozen_terminal'
  scope: { kind: 'connector_run'; connectorRunId: string; executionScopeId: string }
  provider: {
    returnedRows: number; validRecords: number; invalidRecords: number
    sourceDuplicates: number; capturedRecords: number; occurrenceCount: number
    captureShortfall: number; unclassifiedRows: number
    invariant: 'reconciled' | 'reported_stats_missing' | 'reported_stats_invalid' | 'reported_totals_inconsistent'
    gaps: ProviderStatsGap[]
  }
  destination: {
    normalized: number; resolvedEmployerOrAts: number; resolvedThirdParty: number
    unresolved: number; pending: number; gateRejected: number; unclassified: number
    invariant: 'reconciled' | 'lineage_incomplete'
  }
  sourcing: {
    added: number; queueDuplicate: number; notFit: number; rejected: number
    actionableReview: number; unclassified: number
    invariant: 'reconciled' | 'lineage_incomplete'
  }
}

export function reconcileProviderLifecycleCounts(
  input: unknown,
  capture: {
    capturedRecords: number; capturedValidRecords: number
    capturedInvalidRecords: number; occurrenceCount: number
  },
): ConnectorRunLifecycleCounts['provider'] {
  const stats = recordFromUnknown(input)
  const fields = [
    ['providerReturned', 'missing_provider_returned', 'invalid_provider_returned'],
    ['providerValid', 'missing_provider_valid', 'invalid_provider_valid'],
    ['providerInvalid', 'missing_provider_invalid', 'invalid_provider_invalid'],
    ['sourceDuplicates', 'missing_source_duplicates', 'invalid_source_duplicates'],
  ] as const
  const gaps: ProviderStatsGap[] = []
  for (const [key, missing, invalid] of fields) {
    if (!Object.prototype.hasOwnProperty.call(stats, key) || stats[key] === undefined) gaps.push(missing)
    else if (nonNegativeInteger(stats[key]) === null) gaps.push(invalid)
  }
  const reportedReturnedRows = nonNegativeInteger(stats.providerReturned)
  const reportedValidRows = nonNegativeInteger(stats.providerValid)
  const reportedInvalidRows = nonNegativeInteger(stats.providerInvalid)
  const reportedSourceDuplicates = nonNegativeInteger(stats.sourceDuplicates)
  if (gaps.length === 0) {
    if (reportedSourceDuplicates! > reportedValidRows!) gaps.push('source_duplicates_exceed_valid')
    if (reportedReturnedRows! !== reportedValidRows! + reportedInvalidRows!) gaps.push('provider_equation_mismatch')
  }
  const returnedRows = reportedReturnedRows ?? 0
  const invalidRecords = reportedInvalidRows ?? capture.capturedInvalidRecords
  const sourceDuplicates = reportedSourceDuplicates ?? 0
  const validRecords = reportedValidRows !== null && reportedSourceDuplicates !== null
    && reportedValidRows >= reportedSourceDuplicates
    ? reportedValidRows - reportedSourceDuplicates : capture.capturedValidRecords
  const classifiedRows = validRecords + invalidRecords + sourceDuplicates
  const invariant = gaps.length === 0 ? 'reconciled' as const
    : gaps.some((gap) => gap.startsWith('missing_')) ? 'reported_stats_missing' as const
      : gaps.some((gap) => gap.startsWith('invalid_')) ? 'reported_stats_invalid' as const
        : 'reported_totals_inconsistent' as const
  return {
    returnedRows, validRecords, invalidRecords, sourceDuplicates,
    capturedRecords: capture.capturedRecords, occurrenceCount: capture.occurrenceCount,
    captureShortfall: Math.max(0, returnedRows - capture.occurrenceCount),
    unclassifiedRows: Math.max(0, returnedRows - classifiedRows), invariant, gaps,
  }
}

export async function reconcileConnectorRunLifecycleCounts(
  database: Pick<PgliteDatabase, 'select'>,
  run: ConnectorRunRecord,
): Promise<ConnectorRunLifecycleCounts> {
  const occurrences = await database.select({
    captureId: captureOccurrences.captureId,
    captureRevision: captureOccurrences.captureRevision,
    providerRecordId: captures.providerRecordId,
  }).from(captureOccurrences)
    .innerJoin(captures, eq(captures.id, captureOccurrences.captureId))
    .where(eq(captureOccurrences.connectorRunId, run.id))
  const captureIds = new Set(occurrences.map((row) => row.captureId))
  const validIds = new Set(occurrences.filter((row) => row.providerRecordId?.trim()).map((row) => row.captureId))
  const provider = reconcileProviderLifecycleCounts(run.stats, {
    capturedRecords: captureIds.size,
    capturedValidRecords: validIds.size,
    capturedInvalidRecords: Math.max(0, captureIds.size - validIds.size),
    occurrenceCount: occurrences.length,
  })
  const latest = new Map<string, number>()
  for (const occurrence of occurrences) {
    latest.set(occurrence.captureId, Math.max(latest.get(occurrence.captureId) ?? 0, occurrence.captureRevision))
  }
  const destination = {
    normalized: 0, resolvedEmployerOrAts: 0, resolvedThirdParty: 0,
    unresolved: 0, pending: 0, gateRejected: 0, unclassified: 0,
  }
  const sourcing = {
    added: 0, queueDuplicate: 0, notFit: 0,
    rejected: 0, actionableReview: 0, unclassified: 0,
  }
  const seenJobs = new Set<string>()
  for (const [captureId, revision] of latest) {
    const [lineage] = await database.select({
      jobId: jobs.id,
      factsJson: jobs.factsJson,
    }).from(jobCaptureEvidenceReferences)
      .innerJoin(jobs, eq(jobs.id, jobCaptureEvidenceReferences.jobId))
      .where(and(
        eq(jobCaptureEvidenceReferences.captureId, captureId),
        eq(jobCaptureEvidenceReferences.captureRevision, revision),
      )).limit(1)
    if (!lineage) {
      destination.pending += 1
      continue
    }
    destination.normalized += 1
    const destinationClass = recordFromUnknown(recordFromJson(lineage.factsJson).destination).class
    if (destinationClass === 'third_party_job_posting') destination.resolvedThirdParty += 1
    else if (destinationClass === 'employer_or_ats') destination.resolvedEmployerOrAts += 1
    else destination.unclassified += 1
    if (seenJobs.has(lineage.jobId)) {
      sourcing.queueDuplicate += 1
      continue
    }
    seenJobs.add(lineage.jobId)
    const [opportunity] = await database.select({
      fit: opportunities.fit,
      cutoff: opportunities.cutoff,
      disposition: opportunities.disposition,
    }).from(opportunities)
      .where(eq(opportunities.jobId, lineage.jobId)).limit(1)
    if (!opportunity) sourcing.unclassified += 1
    else if (opportunity.fit === 'not_fit') sourcing.notFit += 1
    else if (opportunity.cutoff === 'below' || opportunity.disposition === 'declined' || opportunity.disposition === 'archived') sourcing.rejected += 1
    else if (opportunity.disposition === 'pursue') sourcing.added += 1
    else sourcing.actionableReview += 1
  }
  const destinationClassified = destination.normalized + destination.unresolved
    + destination.pending + destination.gateRejected
  const sourcingClassified = sourcing.added + sourcing.queueDuplicate + sourcing.notFit
    + sourcing.rejected + sourcing.actionableReview + sourcing.unclassified
  return {
    version: CONNECTOR_RUN_LIFECYCLE_COUNTS_VERSION,
    source: run.status === 'queued' || run.status === 'running' ? 'live_current' : 'derived_pre_feature',
    scope: { kind: 'connector_run', connectorRunId: run.id, executionScopeId: run.executionScopeId },
    provider,
    destination: { ...destination, invariant: destinationClassified === captureIds.size ? 'reconciled' : 'lineage_incomplete' },
    sourcing: { ...sourcing, invariant: sourcingClassified === destination.normalized ? 'reconciled' : 'lineage_incomplete' },
  }
}

export async function freezeConnectorRunLifecycleCounts(
  database: Pick<PgliteDatabase, 'select'>,
  run: ConnectorRunRecord,
): Promise<ConnectorRunLifecycleCounts> {
  return { ...await reconcileConnectorRunLifecycleCounts(database, run), source: 'frozen_terminal' }
}

export function readConnectorRunLifecycleCounts(
  stats: unknown,
  connectorRunId: string,
): ConnectorRunLifecycleCounts | null {
  const lifecycle = recordFromUnknown(recordFromUnknown(stats).lifecycleCounts)
  const scope = recordFromUnknown(lifecycle.scope)
  if (lifecycle.version !== CONNECTOR_RUN_LIFECYCLE_COUNTS_VERSION
    || lifecycle.source !== 'frozen_terminal'
    || scope.kind !== 'connector_run'
    || scope.connectorRunId !== connectorRunId) return null
  return lifecycle as unknown as ConnectorRunLifecycleCounts
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function recordFromJson(value: string): Record<string, unknown> {
  try { return recordFromUnknown(JSON.parse(value)) } catch { return {} }
}
