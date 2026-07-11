import { and, desc, eq, sql } from 'drizzle-orm'
import {
  canonicalSourceCandidates,
  normalizationFieldOutcomes,
  normalizationGates,
  normalizationRuns,
  rawSourceOccurrences,
  rawSourceRevisions,
  sourcingFindings,
} from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import type { ConnectorRunRecord } from './connector.repository'

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
  scope: {
    kind: 'connector_run'
    connectorRunId: string
  }
  provider: {
    returnedRows: number
    validRecords: number
    invalidRecords: number
    sourceDuplicates: number
    capturedRecords: number
    occurrenceCount: number
    captureShortfall: number
    unclassifiedRows: number
    invariant:
      | 'reconciled'
      | 'reported_stats_missing'
      | 'reported_stats_invalid'
      | 'reported_totals_inconsistent'
    gaps: ProviderStatsGap[]
  }
  destination: {
    normalized: number
    resolvedEmployerOrAts: number
    resolvedThirdParty: number
    unresolved: number
    pending: number
    gateRejected: number
    unclassified: number
    invariant: 'reconciled' | 'lineage_incomplete'
  }
  sourcing: {
    added: number
    queueDuplicate: number
    notFit: number
    rejected: number
    actionableReview: number
    unclassified: number
    invariant: 'reconciled' | 'lineage_incomplete'
  }
}

