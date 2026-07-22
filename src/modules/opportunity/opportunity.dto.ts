/**
 * Opportunity domain -> sparxie DTO serialization (issue #304, stage 3).
 *
 * Pure functions that flatten the canonical `lifecycle_opportunities` head row
 * into the sparxie `Opportunity` contract resource, assemble the
 * `OpportunityListResult` page, and reconstruct the `OpportunityHistoryResult`
 * snapshots. Read-side only: no policy, no transaction, no writes. The Opportunity
 * service owns validation and mutation.
 *
 * Faithful field provenance (verified against opportunity.service.ts):
 *  - fit/rank/cutoff/disposition/removedAt are the head's current evaluation +
 *    tombstone state; `override` is parsed from the head `override_json`.
 *  - History snapshots replay fit/rank/cutoff/disposition/removedAt from the
 *    ordered `opportunity_history` delta payloads (created sets all four,
 *    evaluation_changed sets the present subset of fit/rank/cutoff,
 *    disposition_changed sets disposition, removed/restored toggle the tombstone).
 *    `override` is a head-only column that never appears in a history payload, so
 *    every reconstructed snapshot carries `override: null` (contract reading #304:
 *    the warning override is a property of the current head, not a per-revision
 *    fact the append-only stream records).
 */
import type {
  Opportunity,
  OpportunityHistoryEntry,
  OpportunityHistoryResult,
  OpportunityListInput,
  OpportunityListResult,
} from 'sparxie'
import { toLifecycleAuditFromJson } from '../lifecycle/lifecycle-audit.dto'

/** The subset of `lifecycle_opportunities` the read-model selects for a resource. */
export interface OpportunityHeadRow {
  readonly id: string
  readonly workspaceId: string
  readonly jobId: string
  readonly revision: number
  readonly fit: string
  readonly rank: number | null
  readonly cutoff: string
  readonly disposition: string
  readonly overrideJson: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly removedAt: string | null
}

/** One `opportunity_history` row, ordered ascending by revision. */
export interface OpportunityHistoryRow {
  readonly revision: number
  readonly kind: string
  readonly snapshotJson: string
  readonly auditJson: string
  readonly createdAt: string
}

type OpportunityId = Opportunity['id']
type JobId = Opportunity['jobId']

function parseJson(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function toOverride(overrideJson: string | null): Opportunity['override'] {
  const parsed = parseJson(overrideJson)
  return (typeof parsed === 'object' && parsed !== null ? parsed : null) as Opportunity['override']
}

/**
 * Flatten one opportunity head row into the sparxie `Opportunity` resource.
 * Matches `opportunitySchema` exactly.
 */
export function toOpportunityResource(head: OpportunityHeadRow): Opportunity {
  return {
    id: head.id as OpportunityId,
    workspaceId: head.workspaceId,
    jobId: head.jobId as JobId,
    revision: head.revision,
    fit: head.fit as Opportunity['fit'],
    rank: head.rank,
    cutoff: head.cutoff as Opportunity['cutoff'],
    disposition: head.disposition as Opportunity['disposition'],
    override: toOverride(head.overrideJson),
    createdAt: head.createdAt,
    updatedAt: head.updatedAt,
    removedAt: head.removedAt,
  }
}

/**
 * Reconstruct the per-revision `OpportunityHistoryEntry` snapshots by replaying the
 * ordered history delta payloads over the head's immutable identity fields.
 */
export function reconstructOpportunityHistory(
  head: OpportunityHeadRow,
  history: readonly OpportunityHistoryRow[],
  options: { readonly limit: number; readonly afterRevision?: number },
): OpportunityHistoryResult {
  const ordered = [...history].sort((left, right) => left.revision - right.revision)

  let fit = head.fit
  let rank = head.rank
  let cutoff = head.cutoff
  let disposition = head.disposition
  let removedAt: string | null = null

  const all: OpportunityHistoryEntry[] = []
  for (const row of ordered) {
    const payload = parseJson(row.snapshotJson)
    const delta = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
    if (typeof delta.fit === 'string') fit = delta.fit
    if (delta.rank === null || typeof delta.rank === 'number') rank = delta.rank as number | null
    if (typeof delta.cutoff === 'string') cutoff = delta.cutoff
    if (typeof delta.disposition === 'string') disposition = delta.disposition
    if (row.kind === 'removed') removedAt = row.createdAt
    else if (row.kind === 'restored') removedAt = null

    const snapshot: Opportunity = {
      id: head.id as OpportunityId,
      workspaceId: head.workspaceId,
      jobId: head.jobId as JobId,
      revision: row.revision,
      fit: fit as Opportunity['fit'],
      rank,
      cutoff: cutoff as Opportunity['cutoff'],
      disposition: disposition as Opportunity['disposition'],
      // override is a head-only column, never recorded per-revision (contract reading #304).
      override: null,
      createdAt: head.createdAt,
      updatedAt: row.createdAt,
      removedAt,
    }
    all.push({
      opportunityId: head.id as OpportunityId,
      revision: row.revision,
      kind: row.kind as OpportunityHistoryEntry['kind'],
      snapshot,
      audit: toLifecycleAuditFromJson(row.auditJson, row.createdAt),
    })
  }

  const afterRevision = options.afterRevision
  const windowed = afterRevision === undefined ? all : all.filter((item) => item.revision > afterRevision)
  const page = windowed.slice(0, options.limit)
  const hasMore = windowed.length > options.limit
  return {
    limit: options.limit,
    nextCursor: hasMore ? String(page.at(-1)?.revision ?? '') : null,
    items: page,
  }
}

/** Opaque keyset cursor over the stable (createdAt, id) opportunity ordering. */
export interface OpportunityListCursor {
  readonly createdAt: string
  readonly id: string
}

export function encodeOpportunityCursor(cursor: OpportunityListCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id]), 'utf8').toString('base64url')
}

export function decodeOpportunityCursor(cursor: string): OpportunityListCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (
      Array.isArray(parsed)
      && parsed.length === 2
      && typeof parsed[0] === 'string'
      && typeof parsed[1] === 'string'
    ) {
      return { createdAt: parsed[0], id: parsed[1] }
    }
    return null
  } catch {
    return null
  }
}

/** Assemble an `OpportunityListResult` page from an already-ordered page plus the has-more flag. */
export function toOpportunityListResult(
  page: readonly Opportunity[],
  limit: number,
  hasMore: boolean,
): OpportunityListResult {
  const last = page.at(-1)
  return {
    limit,
    nextCursor: hasMore && last ? encodeOpportunityCursor({ createdAt: last.createdAt, id: last.id }) : null,
    items: [...page],
  }
}

export type { OpportunityListInput }
