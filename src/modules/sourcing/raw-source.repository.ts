import crypto from 'node:crypto'
import { and, asc, desc, eq } from 'drizzle-orm'
import {
  isReportedOriginKind,
  isSourceAdapterKind,
  MAX_RAW_SOURCE_BATCH_RECORDS,
  MAX_RAW_SOURCE_EVIDENCE_ITEMS,
  MAX_RAW_SOURCE_EVIDENCE_VALUE_BYTES,
  MAX_RAW_SOURCE_PAYLOAD_BYTES,
  type BatchRawSourceRecordsInput,
  type BatchRawSourceRecordsResult,
  type ConnectorCaptureReference,
  type JsonObject,
  type JsonValue,
  type RawSourceEvidenceInput,
  type RawSourceIntakeReceipt,
  type RawSourceRecord,
  type RawSourceRecordInput,
  type RawSourceRecordsListQuery,
  type RawSourceRecordsListResult,
  type RawSourceRevision,
  type ReportedSourceOrigin,
  type SourceAdapterProvenance,
} from 'sparxie'
import {
  captures,
  captureLineages,
  captureEvidenceVersions,
  jobs,
} from '../../db/schema'
import { insertCaptureEvidenceVersions, insertCaptureLineages, insertCaptures } from '../capture/capture.repository'
import { insertJobIdentities, insertJobs } from '../job/job.repository'
import type { PgliteDatabase } from '../../db/pglite'
import { listRawSourceRecords } from './raw-source-list.repository'

export type RawSourceTransaction = Parameters<Parameters<PgliteDatabase['transaction']>[0]>[0]

export interface RawSourceIngestOptions {
  stage?: (transaction: RawSourceTransaction, input: {
    records: readonly RawSourceRecordInput[]
    receipts: readonly RawSourceIntakeReceipt[]
  }) => void | Promise<void>
}

const PROVIDER_JOB_IDENTITY_KIND = 'provider_job'
const forbiddenKeyNames = new Set(
  [
    'authorization',
    'authentication',
    'auth-token',
    'headers',
    'cookie',
    'cookies',
    'set-cookie',
    'password',
    'passwd',
    'proxy-authentication',
    'proxy-authorization',
    'credential',
    'credentials',
    'token',
    'access-token',
    'refresh-token',
    'api-token',
    'api-key',
    'secret',
    'client-secret',
    'session',
    'session-id',
  ].map(normalizeKeyName),
)

export interface RawSourceRepository {
  ingestBatch(input: BatchRawSourceRecordsInput, options?: RawSourceIngestOptions): Promise<BatchRawSourceRecordsResult>
  list(query?: RawSourceRecordsListQuery): Promise<RawSourceRecordsListResult>
  get(rawRecordId: string): Promise<RawSourceRecord | null>
}

export function createPgliteRawSourceRepository(
  database: PgliteDatabase,
  now: () => Date = () => new Date(),
): RawSourceRepository {
  return {
    async list(query) {
      return listRawSourceRecords(database, query)
    },

    async ingestBatch(input, options) {
      const records = validateRawSourceBatchInput(input)
      const receivedAt = now().toISOString()

      return await database.transaction(async (transaction) => {
        const receipts: RawSourceIntakeReceipt[] = []
        for (const record of records) {
          receipts.push(await ingestRecord(transaction, record, receivedAt))
        }
        await options?.stage?.(transaction, { records, receipts })
        return { receipts }
      })
    },

    async get(rawRecordId) {
      const [rawRecord] = await database
        .select()
        .from(captureLineages)
        .where(eq(captureLineages.id, rawRecordId))
        .limit(1)

      if (!rawRecord) {
        return null
      }

      const [latestRevision] = await database
        .select()
        .from(captureEvidenceVersions)
        .where(eq(captureEvidenceVersions.captureLineageId, rawRecordId))
        .orderBy(desc(captureEvidenceVersions.revision))
        .limit(1)

      if (!latestRevision) {
        throw new Error('Raw source record is missing its revision')
      }

      const occurrences = await database
        .select()
        .from(captures)
        .where(eq(captures.captureLineageId, rawRecordId))
        .orderBy(
          asc(captures.observedAt),
          asc(captures.receivedAt),
          asc(captures.id),
        )

      const revision = mapRevision(latestRevision)

      return {
        id: rawRecord.id,
        sourceEntityId: rawRecord.jobId,
        adapter: revision.adapter,
        reportedOrigin: revision.reportedOrigin,
        createdAt: rawRecord.createdAt,
        latestRevision: revision,
        occurrences: occurrences.map(mapOccurrence),
      }
    },
  }
}

