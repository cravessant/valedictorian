import {
  compareIsoInstants,
  rawSourceRecordsListQuerySchema,
  rawSourceRecordsListResultSchema,
  type JsonValue,
  type RawSourceRecordSummary,
  type RawSourceRecordsListQuery,
  type RawSourceRecordsListResult,
} from 'sparxie'
import type { DrizzleDatabase } from '../../db/sqlite'
import { presentCapturedRawFacts } from './raw-captured-presentation'

const DEFAULT_LIMIT = 50

interface CursorValue {
  lastReceivedAt: string
  id: string
}

interface RawSummaryRow {
  rawRecordId: string
  sourceEntityId: string | null
  recordCreatedAt: string
  adapterId: string
  adapterKind: string
  adapterVersion: string
  originKind: string | null
  originName: string | null
  originProviderId: string | null
  providerRecordId: string | null
  revisionId: string
  revision: number
  revisionObservedAt: string
  revisionCreatedAt: string
  revisionCount: number
  observedTimesJson: string
  firstReceivedAt: string
  lastReceivedAt: string
  occurrenceCount: number
  connectorInstanceId: string | null
  latestConnectorRunId: string | null
  normalizationStatus: string
  normalizationUpdatedAt: string | null
  normalizationRawRevisionId: string | null
  gateStatus: string | null
  canonicalCandidateId: string | null
  payloadJson: string | null
  projectionStatus: string
  findingId: string | null
}

export function listRawSourceRecords(
  database: DrizzleDatabase,
  input: RawSourceRecordsListQuery = {},
): RawSourceRecordsListResult {
  const query = rawSourceRecordsListQuerySchema.parse(input)
  const cursor = query.cursor ? decodeCursor(query.cursor) : null
  const { parameters, where } = buildWhere(query, cursor)
  const limit = query.limit ?? DEFAULT_LIMIT
  parameters.push(limit + 1)
  const rows = database.$client.prepare(`${SUMMARY_QUERY}\n${where}\n${PAGE_QUERY}`)
    .all(...parameters) as unknown as RawSummaryRow[]
  const hasMore = rows.length > limit
  const items = rows.slice(0, limit).map(mapSummary)
  const nextCursor = hasMore ? encodeCursor(items.at(-1)!) : null

  return rawSourceRecordsListResultSchema.parse({ items, nextCursor })
}

function buildWhere(query: RawSourceRecordsListQuery, cursor: CursorValue | null) {
  const clauses: string[] = []
  const parameters: Array<string | number> = []
  const add = (clause: string, ...values: Array<string | number>) => {
    clauses.push(clause)
    parameters.push(...values)
  }

  if (query.adapterId !== undefined) add('adapter_id = ?', query.adapterId)
  if (query.adapterKind !== undefined) add('adapter_kind = ?', query.adapterKind)
  if (query.connectorInstanceId !== undefined) {
    add(`exists (
      select 1 from captures filtered_capture
      where filtered_capture.capture_lineage_id = eligible.capture_lineage_id
        and filtered_capture.connector_instance_id = ?
    )`, query.connectorInstanceId)
  }
  if (query.connectorRunId !== undefined) {
    add(`exists (
      select 1 from captures filtered_capture
      where filtered_capture.capture_lineage_id = eligible.capture_lineage_id
        and filtered_capture.connector_run_id = ?
    )`, query.connectorRunId)
  }
  if (query.receivedFrom !== undefined) add('last_received_at >= ?', receivedFromKey(query.receivedFrom))
  if (query.receivedTo !== undefined) add('last_received_at <= ?', receivedToKey(query.receivedTo))
  if (query.normalizationStatus !== undefined) {
    add('normalization_status = ?', query.normalizationStatus)
  }
  if (query.gateStatus !== undefined) add('gate_status = ?', query.gateStatus)
  if (query.projectionStatus !== undefined) add('projection_status = ?', query.projectionStatus)
  if (cursor) {
    add(
      '(last_received_at < ? or (last_received_at = ? and capture_lineage_id collate binary < ?))',
      cursor.lastReceivedAt,
      cursor.lastReceivedAt,
      cursor.id,
    )
  }

  return {
    parameters,
    where: clauses.length > 0 ? `where ${clauses.join('\n  and ')}` : '',
  }
}

