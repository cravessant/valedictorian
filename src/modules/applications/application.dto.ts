/**
 * Application domain -> sparxie DTO serialization (issue #304, stage 3).
 *
 * Pure functions that flatten the canonical `applications` head row plus
 * its `pursuit_links` into the sparxie `Application` contract resource, assemble the
 * list page, serialize the attempt/event technical-list records, and reconstruct the
 * history snapshots. Read-side only: no policy, no transaction, no writes. The
 * Application aggregate service owns validation and mutation.
 *
 * Faithful field provenance (verified against application.aggregate.service.ts):
 *  - `snapshot` (contract `applicationPursuitSnapshot`) is DERIVED at read from the
 *    head's stored `{ job: { facts, factsRevision }, capturedAt }` blob. The Stage-2
 *    service stores the raw Job facts frozen at create (advanced only by an explicit
 *    refreshSnapshot), so the presentation shape is assembled here (fork resolution
 *    #304): every enum/string field falls back to a schema-valid default, so the
 *    #300-scoped placeholder-facts defect never yields an invalid snapshot;
 *    `capturedAt` prefers the stored value (honest create/refresh time), falling back
 *    to the head createdAt for rows written before that field existed; `initialLinks`
 *    prefers the creation-time links frozen additively in the stored snapshot blob
 *    (#304 upgrade: the Application service stamps them at create and carries them
 *    forward unchanged on refresh), falling back to [] for rows written before the
 *    field existed — so creation-time links stay durably attributable even after the
 *    mutable `pursuit_links` set is edited.
 *  - companyName/sourceName/status are head columns; `links` are the current
 *    `pursuit_links` rows. Attempt/event records mirror their sidecar tables (events
 *    reassemble the actor from the actor_id/type/display_name columns).
 *  - History snapshots replay status/company/source/tombstone/revision from the
 *    ordered `application_history` delta payloads. The embedded pursuit `snapshot`
 *    and `links` array reflect the CURRENT head state: the append-only delta stream
 *    records only linkIds (not full link fields), pursuit links are hard-deleted on
 *    unlink (no tombstone column), and snapshot_refreshed records no prior value —
 *    so their per-revision values are not recoverable from Stage-2 storage
 *    (contract reading #304, surfaced for review).
 */
import type {
  Application,
  ApplicationAttemptRecord,
  ApplicationEventRecord,
  ApplicationHistoryEntry,
  LifecycleApplicationHistoryResult,
} from '@sparxie/sdk'
import { jobTermSchema } from '@sparxie/sdk'
import { jobFactsTiming } from '../job/job.timing'
import { toContractActor, toLifecycleAuditFromJson } from '../lifecycle/lifecycle-audit.dto'
import {
  sliceLifecycleHistoryPage,
  type LifecyclePageWindow,
} from '../lifecycle/lifecycle-page.dto'

/** The subset of `applications` the read-model selects for a resource. */
export interface ApplicationHeadRow {
  readonly id: string
  readonly workspaceId: string
  readonly opportunityId: string
  readonly jobId: string
  readonly revision: number
  readonly status: string
  readonly jobFactsRevision: number
  readonly snapshotJson: string
  readonly companyName: string
  readonly sourceName: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly removedAt: string | null
}

/** The subset of `pursuit_links` the read-model selects. */
export interface ApplicationLinkRow {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly url: string
  readonly isPrimary: boolean
  readonly createdAt: string
}

/** The subset of `application_attempt_records` the read-model selects. */
export interface ApplicationAttemptRow {
  readonly id: string
  readonly workspaceId: string
  readonly applicationId: string
  readonly state: string
  readonly startedAt: string
  readonly completedAt: string | null
  readonly summary: string | null
}

/** The subset of `application_event_records` the read-model selects. */
export interface ApplicationEventRow {
  readonly id: string
  readonly workspaceId: string
  readonly applicationId: string
  readonly type: string
  readonly occurredAt: string
  readonly actorId: string
  readonly actorType: string
  readonly actorDisplayName: string | null
  readonly summary: string
}

/** One `application_history` row, ordered ascending by revision. */
export interface ApplicationHistoryRow {
  readonly revision: number
  readonly kind: string
  readonly snapshotJson: string
  readonly auditJson: string
  readonly createdAt: string
}

type ApplicationId = Application['id']
type OpportunityId = Application['opportunityId']
type JobId = Application['jobId']

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function orderByCreated<T extends { readonly createdAt: string; readonly id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) =>
    left.createdAt === right.createdAt ? left.id.localeCompare(right.id) : left.createdAt.localeCompare(right.createdAt),
  )
}

