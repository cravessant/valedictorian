import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
} from 'drizzle-orm'
import {
  captureResolutionListInputSchema,
  captureResolutionListResultSchema,
  type CaptureResolutionListInput,
  type CaptureResolutionListResult,
  type ValedictorianWorkspaceClient,
} from '@sparxie/sdk'
import type { PgliteDatabase } from '../../db/pglite'
import { LifecycleHttpError } from '../../runtime/local-lifecycle-methods'
import {
  jobCaptureEvidenceReferences,
  jobs,
} from '../job/job.schema'
import {
  captureEffectiveRevisionInputs,
  captureMaterializationIssues,
  captureResolutionGenerations,
  captureResolutionStageResults,
  captureRevisions,
  captures,
} from './capture.schema'
import type { CaptureMaterializationService } from './capture.materialization'
import type { CaptureDestinationResolutionService } from './capture.destination-resolution'
import {
  toCaptureCompletionDetail,
  toCaptureListPresentation,
  type ResolutionHeadRow,
  type ResolutionLinkedJob,
  type ResolutionStageRow,
} from './capture.resolution.dto'

type CaptureResolutionClient = ValedictorianWorkspaceClient['captureResolution']
type CaptureFilter = CaptureResolutionListInput['filter']

const NOT_FOUND = Object.freeze({ message: 'The requested resource was not found.' })
const INVALID_REQUEST = Object.freeze({ message: 'The request is invalid.' })
const ATTENTION_SUMMARIES = [
  'awaiting_information',
  'needs_action',
  'blocked',
  'stopped',
] as const

interface CursorValue {
  readonly captureId: string
  readonly observedAt: string
  readonly filter: CaptureFilter
  readonly sort: 'observed_desc'
}

export function createCaptureResolutionService(
  database: PgliteDatabase,
  input: {
    readonly workspaceId: string
    readonly materialization: CaptureMaterializationService
    readonly destination?: CaptureDestinationResolutionService
  },
): CaptureResolutionClient {
  const { destination, materialization, workspaceId } = input

  async function list(
    rawInput: CaptureResolutionListInput = {},
  ): Promise<CaptureResolutionListResult> {
    const request = captureResolutionListInputSchema.parse(rawInput)
    await materialization.materializeNextPage(workspaceId)
    const cursor = request.after ?? request.before
    const decoded = cursor ? decodeCursor(cursor, request.filter, request.sort) : null
    if (cursor && !decoded) throw new LifecycleHttpError(400, INVALID_REQUEST)
    const direction = request.before ? 'before' : 'after'
    const pageCondition = decoded
      ? tupleCondition(decoded, direction === 'before' ? 'newer' : 'older')
      : undefined
    const where = captureWhere(request.filter, pageCondition)
    const rows = await selectHeads(database, workspaceId, where, {
      ascending: direction === 'before',
      limit: request.limit + 1,
    })
    const window = rows.length > request.limit ? rows.slice(0, request.limit) : rows
    const pageRows = direction === 'before' ? [...window].reverse() : window
    const stages = await stagesByGeneration(database, pageRows)
    const linkedJobs = await linkedJobsByCapture(database, pageRows)
    const items = pageRows.map((row) => toCaptureListPresentation(
      row,
      stages.get(row.generationId ?? '') ?? [],
      linkedJobs.get(row.captureId) ?? null,
    ))
    const [first, last] = [pageRows[0], pageRows.at(-1)]
    const pageInfo = {
      startCursor: first ? encodeCursor(first, request.filter, request.sort) : null,
      endCursor: last ? encodeCursor(last, request.filter, request.sort) : null,
      hasPreviousPage: first
        ? await hasRow(database, workspaceId, request.filter, tupleCondition(first, 'newer'))
        : false,
      hasNextPage: last
        ? await hasRow(database, workspaceId, request.filter, tupleCondition(last, 'older'))
        : false,
    }
    const [{ value: totalCount }] = await countHeads(
      database,
      workspaceId,
      captureWhere(request.filter),
    )
    return captureResolutionListResultSchema.parse({ items, pageInfo, totalCount })
  }

  async function get(captureId: string) {
    await materialization.ensureCapture(workspaceId, captureId)
    const [row] = await selectHeads(
      database,
      workspaceId,
      and(eq(captures.id, captureId)),
      { ascending: false, limit: 1 },
    )
    if (!row) throw new LifecycleHttpError(404, NOT_FOUND)
    const stages = await stagesByGeneration(database, [row])
    const linkedJobs = await linkedJobsByCapture(database, [row])
    return toCaptureCompletionDetail(
      row,
      stages.get(row.generationId ?? '') ?? [],
      linkedJobs.get(row.captureId) ?? null,
    )
  }

  const unavailable = async () => {
    throw Object.assign(new Error('Capture resolution command is not available.'), {
      statusCode: 404,
    })
  }

  return {
    list,
    get,
    retry: destination ? (request) => destination.retry(request) : unavailable,
    replay: destination ? (request) => destination.replay(request) : unavailable,
    correct: unavailable,
    complete: unavailable,
  } satisfies CaptureResolutionClient
}