async function ingestRecord(
  database: RawSourceTransaction,
  record: RawSourceRecordInput,
  receivedAt: string,
): Promise<RawSourceIntakeReceipt> {
  const strongIdentity =
    record.adapter.kind === 'connector' &&
    typeof record.providerRecordId === 'string' &&
    record.providerRecordId.trim().length > 0
  let sourceEntityId: string | null = null
  let rawRecordId: string | null = null
  let capturedIdentity: { namespace: string; value: string } | null = null

  if (strongIdentity) {
    const identityValue = (record.providerRecordId as string).trim()
    const identityNamespace = providerIdentityNamespace(
      record.adapter.id,
      record.providerSchema ?? null,
    )
    const proposedEntityId = crypto.randomUUID()
    const [insertedEntity] = await insertJobs(database).values({
      id: proposedEntityId,
      identityKind: PROVIDER_JOB_IDENTITY_KIND,
      identityNamespace,
      identityValue,
      createdAt: receivedAt,
    }).onConflictDoNothing({
      target: [jobs.identityKind, jobs.identityNamespace, jobs.identityValue],
    }).returning()
    const [sourceEntity] = insertedEntity ? [insertedEntity] : await database
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.identityKind, PROVIDER_JOB_IDENTITY_KIND),
          eq(jobs.identityNamespace, identityNamespace),
          eq(jobs.identityValue, identityValue),
        ),
      )
      .limit(1)

    if (!sourceEntity) {
      throw new Error('Raw source identity could not be reconciled')
    }
    sourceEntityId = sourceEntity.id
    if (insertedEntity) {
      capturedIdentity = { namespace: identityNamespace, value: identityValue }
    }

    const proposedRawRecordId = crypto.randomUUID()
    const [insertedRawRecord] = await insertCaptureLineages(database).values({
      id: proposedRawRecordId,
      jobId: sourceEntityId,
      createdAt: receivedAt,
    }).onConflictDoNothing({ target: captureLineages.jobId }).returning({
      id: captureLineages.id,
    })
    const [rawRecord] = insertedRawRecord ? [insertedRawRecord] : await database
      .select({ id: captureLineages.id })
      .from(captureLineages)
      .where(eq(captureLineages.jobId, sourceEntityId))
      .limit(1)

    if (!rawRecord) {
      throw new Error('Raw source record could not be reconciled')
    }
    rawRecordId = rawRecord.id
  }

  if (!rawRecordId) {
    rawRecordId = crypto.randomUUID()
    const [rawRecord] = await insertCaptureLineages(database).values({
      id: rawRecordId,
      jobId: sourceEntityId,
      createdAt: receivedAt,
    }).returning({ id: captureLineages.id })
    if (!rawRecord) {
      throw new Error('Raw source record could not be created')
    }
  }

  await database
    .select({ id: captureLineages.id })
    .from(captureLineages)
    .where(eq(captureLineages.id, rawRecordId))
    .for('update')

  const contentHash = hashRawSourceContent(record)
  const [existingRevision] = await database
    .select()
    .from(captureEvidenceVersions)
    .where(
      and(
        eq(captureEvidenceVersions.captureLineageId, rawRecordId),
        eq(captureEvidenceVersions.contentHash, contentHash),
      ),
    )
    .limit(1)
  let revision = existingRevision
  let reused = Boolean(existingRevision)

  if (!revision) {
    const [latest] = await database
      .select({ revision: captureEvidenceVersions.revision })
      .from(captureEvidenceVersions)
      .where(eq(captureEvidenceVersions.captureLineageId, rawRecordId))
      .orderBy(desc(captureEvidenceVersions.revision))
      .limit(1)
    const revisionNumber = (latest?.revision ?? 0) + 1
    const revisionId = crypto.randomUUID()
    const origin = record.reportedOrigin ?? null

    const [insertedRevision] = await insertCaptureEvidenceVersions(database).values({
      id: revisionId,
      captureLineageId: rawRecordId,
      revision: revisionNumber,
      contentHash,
      adapterId: record.adapter.id,
      adapterKind: record.adapter.kind,
      adapterVersion: record.adapter.version,
      reportedOriginKind: origin?.kind ?? null,
      reportedOriginName: origin?.name ?? null,
      reportedOriginProviderId: origin?.providerId ?? null,
      reportedOriginUrl: origin?.url ?? null,
      observedAt: record.observedAt,
      providerRecordId: record.providerRecordId ?? null,
      providerSchema: record.providerSchema ?? null,
      payloadJson: record.payload === undefined || record.payload === null
        ? null
        : JSON.stringify(record.payload),
      evidenceJson: JSON.stringify(record.evidence ?? []),
      createdAt: receivedAt,
    }).onConflictDoNothing({
      target: [
        captureEvidenceVersions.captureLineageId,
        captureEvidenceVersions.contentHash,
      ],
    }).returning()
    revision = insertedRevision

    if (!revision) {
      const [reconciledRevision] = await database
        .select()
        .from(captureEvidenceVersions)
        .where(
          and(
            eq(captureEvidenceVersions.captureLineageId, rawRecordId),
            eq(captureEvidenceVersions.contentHash, contentHash),
          ),
        )
        .limit(1)
      revision = reconciledRevision
      reused = Boolean(reconciledRevision)
    }
  }

  if (!revision) {
    throw new Error('Raw source revision could not be created')
  }

  if (sourceEntityId && capturedIdentity) {
    await insertJobIdentities(database).values({
      id: crypto.randomUUID(),
      jobId: sourceEntityId,
      identityKind: PROVIDER_JOB_IDENTITY_KIND,
      identityNamespace: capturedIdentity.namespace,
      identityValue: capturedIdentity.value,
      provenanceKind: 'capture',
      provenanceVersion: 'raw-source-capture/v1',
      evidenceJson: JSON.stringify({
        adapterId: record.adapter.id,
        adapterVersion: record.adapter.version,
        providerSchema: record.providerSchema ?? null,
      }),
      captureEvidenceVersionId: revision.id,
      createdAt: receivedAt,
    })
  }

  const occurrence = {
    id: crypto.randomUUID(),
    captureLineageId: rawRecordId,
    captureEvidenceVersionId: revision.id,
    connectorInstanceId: record.capture?.connectorInstanceId ?? null,
    connectorRunId: record.capture?.connectorRunId ?? null,
    executionScopeId: record.capture?.executionScopeId ?? null,
    observedAt: record.observedAt,
    receivedAt,
  }
  await insertCaptures(database).values(occurrence)

  return {
    intakeItemId: record.intakeItemId ?? crypto.randomUUID(),
    rawRecordId,
    sourceEntityId,
    revision: {
      id: revision.id,
      rawRecordId,
      revision: revision.revision,
      contentHash: revision.contentHash,
      reused,
      createdAt: revision.createdAt,
    },
    occurrence: mapOccurrence(occurrence),
  }
}