function toLink(row: ApplicationLinkRow): Application['links'][number] {
  return { kind: row.kind, label: row.label, url: row.url, id: row.id, isPrimary: row.isPrimary }
}

type PursuitSnapshot = Application['snapshot']

const ROLE_KINDS = new Set(['internship', 'co_op', 'new_grad', 'entry_level', 'experienced', 'other'])
const TIMING_MODES = new Set(['fixed', 'rolling', 'unknown'])
const WORK_MODES = new Set(['onsite', 'hybrid', 'remote', 'unknown'])
const DESTINATION_CLASSES = new Set(['employer_or_ats', 'third_party_job_posting'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function boundedString(value: unknown, fallback: string, max = 500): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed.slice(0, max)
  }
  return fallback
}

function nullableString(value: unknown, max = 500): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed.slice(0, max)
  }
  return null
}

function enumOr<T extends string>(value: unknown, allowed: ReadonlySet<string>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value) ? (value as T) : fallback
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === 'string' && ISO_DATE.test(value) ? value : null
}

/**
 * Decode the stored terms leniently — a corrupt entry is dropped, never thrown — against the
 * live `jobTermSchema`. The survivors are contract-valid and within the array cap, which is
 * what lets `jobFactsTiming` canonicalize them without the read path ever being able to throw.
 */
function deriveTerms(value: unknown): PursuitSnapshot['terms'] {
  if (!Array.isArray(value)) return []
  const terms: PursuitSnapshot['terms'] = []
  for (const entry of value) {
    const parsed = jobTermSchema.safeParse(entry)
    if (parsed.success) terms.push(parsed.data)
    if (terms.length >= 20) break
  }
  return terms
}

function deriveLocation(value: unknown): PursuitSnapshot['location'] {
  const record = asObject(value)
  if (typeof record.display !== 'string' || record.display.trim().length === 0) return null
  return {
    display: record.display.trim().slice(0, 500),
    city: nullableString(record.city, 200),
    region: nullableString(record.region, 200),
    country: nullableString(record.country, 200),
  }
}

function deriveDestination(value: unknown): PursuitSnapshot['initialDestination'] {
  const record = asObject(value)
  if (!DESTINATION_CLASSES.has(record.class as string) || typeof record.url !== 'string' || record.url.trim().length === 0) {
    return null
  }
  return { class: record.class as NonNullable<PursuitSnapshot['initialDestination']>['class'], url: record.url }
}

/**
 * #304 initialLinks upgrade: prefer the creation-time links frozen in the stored
 * snapshot blob (persisted additively by the Application service at create), falling
 * back to [] for rows written before the field existed. Only well-formed entries
 * (non-empty kind/label/url strings) are surfaced, so the strict contract snapshot
 * schema always parses.
 */
function deriveInitialLinks(value: unknown): PursuitSnapshot['initialLinks'] {
  if (!Array.isArray(value)) return []
  const links: PursuitSnapshot['initialLinks'][number][] = []
  for (const entry of value) {
    const record = asObject(entry)
    if (
      typeof record.kind === 'string' && record.kind.trim().length > 0
      && typeof record.label === 'string' && record.label.trim().length > 0
      && typeof record.url === 'string' && record.url.trim().length > 0
    ) {
      links.push({ kind: record.kind, label: record.label, url: record.url })
    }
    if (links.length >= 50) break
  }
  return links
}

/**
 * Derive the contract `applicationPursuitSnapshot` from the head's stored
 * `{ job: { facts, factsRevision }, capturedAt }` blob (fork resolution #304).
 * Every enum/string field falls back to a schema-valid default; `capturedAt` prefers
 * the stored value and falls back to the head createdAt; `initialLinks` is always [].
 * `term` is projected from the structured `terms` rather than read back from the blob,
 * so it stays a formatted display value and never a stored input (#396).
 */