export function reconcileConnectorRunLifecycleCounts(
  database: DrizzleDatabase,
  run: ConnectorRunRecord,
): ConnectorRunLifecycleCounts {
  const stats = recordFromUnknown(run.stats)
  const occurrences = database
    .select({
      rawRecordId: rawSourceOccurrences.rawRecordId,
      rawRevisionId: rawSourceOccurrences.rawRevisionId,
      revision: rawSourceRevisions.revision,
      providerRecordId: rawSourceRevisions.providerRecordId,
    })
    .from(rawSourceOccurrences)
    .innerJoin(rawSourceRevisions, eq(rawSourceRevisions.id, rawSourceOccurrences.rawRevisionId))
    .where(eq(rawSourceOccurrences.connectorRunId, run.id))
    .all()
  const capturedRecords = new Set(occurrences.map(({ rawRecordId }) => rawRecordId)).size
  const capturedValidRecords = new Set(
    occurrences
      .filter(({ providerRecordId }) => Boolean(providerRecordId?.trim()))
      .map(({ rawRecordId }) => rawRecordId),
  ).size
  const capturedInvalidRecords = Math.max(0, capturedRecords - capturedValidRecords)
  const providerStats = [
    ['providerReturned', 'missing_provider_returned', 'invalid_provider_returned'],
    ['providerValid', 'missing_provider_valid', 'invalid_provider_valid'],
    ['providerInvalid', 'missing_provider_invalid', 'invalid_provider_invalid'],
    ['sourceDuplicates', 'missing_source_duplicates', 'invalid_source_duplicates'],
  ] as const
  const gaps: ProviderStatsGap[] = []
  for (const [key, missingGap, invalidGap] of providerStats) {
    if (!Object.prototype.hasOwnProperty.call(stats, key) || stats[key] === undefined) {
      gaps.push(missingGap)
    } else if (nonNegativeInteger(stats[key]) === null) {
      gaps.push(invalidGap)
    }
  }
  const reportedReturnedRows = nonNegativeInteger(stats.providerReturned)
  const reportedValidRows = nonNegativeInteger(stats.providerValid)
  const reportedInvalidRows = nonNegativeInteger(stats.providerInvalid)
  const reportedSourceDuplicates = nonNegativeInteger(stats.sourceDuplicates)
  if (gaps.length === 0) {
    if (reportedSourceDuplicates! > reportedValidRows!) {
      gaps.push('source_duplicates_exceed_valid')
    }
    if (reportedReturnedRows! !== reportedValidRows! + reportedInvalidRows!) {
      gaps.push('provider_equation_mismatch')
    }
  }
  const returnedRows = reportedReturnedRows ?? occurrences.length
  const invalidRecords = reportedInvalidRows ?? capturedInvalidRecords
  const sourceDuplicates = reportedSourceDuplicates ?? 0
  const validRecords = reportedValidRows !== null
    && reportedSourceDuplicates !== null
    && reportedValidRows >= reportedSourceDuplicates
    ? reportedValidRows - reportedSourceDuplicates
    : capturedValidRecords
  const classifiedRows = validRecords + invalidRecords + sourceDuplicates
  const providerInvariant = gaps.length === 0
    ? 'reconciled' as const
    : gaps.some((gap) => gap.startsWith('missing_'))
      ? 'reported_stats_missing' as const
      : gaps.some((gap) => gap.startsWith('invalid_'))
        ? 'reported_stats_invalid' as const
        : 'reported_totals_inconsistent' as const
  const scopedRevisions = new Map<string, { id: string; revision: number }>()
  for (const occurrence of occurrences) {
    const current = scopedRevisions.get(occurrence.rawRecordId)
    if (!current || occurrence.revision > current.revision) {
      scopedRevisions.set(occurrence.rawRecordId, {
        id: occurrence.rawRevisionId,
        revision: occurrence.revision,
      })
    }
  }
  const destination = {
    normalized: 0,
    resolvedEmployerOrAts: 0,
    resolvedThirdParty: 0,
    unresolved: 0,
    pending: 0,
    gateRejected: 0,
    unclassified: 0,
  }
  const normalizedJobs: Array<{ candidateId: string; sourceEntityId: string }> = []
  for (const revision of scopedRevisions.values()) {
    const normalization = database
      .select({
        runId: normalizationRuns.id,
        gateStatus: normalizationGates.status,
        candidateId: canonicalSourceCandidates.id,
        sourceEntityId: canonicalSourceCandidates.sourceEntityId,
        candidateJson: canonicalSourceCandidates.candidateJson,
      })
      .from(normalizationRuns)
      .innerJoin(normalizationGates, eq(normalizationGates.runId, normalizationRuns.id))
      .leftJoin(
        canonicalSourceCandidates,
        eq(canonicalSourceCandidates.runId, normalizationRuns.id),
      )
      .where(and(
        eq(normalizationRuns.rawRevisionId, revision.id),
        eq(normalizationRuns.triggerKind, 'intake'),
      ))
      .orderBy(
        desc(normalizationRuns.createdAt),
        sql`${normalizationRuns}.rowid desc`,
      )
      .get()
    if (!normalization) {
      destination.pending += 1
      continue
    }
    if (normalization.gateStatus === 'passed' && normalization.candidateJson) {
      const candidate = recordFromJson(normalization.candidateJson)
      const persistedDestination = recordFromUnknown(candidate.destination)
      if (persistedDestination.class === 'employer_or_ats') {
        destination.resolvedEmployerOrAts += 1
        destination.normalized += 1
      } else if (persistedDestination.class === 'third_party_job_posting') {
        destination.resolvedThirdParty += 1
        destination.normalized += 1
      } else {
        destination.unclassified += 1
      }
      if (normalization.candidateId && normalization.sourceEntityId) {
        normalizedJobs.push({
          candidateId: normalization.candidateId,
          sourceEntityId: normalization.sourceEntityId,
        })
      }
      continue
    }
    if (normalization.gateStatus === 'rejected') {
      destination.gateRejected += 1
      continue
    }
    const destinationOutcomes = database
      .select({
        resolverId: normalizationFieldOutcomes.resolverId,
        status: normalizationFieldOutcomes.status,
      })
      .from(normalizationFieldOutcomes)
      .where(and(
        eq(normalizationFieldOutcomes.runId, normalization.runId),
        eq(normalizationFieldOutcomes.field, 'destinationUrl'),
      ))
      .orderBy(desc(normalizationFieldOutcomes.sequence))
      .all()
    const destinationStatuses = new Set(destinationOutcomes.map(({ status }) => status))
    const connectorDestinationAttempted = destinationOutcomes.some(({ resolverId }) =>
      resolverId === 'jobright.authenticated-destination')
    if (
      destinationStatuses.size === 0
      || destinationStatuses.has('retry')
      || destinationStatuses.has('blocked')
      || !connectorDestinationAttempted
      || [...destinationStatuses].every((status) =>
        status === 'suppressed' || status === 'not_applicable')
    ) {
      destination.pending += 1
    } else if (destinationStatuses.has('abstained') || destinationStatuses.has('failed')) {
      destination.unresolved += 1
    } else {
      destination.unclassified += 1
    }
  }
  const destinationClassified = destination.normalized
    + destination.unresolved
    + destination.pending
    + destination.gateRejected
    + destination.unclassified
  const sourcing = {
    added: 0,
    queueDuplicate: 0,
    notFit: 0,
    rejected: 0,
    actionableReview: 0,
    unclassified: 0,
  }
  const seenFindingIds = new Set<string>()
  for (const job of normalizedJobs) {
    const finding = database
      .select({
        id: sourcingFindings.id,
        blocker: sourcingFindings.blocker,
        dispositionReason: sourcingFindings.dispositionReason,
        mergeStatus: sourcingFindings.mergeStatus,
      })
      .from(sourcingFindings)
      .where(eq(sourcingFindings.sourceEntityId, job.sourceEntityId))
      .get()
    if (!finding) {
      sourcing.unclassified += 1
      continue
    }
    if (seenFindingIds.has(finding.id)) {
      sourcing.queueDuplicate += 1
      continue
    }
    seenFindingIds.add(finding.id)
    if (finding.mergeStatus === 'new' || finding.mergeStatus === 'merged') {
      sourcing.added += 1
    } else if (finding.mergeStatus === 'duplicate') {
      sourcing.queueDuplicate += 1
    } else if (finding.mergeStatus === 'not_fit') {
      sourcing.notFit += 1
    } else if (
      finding.mergeStatus === 'below_cutoff'
      || finding.mergeStatus === 'not_pursued'
      || finding.mergeStatus === 'archived'
      || (finding.mergeStatus === 'blocked' && Boolean(finding.dispositionReason?.trim()))
    ) {
      sourcing.rejected += 1
    } else if (finding.mergeStatus === 'blocked' && Boolean(finding.blocker?.trim())) {
      sourcing.actionableReview += 1
    } else {
      sourcing.unclassified += 1
    }
  }
  const sourcingClassified = sourcing.added
    + sourcing.queueDuplicate
    + sourcing.notFit
    + sourcing.rejected
    + sourcing.actionableReview
    + sourcing.unclassified

  return {
    version: CONNECTOR_RUN_LIFECYCLE_COUNTS_VERSION,
    source: run.status === 'queued' || run.status === 'running'
      ? 'live_current'
      : 'derived_pre_feature',
    scope: { kind: 'connector_run', connectorRunId: run.id },
    provider: {
      returnedRows,
      validRecords,
      invalidRecords,
      sourceDuplicates,
      capturedRecords,
      occurrenceCount: occurrences.length,
      captureShortfall: Math.max(0, returnedRows - occurrences.length),
      unclassifiedRows: Math.max(0, returnedRows - classifiedRows),
      invariant: providerInvariant,
      gaps,
    },
    destination: {
      ...destination,
      invariant: destinationClassified === capturedRecords
        ? 'reconciled'
        : 'lineage_incomplete',
    },
    sourcing: {
      ...sourcing,
      invariant: sourcingClassified === destination.normalized
        ? 'reconciled'
        : 'lineage_incomplete',
    },
  }
}

export function freezeConnectorRunLifecycleCounts(
  database: DrizzleDatabase,
  run: ConnectorRunRecord,
): ConnectorRunLifecycleCounts {
  return {
    ...reconcileConnectorRunLifecycleCounts(database, run),
    source: 'frozen_terminal',
  }
}

export function readConnectorRunLifecycleCounts(
  stats: unknown,
  connectorRunId: string,
): ConnectorRunLifecycleCounts | null {
  const lifecycle = recordFromUnknown(recordFromUnknown(stats).lifecycleCounts)
  const scope = recordFromUnknown(lifecycle.scope)
  if (
    lifecycle.version !== CONNECTOR_RUN_LIFECYCLE_COUNTS_VERSION
    || lifecycle.source !== 'frozen_terminal'
    || scope.kind !== 'connector_run'
    || scope.connectorRunId !== connectorRunId
  ) {
    return null
  }
  return lifecycle as unknown as ConnectorRunLifecycleCounts
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function recordFromJson(value: string): Record<string, unknown> {
  try {
    return recordFromUnknown(JSON.parse(value))
  } catch {
    return {}
  }
}