const SUMMARY_QUERY = `
with latest_normalization as materialized (
  select
    normalization.*,
    row_number() over (
      partition by normalization.capture_evidence_version_id
      order by normalization.created_at desc, normalization.rowid desc
    ) as normalization_rank
  from normalization_runs normalization
), eligible as (
  select
    record.id as capture_lineage_id,
    record.job_id,
    record.created_at as record_created_at,
    revision.adapter_id,
    revision.adapter_kind,
    revision.adapter_version,
    revision.reported_origin_kind as origin_kind,
    revision.reported_origin_name as origin_name,
    revision.reported_origin_provider_id as origin_provider_id,
    revision.provider_record_id,
    revision.id as revision_id,
    revision.revision,
    revision.observed_at as revision_observed_at,
    revision.created_at as revision_created_at,
    (
      select max(received.received_at)
      from captures received
      where received.capture_lineage_id = record.id
    ) as last_received_at,
    coalesce(normalization.status, 'raw_only') as normalization_status,
    normalization.updated_at as normalization_updated_at,
    normalization.capture_evidence_version_id as normalization_capture_evidence_version_id,
    case
      when normalization.status in ('pending', 'in_progress', 'blocked') then null
      when normalization.status = 'failed' and gate.status <> 'failed' then null
      else gate.status
    end as gate_status,
    case when normalization.status = 'completed' and gate.status = 'passed'
      then candidate.id else null end as job_fact_version_id,
    revision.payload_json as payload_json,
    case when normalization.status = 'completed' and gate.status = 'passed'
      then coalesce(projection.status, 'not_eligible') else 'not_eligible'
    end as projection_status,
    case when projection.status = 'projected' then projection.opportunity_id else null end as opportunity_id
  from capture_lineages record
  join capture_evidence_versions revision on revision.capture_lineage_id = record.id
    and not exists (
      select 1 from capture_evidence_versions newer_revision
      where newer_revision.capture_lineage_id = record.id
        and newer_revision.revision > revision.revision
    )
  left join latest_normalization normalization
    on normalization.capture_evidence_version_id = revision.id and normalization.normalization_rank = 1
  left join normalization_gates gate on gate.run_id = normalization.id
  left join job_fact_versions candidate on candidate.run_id = normalization.id
  left join sourcing_projection_outcomes projection
    on projection.job_fact_version_id = candidate.id
), page as (
select * from eligible`

const PAGE_QUERY = `
order by last_received_at desc, capture_lineage_id collate binary desc
limit ?
)
select
  page.capture_lineage_id as "rawRecordId",
  page.job_id as "sourceEntityId",
  page.record_created_at as "recordCreatedAt",
  page.adapter_id as "adapterId",
  page.adapter_kind as "adapterKind",
  page.adapter_version as "adapterVersion",
  page.origin_kind as "originKind",
  page.origin_name as "originName",
  page.origin_provider_id as "originProviderId",
  page.provider_record_id as "providerRecordId",
  page.revision_id as "revisionId",
  page.revision,
  page.revision_observed_at as "revisionObservedAt",
  page.revision_created_at as "revisionCreatedAt",
  (
    select count(*) from capture_evidence_versions counted_revision
    where counted_revision.capture_lineage_id = page.capture_lineage_id
  ) as "revisionCount",
  (
    select json_group_array(observed.observed_at)
    from captures observed
    where observed.capture_lineage_id = page.capture_lineage_id
  ) as "observedTimesJson",
  (
    select min(received.received_at)
    from captures received
    where received.capture_lineage_id = page.capture_lineage_id
  ) as "firstReceivedAt",
  page.last_received_at as "lastReceivedAt",
  (
    select count(*) from captures counted_capture
    where counted_capture.capture_lineage_id = page.capture_lineage_id
  ) as "occurrenceCount",
  latest_occurrence.connector_instance_id as "connectorInstanceId",
  latest_occurrence.connector_run_id as "latestConnectorRunId",
  page.normalization_status as "normalizationStatus",
  page.normalization_updated_at as "normalizationUpdatedAt",
  page.normalization_capture_evidence_version_id as "normalizationRawRevisionId",
  page.gate_status as "gateStatus",
  page.job_fact_version_id as "canonicalCandidateId",
  page.payload_json as "payloadJson",
  page.projection_status as "projectionStatus",
  page.opportunity_id as "findingId"
from page
left join captures latest_occurrence on latest_occurrence.id = (
  select selected_occurrence.id
  from captures selected_occurrence
  where selected_occurrence.capture_lineage_id = page.capture_lineage_id
  order by selected_occurrence.received_at desc, selected_occurrence.id collate binary desc
  limit 1
)
order by page.last_received_at desc, page.capture_lineage_id collate binary desc`