export function deriveApplicationSnapshot(head: ApplicationHeadRow): PursuitSnapshot {
  const stored = asObject(parseJson(head.snapshotJson))
  const job = asObject(stored.job)
  const facts = asObject(job.facts)
  const jobFactsRevision = typeof job.factsRevision === 'number' && Number.isInteger(job.factsRevision) && job.factsRevision > 0
    ? job.factsRevision
    : head.jobFactsRevision
  const capturedAt = typeof stored.capturedAt === 'string' && stored.capturedAt.length > 0 ? stored.capturedAt : head.createdAt
  return {
    jobFactsRevision,
    capturedAt,
    companyName: boundedString(facts.companyName, head.companyName),
    roleTitle: boundedString(facts.roleTitle, 'Unknown'),
    sourceName: boundedString(facts.sourceName, head.sourceName),
    roleKind: enumOr(facts.roleKind, ROLE_KINDS, 'other'),
    ...jobFactsTiming({
      terms: deriveTerms(facts.terms),
      timingMode: enumOr(facts.timingMode, TIMING_MODES, 'unknown'),
      startDate: isoDateOrNull(facts.startDate),
      endDate: isoDateOrNull(facts.endDate),
    }),
    location: deriveLocation(facts.location),
    workMode: enumOr(facts.workMode, WORK_MODES, 'unknown'),
    initialDestination: deriveDestination(facts.destination),
    initialLinks: deriveInitialLinks(stored.initialLinks),
  }
}

/**
 * Flatten one application head row plus its current links into the sparxie
 * `Application` resource. Matches `applicationSchema` exactly.
 */
export function toApplicationResource(head: ApplicationHeadRow, links: readonly ApplicationLinkRow[]): Application {
  return {
    id: head.id as ApplicationId,
    workspaceId: head.workspaceId,
    opportunityId: head.opportunityId as OpportunityId,
    jobId: head.jobId as JobId,
    revision: head.revision,
    status: head.status as Application['status'],
    snapshot: deriveApplicationSnapshot(head),
    companyName: head.companyName,
    sourceName: head.sourceName,
    links: orderByCreated(links).map(toLink),
    createdAt: head.createdAt,
    updatedAt: head.updatedAt,
    removedAt: head.removedAt,
  }
}

/** Serialize an attempt sidecar row into the `applicationAttemptRecordSchema` shape. */
export function toAttemptRecord(row: ApplicationAttemptRow): ApplicationAttemptRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    applicationId: row.applicationId,
    state: row.state as ApplicationAttemptRecord['state'],
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    summary: row.summary,
  }
}

/** Serialize an event sidecar row (reassembling the actor) into the record schema shape. */
export function toEventRecord(row: ApplicationEventRow): ApplicationEventRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    applicationId: row.applicationId,
    type: row.type,
    occurredAt: row.occurredAt,
    actor: toContractActor({ id: row.actorId, type: row.actorType, displayName: row.actorDisplayName ?? undefined }),
    summary: row.summary,
  }
}

/**
 * Reconstruct the per-revision `ApplicationHistoryEntry` snapshots. status/company/
 * source/tombstone/revision replay from the ordered delta payloads; the embedded
 * pursuit snapshot and links reflect the head's current state (see module doc).
 */
export function reconstructApplicationHistory(
  head: ApplicationHeadRow,
  history: readonly ApplicationHistoryRow[],
  links: readonly ApplicationLinkRow[],
  window: LifecyclePageWindow,
): LifecycleApplicationHistoryResult {
  const ordered = [...history].sort((left, right) => left.revision - right.revision)
  const currentLinks = orderByCreated(links).map(toLink)
  const snapshot = deriveApplicationSnapshot(head)

  let status = head.status
  let companyName = head.companyName
  let sourceName = head.sourceName
  let removedAt: string | null = null

  const all: ApplicationHistoryEntry[] = []
  for (const row of ordered) {
    const payload = parseJson(row.snapshotJson)
    const delta = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
    if (typeof delta.status === 'string') status = delta.status
    if (typeof delta.companyName === 'string') companyName = delta.companyName
    if (typeof delta.sourceName === 'string') sourceName = delta.sourceName
    if (row.kind === 'removed') removedAt = row.createdAt
    else if (row.kind === 'restored') removedAt = null

    const resource: Application = {
      id: head.id as ApplicationId,
      workspaceId: head.workspaceId,
      opportunityId: head.opportunityId as OpportunityId,
      jobId: head.jobId as JobId,
      revision: row.revision,
      status: status as Application['status'],
      snapshot,
      companyName,
      sourceName,
      links: currentLinks,
      createdAt: head.createdAt,
      updatedAt: row.createdAt,
      removedAt,
    }
    all.push({
      applicationId: head.id as ApplicationId,
      revision: row.revision,
      kind: row.kind as ApplicationHistoryEntry['kind'],
      snapshot: resource,
      audit: toLifecycleAuditFromJson(row.auditJson, row.createdAt),
    })
  }

  return sliceLifecycleHistoryPage(all, window, (entry) => entry.revision)
}