export function hashRawSourceContent(record: RawSourceRecordInput) {
  const canonicalContent = canonicalJson({
    adapter: {
      id: record.adapter.id,
      kind: record.adapter.kind,
      version: record.adapter.version,
    },
    evidence: record.evidence ?? [],
    payload: record.payload ?? null,
    providerRecordId: record.providerRecordId ?? null,
    providerSchema: record.providerSchema ?? null,
    reportedOrigin: record.reportedOrigin
      ? {
          kind: record.reportedOrigin.kind,
          name: record.reportedOrigin.name,
          providerId: record.reportedOrigin.providerId ?? null,
          url: record.reportedOrigin.url ?? null,
        }
      : null,
  })

  return `sha256:${crypto.createHash('sha256').update(canonicalContent).digest('hex')}`
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Raw source JSON values must contain only finite numbers')
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  throw new Error('Raw source values must be JSON-safe')
}

export function validateRawSourceBatchInput(input: BatchRawSourceRecordsInput) {
  assertNoSensitiveKeys(input, 'raw source batch')

  if (!input || typeof input !== 'object' || !Array.isArray(input.records)) {
    throw validationError('records must be an array')
  }
  assertKnownKeys(input, ['records'], 'raw source batch')
  if (input.records.length === 0) {
    throw validationError('records must not be empty')
  }
  if (input.records.length > MAX_RAW_SOURCE_BATCH_RECORDS) {
    throw validationError(`records must contain at most ${MAX_RAW_SOURCE_BATCH_RECORDS} items`)
  }

  input.records.forEach((record, index) => validateRecord(record, index))
  return input.records
}