function captureWhere(filter: CaptureFilter, pageCondition?: ReturnType<typeof or>) {
  const lifecycleFilter = filter === 'removed'
    ? isNotNull(captures.removedAt)
    : isNull(captures.removedAt)
  const attention = filter === 'needs_attention'
    ? or(
        isNotNull(captureMaterializationIssues.captureId),
        inArray(
          captureResolutionGenerations.processingSummary,
          [...ATTENTION_SUMMARIES],
        ),
      )
    : undefined
  return and(lifecycleFilter, attention, pageCondition)
}

function tupleCondition(
  cursor: Pick<CursorValue, 'captureId' | 'observedAt'>,
  direction: 'newer' | 'older',
) {
  if (direction === 'newer') {
    return or(
      gt(captures.observedAt, cursor.observedAt),
      and(
        eq(captures.observedAt, cursor.observedAt),
        gt(captures.id, cursor.captureId),
      ),
    )
  }
  return or(
    lt(captures.observedAt, cursor.observedAt),
    and(
      eq(captures.observedAt, cursor.observedAt),
      lt(captures.id, cursor.captureId),
    ),
  )
}

function joinedHeads(database: PgliteDatabase) {
  return database
    .select({
      captureId: captures.id,
      captureRevision: captures.revision,
      observedAt: captures.observedAt,
      adapterId: captures.adapterId,
      adapterKind: captures.adapterKind,
      providerRecordId: captures.providerRecordId,
      removedAt: captures.removedAt,
      effectiveInputJson: captureEffectiveRevisionInputs.effectiveInputJson,
      evidenceOriginsJson: captureEffectiveRevisionInputs.evidenceOriginsJson,
      materializationIssueMessage: captureMaterializationIssues.message,
      connectorInstanceId: captureRevisions.connectorInstanceId,
      generationId: captureResolutionGenerations.id,
      generationOrdinal: captureResolutionGenerations.ordinal,
      generationTrigger: captureResolutionGenerations.trigger,
      generationStatus: captureResolutionGenerations.status,
      processingSummary: captureResolutionGenerations.processingSummary,
      generationCreatedAt: captureResolutionGenerations.createdAt,
      generationUpdatedAt: captureResolutionGenerations.updatedAt,
    })
    .from(captures)
    .leftJoin(captureEffectiveRevisionInputs, and(
      eq(captureEffectiveRevisionInputs.captureId, captures.id),
      eq(captureEffectiveRevisionInputs.captureRevision, captures.revision),
    ))
    .leftJoin(captureMaterializationIssues, and(
      eq(captureMaterializationIssues.captureId, captures.id),
      eq(captureMaterializationIssues.captureRevision, captures.revision),
      isNull(captureMaterializationIssues.resolvedAt),
    ))
    .leftJoin(captureRevisions, and(
      eq(captureRevisions.captureId, captures.id),
      eq(captureRevisions.revision, captures.revision),
    ))
    .leftJoin(captureResolutionGenerations, and(
      eq(captureResolutionGenerations.captureId, captures.id),
      eq(captureResolutionGenerations.captureRevision, captures.revision),
      inArray(captureResolutionGenerations.status, ['active', 'promoted']),
    ))
}

