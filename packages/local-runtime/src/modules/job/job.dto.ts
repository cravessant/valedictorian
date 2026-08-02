/**
 * Job domain -> sparxie DTO serialization (issue #304, stage 3).
 *
 * Pure functions that flatten the canonical `jobs` head row plus its
 * active `job_external_identities` and `job_capture_evidence_references` into the
 * sparxie `Job` contract resource, assemble the `JobListResult` page, and
 * reconstruct the `JobHistoryResult` snapshots. Read-side only: no policy, no
 * transaction, no writes. The Job service (src/modules/job/job.service.ts) and its
 * identity module remain the sole owners of validation and mutation; this module
 * re-shapes rows the read-model has already loaded.
 *
 * Faithful field provenance (verified against job.service.ts + job.schema.ts):
 *  - `facts` is the immutable-per-revision facts JSON blob the head stores; the
 *    create/correct boundary validated it against the contract, so the head row
 *    is authoritative and passed through verbatim.
 *  - `externalIdentities` / `captureEvidenceReferences` mirror the ACTIVE
 *    (removedAt is null) identity and lineage rows, ordered by (createdAt, id).
 *  - History snapshots replay facts/availability/removedAt/revisions from the
 *    ordered `job_history` payloads; identities and evidence references are
 *    reconstructed point-in-time from each row's createdAt/removedAt against the
 *    history row's timestamp (the identity/lineage tables carry no per-sequence
 *    linkage, so their monotonic timestamps are the faithful as-of signal).
 */
import type {
  Job,
  JobHistoryEntry,
  JobHistoryResult,
} from '@sparxie/sdk'
import { jobFactsSchema, jobFactsV2Schema } from '@sparxie/sdk'
import { toLifecycleAuditFromJson } from '../lifecycle/lifecycle-audit.dto.js'
import {
  sliceLifecycleHistoryPage,
  type LifecyclePageWindow,
} from '../lifecycle/lifecycle-page.dto.js'

/** The subset of `jobs` the read-model selects for a resource. */
export interface JobHeadRow {
  readonly id: string
  readonly workspaceId: string
  readonly factsRevision: number
  readonly factsJson: string
  readonly availabilityState: string
  readonly availabilityObservedAt: string
  readonly availabilityRevision: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly removedAt: string | null
}

/** The subset of `job_external_identities` the read-model selects. */
export interface JobIdentityRow {
  readonly id: string
  readonly kind: string
  readonly provider: string
  readonly account: string | null
  readonly value: string
  readonly strength: string
  readonly createdAt: string
  readonly removedAt: string | null
}

/** The subset of `job_capture_evidence_references` the read-model selects. */
export interface JobEvidenceRefRow {
  readonly id: string
  readonly captureId: string
  readonly captureRevision: number
  readonly evidenceIndexesJson: string
  readonly createdAt: string
}

/** One `job_history` row, ordered ascending by sequence. */
export interface JobHistoryRow {
  readonly sequence: number
  readonly kind: string
  readonly snapshotJson: string
  readonly auditJson: string
  readonly createdAt: string
}

type JobId = Job['id']

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * The public Job resource remains on the V1 contract while V2 completion stores
 * its URL-only destination shape. A V1 destination cannot truthfully represent
 * that URL without manufacturing a class, so omit it in this response-only
 * projection. The persisted facts JSON remains the authoritative V2 value.
 */
function toV1JobFacts(value: unknown): Job['facts'] {
  const v1 = jobFactsSchema.safeParse(value)
  if (v1.success) return v1.data

  const v2 = jobFactsV2Schema.safeParse(value)
  if (v2.success) {
    const { destination: _destination, ...facts } = v2.data
    return jobFactsSchema.parse({ ...facts, destination: null })
  }

  return jobFactsSchema.parse(value)
}

function orderByCreated<T extends { readonly createdAt: string; readonly id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) =>
    left.createdAt === right.createdAt ? left.id.localeCompare(right.id) : left.createdAt.localeCompare(right.createdAt),
  )
}

function toIdentity(row: JobIdentityRow): Job['externalIdentities'][number] {
  return {
    kind: row.kind as Job['externalIdentities'][number]['kind'],
    provider: row.provider,
    account: row.account,
    value: row.value,
    strength: row.strength as Job['externalIdentities'][number]['strength'],
  }
}

