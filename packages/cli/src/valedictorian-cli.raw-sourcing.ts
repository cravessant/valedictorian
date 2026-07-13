import {
  batchRawSourceRecordsInputSchema,
  isReportedOriginKind,
  ValedictorianHttpError,
  type BatchRawSourceRecordsResult,
  type JsonObject,
  type RawSourceRecordInput,
  type ReportedSourceOrigin,
  type ValedictorianWorkspaceClient,
} from 'sparxie'
import { assertKnownOptions, readOption, readRequiredOption } from './valedictorian-cli.parser-options.js'

const allowedOptions = [
  '--batch-json', '--json', '--observed-at', '--origin-kind', '--origin-name',
  '--origin-provider-id', '--origin-url', '--payload-json', '--provider-record-id',
  '--provider-schema', '--url',
]

type IntakeRecord = Omit<RawSourceRecordInput, 'adapter' | 'capture' | 'intakeItemId'>

export function parseRawSourcingIntake(argv: string[], adapterVersion: string): RawSourceRecordInput[] {
  assertKnownOptions(argv, allowedOptions)
  const batchJson = readOption(argv, '--batch-json')
  const adapter = { id: 'valedictorian-cli', kind: 'cli' as const, version: adapterVersion }

  if (batchJson !== undefined) {
    if (argv.some((token) => token !== '--json' && token !== '--batch-json' && token !== batchJson)) {
      throw new Error('--batch-json cannot be combined with single-record options')
    }

    const parsed = JSON.parse(batchJson) as unknown

    if (!Array.isArray(parsed)) {
      throw new Error('--batch-json must be a JSON array')
    }

    for (const [index, item] of parsed.entries()) {
      if (!isRecord(item)) throw new Error(`Batch record ${index} must be a JSON object`)
      if ('adapter' in item || 'capture' in item || 'intakeItemId' in item) {
        throw new Error(`Batch record ${index} cannot supply adapter, capture, or intake identity`)
      }
    }

    return validateBatch(parsed.map((record, index) => ({
      ...(record as IntakeRecord),
      intakeItemId: `cli-intake-${index + 1}`,
      adapter,
    })))
  }

  const url = validateSourceUrl(readRequiredOption(argv, '--url'))
  const payloadJson = readOption(argv, '--payload-json')
  const payload = payloadJson === undefined ? {} : parseJsonObject(payloadJson, '--payload-json')
  payload.url = url
  const record: RawSourceRecordInput = {
    intakeItemId: 'cli-intake-1',
    adapter,
    observedAt: readOption(argv, '--observed-at') ?? new Date().toISOString(),
    payload,
  }
  const providerRecordId = readOption(argv, '--provider-record-id')
  const providerSchema = readOption(argv, '--provider-schema')
  if (providerRecordId !== undefined) record.providerRecordId = providerRecordId
  if (providerSchema !== undefined) record.providerSchema = providerSchema
  const reportedOrigin = parseReportedOrigin(argv)
  if (reportedOrigin) record.reportedOrigin = reportedOrigin
  return validateBatch([record])
}

export async function ingestRawSourcing(
  client: ValedictorianWorkspaceClient,
  records: RawSourceRecordInput[],
) {
  const intake = await ingestCorrelatedBatch(client, records)
  const receipts = []
  let inspectionFailureCount = 0
  const correlated = correlateReceipts(records, intake.receipts)

  for (const { receipt, submitted } of correlated) {
    const normalization = await inspect('normalization', () =>
      client.sourcing.rawRecords.normalization.get(receipt.rawRecordId),
    )
    const projection = await inspect('projection', () =>
      client.sourcing.rawRevisions.projection.get(receipt.revision.id),
    )
    if (normalization.result === null) inspectionFailureCount += 1
    if (projection.result === null) inspectionFailureCount += 1
    receipts.push({
      submitted: {
        adapter: submitted.adapter,
        reportedOrigin: submitted.reportedOrigin ?? null,
      },
      intake: receipt,
      normalization: normalization.result === null ? normalization : {
        matchesRevision: normalization.result.rawRevisionId === receipt.revision.id,
        requestedRawRevisionId: receipt.revision.id,
        result: normalization.result,
      },
      projection,
    })
  }

  return { inspectionFailureCount, receipts }
}

async function ingestCorrelatedBatch(
  client: ValedictorianWorkspaceClient,
  records: RawSourceRecordInput[],
) {
  try {
    return await client.sourcing.rawRecords.ingestBatch({ records })
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') throw correlationError()
    throw error
  }
}

function correlateReceipts(
  records: RawSourceRecordInput[],
  receipts: BatchRawSourceRecordsResult['receipts'],
) {
  const submittedById = new Map<string, RawSourceRecordInput>()
  for (const record of records) {
    if (submittedById.has(record.intakeItemId)) throw correlationError()
    submittedById.set(record.intakeItemId, record)
  }

  const correlated = receipts.map((receipt) => {
    const submitted = submittedById.get(receipt.intakeItemId)
    if (!submitted) throw correlationError()
    submittedById.delete(receipt.intakeItemId)
    return { receipt, submitted }
  })

  if (submittedById.size > 0) throw correlationError()
  return correlated
}

function correlationError() {
  return new Error('Raw sourcing receipt correlation failed')
}

async function inspect<T>(stage: 'normalization' | 'projection', lookup: () => Promise<T>) {
  try {
    return { result: await lookup() }
  } catch (error) {
    return { result: null, error: safeInspectionError(stage, error) }
  }
}

function safeInspectionError(stage: 'normalization' | 'projection', error: unknown) {
  if (error instanceof ValedictorianHttpError) {
    return { stage, code: 'http_error', httpStatus: error.status }
  }
  if (error instanceof Error && error.name === 'ZodError') {
    return { stage, code: 'invalid_response' }
  }
  return { stage, code: 'transport_error' }
}

function parseReportedOrigin(argv: string[]): ReportedSourceOrigin | undefined {
  const kind = readOption(argv, '--origin-kind')
  const name = readOption(argv, '--origin-name')
  const providerId = readOption(argv, '--origin-provider-id')
  const url = readOption(argv, '--origin-url')
  if (kind === undefined && name === undefined && providerId === undefined && url === undefined) return
  if (kind === undefined || !isReportedOriginKind(kind)) {
    throw new Error('Invalid or missing --origin-kind; expected employer, ats, job_board, aggregator, referral, or other')
  }
  if (!name) throw new Error('--origin-name is required when reporting an origin')
  return { kind, name, ...(providerId ? { providerId } : {}), ...(url ? { url } : {}) }
}

function validateBatch(records: RawSourceRecordInput[]) {
  const result = batchRawSourceRecordsInputSchema.safeParse({ records })
  if (!result.success) throw new Error(`Invalid raw sourcing batch: ${result.error.message}`)
  return records
}

function parseJsonObject(text: string, option: string): JsonObject {
  const parsed = JSON.parse(text) as unknown
  if (!isRecord(parsed)) throw new Error(`${option} must be a JSON object`)
  return parsed as JsonObject
}

function validateSourceUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
    return value
  } catch {
    throw new Error('--url must be an absolute HTTP or HTTPS URL')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