function validateRecord(record: RawSourceRecordInput, index: number) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw validationError(`records[${index}] must be an object`)
  }
  assertNoCredentialBearingHttpUrls(record, `records[${index}]`)
  assertKnownKeys(
    record,
    [
      'intakeItemId',
      'adapter',
      'capture',
      'observedAt',
      'reportedOrigin',
      'providerRecordId',
      'providerSchema',
      'payload',
      'evidence',
    ],
    `records[${index}]`,
  )
  if (record.intakeItemId !== undefined) {
    validateRequiredText(record.intakeItemId, `records[${index}].intakeItemId`, 256)
  }
  validateAdapter(record.adapter, index)
  validateCapture(record.capture, record.adapter.kind, index)
  validateTimestamp(record.observedAt, index)
  validateOptionalText(record.providerRecordId, `records[${index}].providerRecordId`, 2048)
  validateOptionalText(record.providerSchema, `records[${index}].providerSchema`, 2048)

  if (record.payload !== undefined && record.payload !== null) {
    validateJsonValue(record.payload, `records[${index}].payload`)
    if (Array.isArray(record.payload)) {
      throw validationError(`records[${index}].payload must be an object`)
    }
    assertJsonByteLimit(record.payload, MAX_RAW_SOURCE_PAYLOAD_BYTES, `records[${index}].payload`)
  }

  if (record.reportedOrigin !== undefined && record.reportedOrigin !== null) {
    validateReportedOrigin(record.reportedOrigin, index)
  }

  if (record.evidence !== undefined) {
    if (!Array.isArray(record.evidence)) {
      throw validationError(`records[${index}].evidence must be an array`)
    }
    if (record.evidence.length > MAX_RAW_SOURCE_EVIDENCE_ITEMS) {
      throw validationError(
        `records[${index}].evidence must contain at most ${MAX_RAW_SOURCE_EVIDENCE_ITEMS} items`,
      )
    }
    record.evidence.forEach((evidence, evidenceIndex) =>
      validateEvidence(evidence, index, evidenceIndex),
    )
  }
}

function validateCapture(
  capture: ConnectorCaptureReference | undefined,
  adapterKind: SourceAdapterProvenance['kind'],
  index: number,
) {
  if (capture === undefined) {
    if (adapterKind === 'connector') {
      throw validationError(`records[${index}].capture is required for a connector adapter`)
    }
    return
  }
  if (adapterKind !== 'connector') {
    throw validationError(`records[${index}].capture requires a connector adapter`)
  }
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)) {
    throw validationError(`records[${index}].capture must be an object`)
  }
  assertKnownKeys(
    capture,
    ['connectorInstanceId', 'connectorRunId', 'executionScopeId'],
    `records[${index}].capture`,
  )
  validateRequiredText(
    capture.connectorInstanceId,
    `records[${index}].capture.connectorInstanceId`,
    256,
  )
  validateRequiredText(
    capture.connectorRunId,
    `records[${index}].capture.connectorRunId`,
    256,
  )
  validateRequiredText(
    capture.executionScopeId,
    `records[${index}].capture.executionScopeId`,
    256,
  )
}