function toEvidenceRef(row: JobEvidenceRefRow): Job['captureEvidenceReferences'][number] {
  const indexes = parseJson(row.evidenceIndexesJson)
  return {
    captureId: row.captureId,
    captureRevision: row.captureRevision,
    evidenceIndexes: Array.isArray(indexes) ? (indexes as number[]) : [],
  }
}

/**
 * Flatten one job head row plus its active identities/evidence references into the
 * sparxie `Job` resource. Matches `jobSchema` exactly.
 */
export function toJobResource(
  head: JobHeadRow,
  identities: readonly JobIdentityRow[],
  evidenceRefs: readonly JobEvidenceRefRow[],
): Job {
  return {
    id: head.id as JobId,
    workspaceId: head.workspaceId,
    factsRevision: head.factsRevision,
    facts: toV1JobFacts(parseJson(head.factsJson)),
    availabilityRevision: head.availabilityRevision,
    availability: {
      state: head.availabilityState as Job['availability']['state'],
      observedAt: head.availabilityObservedAt,
    },
    externalIdentities: orderByCreated(identities).map(toIdentity),
    captureEvidenceReferences: orderByCreated(evidenceRefs).map(toEvidenceRef),
    createdAt: head.createdAt,
    updatedAt: head.updatedAt,
    removedAt: head.removedAt,
  }
}

/**
 * Reconstruct the per-sequence `JobHistoryEntry` snapshots. Facts, availability,
 * tombstone state, and the two revision counters are replayed from the ordered
 * history payloads; identities/evidence references are taken point-in-time from
 * their table rows (present when created at-or-before the history row's timestamp
 * and not yet removed as of it).
 */
export function reconstructJobHistory(
  head: JobHeadRow,
  history: readonly JobHistoryRow[],
  identities: readonly JobIdentityRow[],
  evidenceRefs: readonly JobEvidenceRefRow[],
  window: LifecyclePageWindow,
): JobHistoryResult {
  const ordered = [...history].sort((left, right) => left.sequence - right.sequence)

  // Replay mutable state forward across every sequence.
  let facts: unknown = parseJson(head.factsJson)
  let factsRevision = 0
  let availabilityState = head.availabilityState
  let availabilityObservedAt = head.availabilityObservedAt
  let availabilityRevision = 0
  let removedAt: string | null = null

  const all: JobHistoryEntry[] = []
  for (const row of ordered) {
    const payload = parseJson(row.snapshotJson)
    const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
    switch (row.kind) {
      case 'created':
        facts = payload
        factsRevision = 1
        availabilityRevision = 1
        break
      case 'facts_corrected':
        facts = payload
        factsRevision += 1
        break
      case 'availability_changed':
        if (typeof record.state === 'string') availabilityState = record.state
        if (typeof record.observedAt === 'string') availabilityObservedAt = record.observedAt
        availabilityRevision += 1
        break
      case 'removed':
        removedAt = row.createdAt
        break
      case 'restored':
        removedAt = null
        break
      // identity_added / identity_removed do not alter facts/availability/tombstone.
      default:
        break
    }

    const asOf = row.createdAt
    const activeIdentities = identities.filter(
      (identity) => identity.createdAt <= asOf && (identity.removedAt === null || identity.removedAt > asOf),
    )
    const activeEvidenceRefs = evidenceRefs.filter((reference) => reference.createdAt <= asOf)
    // A Job's founding lineage is written in the same transaction as its
    // creation history, but its physical timestamp can be a later clock tick.
    // Keep that required lineage on the reconstructed creation snapshot so it
    // remains a valid V1 Job resource.
    if (activeEvidenceRefs.length === 0 && evidenceRefs.length > 0) {
      activeEvidenceRefs.push(orderByCreated(evidenceRefs)[0]!)
    }
    const snapshot: Job = {
      ...toJobResource(head, activeIdentities, activeEvidenceRefs),
      facts: toV1JobFacts(facts),
      factsRevision,
      availabilityRevision,
      availability: {
        state: availabilityState as Job['availability']['state'],
        observedAt: availabilityObservedAt,
      },
      updatedAt: row.createdAt,
      removedAt,
    }
    all.push({
      jobId: head.id as JobId,
      sequence: row.sequence,
      kind: row.kind as JobHistoryEntry['kind'],
      snapshot,
      audit: toLifecycleAuditFromJson(row.auditJson, row.createdAt),
    })
  }

  return sliceLifecycleHistoryPage(all, window, (entry) => entry.sequence)
}