async function selectHeads(
  database: PgliteDatabase,
  workspaceId: string,
  where: ReturnType<typeof and>,
  options: { readonly ascending: boolean; readonly limit: number },
) {
  const query = joinedHeads(database).$dynamic()
  const rows = await query
    .where(and(eq(captures.workspaceId, workspaceId), where))
    .orderBy(
      options.ascending ? asc(captures.observedAt) : desc(captures.observedAt),
      options.ascending ? asc(captures.id) : desc(captures.id),
    )
    .limit(options.limit)
  return rows as ResolutionHeadRow[]
}

function countHeads(
  database: PgliteDatabase,
  workspaceId: string,
  where: ReturnType<typeof and>,
) {
  return database
    .select({ value: count() })
    .from(captures)
    .leftJoin(captureMaterializationIssues, and(
      eq(captureMaterializationIssues.captureId, captures.id),
      eq(captureMaterializationIssues.captureRevision, captures.revision),
      isNull(captureMaterializationIssues.resolvedAt),
    ))
    .leftJoin(captureResolutionGenerations, and(
      eq(captureResolutionGenerations.captureId, captures.id),
      eq(captureResolutionGenerations.captureRevision, captures.revision),
      inArray(captureResolutionGenerations.status, ['active', 'promoted']),
    ))
    .where(and(eq(captures.workspaceId, workspaceId), where))
}

async function hasRow(
  database: PgliteDatabase,
  workspaceId: string,
  filter: CaptureFilter,
  pageCondition: ReturnType<typeof or>,
) {
  const rows = await selectHeads(
    database,
    workspaceId,
    captureWhere(filter, pageCondition),
    { ascending: false, limit: 1 },
  )
  return rows.length > 0
}

async function stagesByGeneration(
  database: PgliteDatabase,
  heads: readonly ResolutionHeadRow[],
) {
  const generationIds = heads
    .map((row) => row.generationId)
    .filter((id): id is string => id !== null)
  const grouped = new Map<string, ResolutionStageRow[]>()
  if (generationIds.length === 0) return grouped
  const rows = await database
    .select()
    .from(captureResolutionStageResults)
    .where(inArray(captureResolutionStageResults.generationId, generationIds))
  for (const row of rows as ResolutionStageRow[]) {
    const bucket = grouped.get(row.generationId) ?? []
    bucket.push(row)
    grouped.set(row.generationId, bucket)
  }
  return grouped
}

async function linkedJobsByCapture(
  database: PgliteDatabase,
  heads: readonly ResolutionHeadRow[],
) {
  const captureIds = heads.map((row) => row.captureId)
  const linked = new Map<string, ResolutionLinkedJob>()
  if (captureIds.length === 0) return linked
  const rows = await database
    .select({
      captureId: jobCaptureEvidenceReferences.captureId,
      id: jobs.id,
      factsJson: jobs.factsJson,
    })
    .from(jobCaptureEvidenceReferences)
    .innerJoin(jobs, eq(jobs.id, jobCaptureEvidenceReferences.jobId))
    .where(and(
      inArray(jobCaptureEvidenceReferences.captureId, captureIds),
      isNull(jobs.removedAt),
    ))
    .orderBy(asc(jobs.createdAt), asc(jobs.id))
  for (const row of rows) {
    if (!linked.has(row.captureId)) {
      linked.set(row.captureId, { id: row.id, factsJson: row.factsJson })
    }
  }
  return linked
}

function encodeCursor(
  row: Pick<ResolutionHeadRow, 'captureId' | 'observedAt'>,
  filter: CaptureFilter,
  sort: 'observed_desc',
) {
  return Buffer.from(JSON.stringify({
    captureId: row.captureId,
    observedAt: row.observedAt,
    filter,
    sort,
  }), 'utf8').toString('base64url')
}

function decodeCursor(
  value: string,
  filter: CaptureFilter,
  sort: 'observed_desc',
): CursorValue | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (
      typeof parsed !== 'object'
      || parsed === null
      || parsed.filter !== filter
      || parsed.sort !== sort
      || typeof parsed.captureId !== 'string'
      || typeof parsed.observedAt !== 'string'
    ) {
      return null
    }
    return parsed as CursorValue
  } catch {
    return null
  }
}