function mapSummary(row: RawSummaryRow): RawSourceRecordSummary {
  const observedTimes = JSON.parse(row.observedTimesJson) as string[]
  if (observedTimes.length === 0) throw new Error('Raw source record is missing its occurrence')
  const firstObservedAt = observedTimes.reduce((first, value) =>
    compareIsoInstants(first, value) <= 0 ? first : value)
  const lastObservedAt = observedTimes.reduce((last, value) =>
    compareIsoInstants(last, value) >= 0 ? last : value)
  const captured = presentCapturedRawFacts(parsePayloadJson(row.payloadJson))
  const base = {
    id: row.rawRecordId,
    sourceEntityId: row.sourceEntityId,
    adapter: { id: row.adapterId, kind: row.adapterKind, version: row.adapterVersion },
    reportedOrigin: row.originKind && row.originName
      ? { kind: row.originKind, name: row.originName, providerId: row.originProviderId }
      : null,
    providerRecordId: row.providerRecordId,
    companyName: captured.company,
    roleTitle: captured.title,
    createdAt: row.recordCreatedAt,
    firstObservedAt,
    lastObservedAt,
    firstReceivedAt: row.firstReceivedAt,
    lastReceivedAt: row.lastReceivedAt,
    occurrenceCount: row.occurrenceCount,
    revisionCount: row.revisionCount,
    latestRevision: {
      id: row.revisionId,
      revision: row.revision,
      observedAt: row.revisionObservedAt,
      createdAt: row.revisionCreatedAt,
    },
    normalizationStatus: row.normalizationStatus,
    normalizationUpdatedAt: row.normalizationUpdatedAt,
    normalizationRawRevisionId: row.normalizationRawRevisionId,
    gateStatus: row.gateStatus,
    canonicalCandidateId: row.canonicalCandidateId,
    projectionStatus: row.projectionStatus,
    findingId: row.findingId,
  }

  if (row.adapterKind === 'connector') {
    return {
      ...base,
      adapter: { ...base.adapter, kind: 'connector' },
      connectorInstanceId: row.connectorInstanceId,
      latestConnectorRunId: row.latestConnectorRunId,
    } as RawSourceRecordSummary
  }
  return {
    ...base,
    adapter: { ...base.adapter, kind: row.adapterKind as 'cli' | 'manual' | 'import' },
    connectorInstanceId: null,
    latestConnectorRunId: null,
  } as RawSourceRecordSummary
}

function parsePayloadJson(payloadJson: string | null): JsonValue | null {
  if (payloadJson === null) return null
  try {
    return JSON.parse(payloadJson) as JsonValue
  } catch {
    return null
  }
}

function receivedFromKey(value: string) {
  const instant = new Date(value)
  const milliseconds = instant.toISOString()
  return compareIsoInstants(milliseconds, value) < 0
    ? new Date(instant.getTime() + 1).toISOString()
    : milliseconds
}

function receivedToKey(value: string) {
  const instant = new Date(value)
  const milliseconds = instant.toISOString()
  return compareIsoInstants(milliseconds, value) > 0
    ? new Date(instant.getTime() - 1).toISOString()
    : milliseconds
}

function encodeCursor(value: CursorValue) {
  return Buffer.from(JSON.stringify({ v: 1, r: value.lastReceivedAt, i: value.id }))
    .toString('base64url')
}

function decodeCursor(cursor: string): CursorValue {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error()
    const value = decoded as Record<string, unknown>
    if (
      Object.keys(value).sort().join(',') !== 'i,r,v'
      || value.v !== 1
      || typeof value.r !== 'string'
      || !rawSourceRecordsListQuerySchema.safeParse({ receivedFrom: value.r }).success
      || typeof value.i !== 'string'
      || value.i.length === 0
      || !isWellFormedUnicode(value.i)
    ) throw new Error()
    if (encodeCursor({ lastReceivedAt: value.r, id: value.i }) !== cursor) throw new Error()
    return { lastReceivedAt: value.r, id: value.i }
  } catch {
    throw Object.assign(new Error('Invalid raw source records cursor'), { statusCode: 400 })
  }
}

function isWellFormedUnicode(value: string) {
  return (value as string & { isWellFormed(): boolean }).isWellFormed()
}