function mapOccurrence(row: typeof captures.$inferSelect) {
  return {
    id: row.id,
    rawRecordId: row.captureLineageId,
    rawRevisionId: row.captureEvidenceVersionId,
    capture: row.connectorInstanceId && row.connectorRunId
      ? {
          connectorInstanceId: row.connectorInstanceId,
          connectorRunId: row.connectorRunId,
          executionScopeId: row.executionScopeId ?? (() => { throw new Error('Connector capture is missing execution scope identity') })(),
        }
      : null,
    observedAt: row.observedAt,
    receivedAt: row.receivedAt,
  }
}

function validateAdapter(adapter: SourceAdapterProvenance, index: number) {
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)) {
    throw validationError(`records[${index}].adapter must be an object`)
  }
  assertKnownKeys(adapter, ['id', 'kind', 'version'], `records[${index}].adapter`)
  validateRequiredText(adapter.id, `records[${index}].adapter.id`, 256)
  validateRequiredText(adapter.version, `records[${index}].adapter.version`, 256)
  if (typeof adapter.kind !== 'string' || !isSourceAdapterKind(adapter.kind)) {
    throw validationError(`records[${index}].adapter.kind is invalid`)
  }
}

function validateTimestamp(value: unknown, index: number) {
  const timestamp = typeof value === 'string' ? value : null
  const match = timestamp
    ? timestamp.match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/,
      )
    : null

  if (
    !match ||
    timestamp === null ||
    timestamp.length > 64 ||
    Number.isNaN(Date.parse(timestamp)) ||
    !validTimestampParts(match)
  ) {
    throw validationError(`records[${index}].observedAt is invalid`)
  }
}

function validTimestampParts(match: RegExpMatchArray) {
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = Number(match[7] ?? 0)
  const offsetMinute = Number(match[8] ?? 0)
  const daysInMonth = month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0

  return day >= 1 && day <= daysInMonth && hour <= 23 && minute <= 59 && second <= 59 &&
    offsetHour <= 23 && offsetMinute <= 59
}

function validateReportedOrigin(origin: ReportedSourceOrigin, index: number) {
  if (!origin || typeof origin !== 'object' || Array.isArray(origin)) {
    throw validationError(`records[${index}].reportedOrigin must be an object`)
  }
  assertKnownKeys(
    origin,
    ['kind', 'name', 'providerId', 'url'],
    `records[${index}].reportedOrigin`,
  )
  if (typeof origin.kind !== 'string' || !isReportedOriginKind(origin.kind)) {
    throw validationError(`records[${index}].reportedOrigin.kind is invalid`)
  }
  validateRequiredText(origin.name, `records[${index}].reportedOrigin.name`, 1024)
  validateOptionalText(origin.providerId, `records[${index}].reportedOrigin.providerId`, 2048)
  validateOptionalText(origin.url, `records[${index}].reportedOrigin.url`, 8192)
}

function validateEvidence(evidence: RawSourceEvidenceInput, recordIndex: number, index: number) {
  const field = `records[${recordIndex}].evidence[${index}]`
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw validationError(`${field} must be an object`)
  }
  assertKnownKeys(evidence, ['kind', 'label', 'value'], field)
  validateRequiredText(evidence.kind, `${field}.kind`, 256)
  validateRequiredText(evidence.label, `${field}.label`, 1024)
  validateJsonValue(evidence.value, `${field}.value`)
  assertJsonByteLimit(evidence.value, MAX_RAW_SOURCE_EVIDENCE_VALUE_BYTES, `${field}.value`)
}

function validateJsonValue(value: unknown, field: string, ancestors = new Set<object>()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw validationError(`${field} must contain only finite numbers`)
    }
    return
  }
  if (!value || typeof value !== 'object') {
    throw validationError(`${field} must be JSON-safe`)
  }
  if (ancestors.has(value)) {
    throw validationError(`${field} must not contain circular values`)
  }
  ancestors.add(value)

  if (Array.isArray(value)) {
    value.forEach((item) => validateJsonValue(item, field, ancestors))
  } else {
    const prototype = Object.getPrototypeOf(value)

    if (
      (prototype !== Object.prototype && prototype !== null) ||
      Object.getOwnPropertySymbols(value).length > 0
    ) {
      throw validationError(`${field} must contain only JSON objects`)
    }
    for (const [key, item] of Object.entries(value)) {
      if (isForbiddenSensitiveKey(key)) {
        throw validationError(`${field} contains a forbidden sensitive key`)
      }
      validateJsonValue(item, field, ancestors)
    }
  }
  ancestors.delete(value)
}

function assertJsonByteLimit(value: JsonObject | JsonValue, limit: number, field: string) {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > limit) {
    throw validationError(`${field} exceeds ${limit} JSON bytes`)
  }
}

function validateRequiredText(value: unknown, field: string, maximum: number) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw validationError(`${field} must be non-empty and at most ${maximum} characters`)
  }
}

function validateOptionalText(value: unknown, field: string, maximum: number) {
  if (value === undefined || value === null) {
    return
  }
  if (typeof value !== 'string' || value.length > maximum) {
    throw validationError(`${field} must be at most ${maximum} characters`)
  }
}

function assertNoCredentialBearingHttpUrls(
  value: unknown,
  field: string,
  ancestors = new Set<object>(),
) {
  if (typeof value === 'string') {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return
    }
    if ((url.protocol === 'http:' || url.protocol === 'https:') && (url.username || url.password)) {
      throw validationError(`${field} contains a credential-bearing HTTP URL`)
    }
    return
  }
  if (!value || typeof value !== 'object' || ancestors.has(value)) return
  ancestors.add(value)
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    assertNoCredentialBearingHttpUrls(child, field, ancestors)
  }
  ancestors.delete(value)
}

function assertNoSensitiveKeys(
  value: unknown,
  field: string,
  ancestors = new Set<object>(),
) {
  if (!value || typeof value !== 'object') {
    return
  }
  if (ancestors.has(value)) {
    throw validationError(`${field} must not contain circular values`)
  }
  ancestors.add(value)

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'string' && isForbiddenSensitiveKey(key)) {
      throw validationError(`${field} contains a forbidden sensitive key`)
    }
    assertNoSensitiveKeys(Reflect.get(value, key), field, ancestors)
  }

  ancestors.delete(value)
}

function assertKnownKeys(value: object, allowedKeys: readonly string[], field: string) {
  const allowed = new Set(allowedKeys)

  if (
    Reflect.ownKeys(value).some(
      (key) => typeof key !== 'string' || !allowed.has(key),
    )
  ) {
    throw validationError(`${field} contains an unsupported property`)
  }
}

function isForbiddenSensitiveKey(value: string) {
  const normalized = normalizeKeyName(value)

  return forbiddenKeyNames.has(normalized) ||
    (normalized.startsWith('x') && forbiddenKeyNames.has(normalized.slice(1)))
}

function normalizeKeyName(value: string) {
  return value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]/g, '')
}

function providerIdentityNamespace(adapterId: string, providerSchema: string | null) {
  const adapterNamespace = `adapter:${adapterId.length}:${adapterId}`
  const schemaNamespace = providerSchema === null
    ? 'schema:null'
    : `schema:value:${providerSchema.length}:${providerSchema}`

  return `${adapterNamespace}|${schemaNamespace}`
}

function mapRevision(row: typeof captureEvidenceVersions.$inferSelect): RawSourceRevision {
  return {
    id: row.id,
    rawRecordId: row.captureLineageId,
    revision: row.revision,
    contentHash: row.contentHash,
    adapter: {
      id: row.adapterId,
      kind: row.adapterKind as SourceAdapterProvenance['kind'],
      version: row.adapterVersion,
    },
    reportedOrigin: row.reportedOriginKind && row.reportedOriginName
      ? {
          kind: row.reportedOriginKind as ReportedSourceOrigin['kind'],
          name: row.reportedOriginName,
          providerId: row.reportedOriginProviderId,
          url: row.reportedOriginUrl,
        }
      : null,
    observedAt: row.observedAt,
    providerRecordId: row.providerRecordId,
    providerSchema: row.providerSchema,
    payload: row.payloadJson === null ? null : JSON.parse(row.payloadJson) as JsonObject,
    evidence: JSON.parse(row.evidenceJson) as RawSourceEvidenceInput[],
    createdAt: row.createdAt,
  }
}

function validationError(message: string) {
  return Object.assign(new Error(message), { statusCode: 400 })
}
