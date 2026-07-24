import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import {
  companyDuplicateListInputSchema,
  companySearchResultSchema,
  markCompaniesDistinctInputSchema,
  type CompanyCommandFailure,
  type CompanyDuplicateCandidateRow,
  type CompanyDuplicatePage,
  type MarkCompaniesDistinctResult,
  type WorkspaceCompaniesClient,
} from '@sparxie/sdk'
import type { PgliteDatabase } from '../../db/pglite'
import { createUuidV7Generator, type Clock, type UuidV7Generator } from '../../db/uuidv7'
import {
  capabilityFailure,
  companyCommandFingerprint,
  runCompanyCommand,
  type CompanyTx,
} from './company.command-support'
import {
  companyDuplicateCandidateReviews,
  companyDuplicateCandidates,
  companyAliases,
  workspaceCompanies,
} from './company.schema'
import { lifecycleFailure } from './company.values'
import { runCompanyDuplicateMaintenance } from './company.duplicate-maintenance'
import {
  COMPANY_DUPLICATE_MATCHER_VERSION,
  companyDuplicateFingerprint,
} from './company.duplicate-scorer'

type DuplicateClient = WorkspaceCompaniesClient['duplicates']
type CandidateRow = typeof companyDuplicateCandidates.$inferSelect
type CompanyRow = typeof workspaceCompanies.$inferSelect
type MarkDistinctInput = ReturnType<typeof markCompaniesDistinctInputSchema.parse>

export function createCompanyDuplicateService(
  database: PgliteDatabase,
  workspaceId: string,
  options: {
    readonly now?: Clock
    readonly newId?: UuidV7Generator
  } = {},
): Pick<DuplicateClient, 'list' | 'get' | 'markDistinct'> {
  const clock = options.now ?? (() => new Date())
  const newId = options.newId ?? createUuidV7Generator(clock)
  const nowIso = () => clock().toISOString()

  async function list(input: unknown): Promise<CompanyDuplicatePage> {
    const parsed = companyDuplicateListInputSchema.parse(input)
    await runCompanyDuplicateMaintenance(database, workspaceId, { newId, nowIso })
    const cursor = parsed.after
      ? decodeDuplicateCursor(parsed.after)
      : parsed.before ? decodeDuplicateCursor(parsed.before) : null
    const before = Boolean(parsed.before)
    const baseFilters = duplicateBaseFilters(workspaceId, parsed.filter)
    const filters = cursor
      ? [...baseFilters, duplicateCursorCondition(cursor, before)]
      : baseFilters
    const rows = await database
      .select()
      .from(companyDuplicateCandidates)
      .where(and(...filters))
      .orderBy(
        before ? asc(companyDuplicateCandidates.score) : desc(companyDuplicateCandidates.score),
        before ? asc(companyDuplicateCandidates.updatedAt) : desc(companyDuplicateCandidates.updatedAt),
        before ? desc(companyDuplicateCandidates.id) : asc(companyDuplicateCandidates.id),
      )
      .limit(parsed.limit + 1)
    const hasMore = rows.length > parsed.limit
    const pageRows = rows.slice(0, parsed.limit)
    if (before) pageRows.reverse()
    const [total] = await database
      .select({ value: count() })
      .from(companyDuplicateCandidates)
      .where(and(...baseFilters))
    return {
      items: await Promise.all(pageRows.map((row) => candidatePresentation(database, row))),
      pageInfo: {
        startCursor: duplicateCursor(pageRows[0]),
        endCursor: duplicateCursor(pageRows.at(-1)),
        hasPreviousPage: parsed.before ? hasMore : Boolean(parsed.after),
        hasNextPage: parsed.after ? hasMore : before ? true : hasMore,
      },
      totalCount: Number(total?.value ?? 0),
    }
  }

  async function get(candidateId: string): Promise<CompanyDuplicateCandidateRow> {
    const row = await selectCandidate(database, workspaceId, candidateId)
    if (!row) throw new CompanyDuplicateCandidateNotFoundError()
    return candidatePresentation(database, row)
  }

  async function markDistinct(input: unknown): Promise<MarkCompaniesDistinctResult> {
    const parsed = markCompaniesDistinctInputSchema.parse(input)
    if (parsed.workspaceId !== workspaceId) {
      return blockedMarkDistinct(parsed, lifecycleFailure(
        'workspace_ownership',
        'The duplicate candidate does not belong to this workspace.',
      ))
    }
    const unavailable = await capabilityFailure(database, workspaceId)
    if (unavailable) return blockedMarkDistinct(parsed, unavailable)
    return runCompanyCommand(database, {
      workspaceId,
      idempotencyKey: parsed.idempotencyKey,
      operation: 'mark_distinct',
      requestFingerprint: companyCommandFingerprint(parsed),
      now: nowIso,
    }, (tx) => executeMarkDistinct(tx, parsed, {
      workspaceId,
      newId,
      nowIso,
    }))
  }

  return { get, list, markDistinct }
}

async function executeMarkDistinct(
  tx: CompanyTx,
  input: MarkDistinctInput,
  options: {
    readonly workspaceId: string
    readonly newId: UuidV7Generator
    readonly nowIso: () => string
  },
): Promise<MarkCompaniesDistinctResult> {
  const [candidate] = await tx
    .select()
    .from(companyDuplicateCandidates)
    .where(and(
      eq(companyDuplicateCandidates.workspaceId, options.workspaceId),
      eq(companyDuplicateCandidates.id, input.candidateId),
    ))
    .limit(1)
    .for('update')
  if (!candidate) {
    return blockedMarkDistinct(input, lifecycleFailure(
      'invalid_input',
      'The duplicate candidate does not exist.',
    ))
  }
  const requestedIds = [input.leftCompanyId, input.rightCompanyId].sort()
  if (
    requestedIds[0] !== candidate.lowerCompanyId
    || requestedIds[1] !== candidate.higherCompanyId
  ) {
    return blockedMarkDistinct(input, lifecycleFailure(
      'invalid_input',
      'The submitted Companies do not match this duplicate candidate.',
    ))
  }
  const companies = await tx
    .select()
    .from(workspaceCompanies)
    .where(and(
      eq(workspaceCompanies.workspaceId, options.workspaceId),
      inArray(workspaceCompanies.id, requestedIds),
    ))
    .orderBy(asc(workspaceCompanies.id))
    .for('update')
  if (companies.length !== 2) {
    return blockedMarkDistinct(input, lifecycleFailure(
      'missing_lineage',
      'One of the duplicate candidate Companies no longer exists.',
    ))
  }
  const companyById = new Map(companies.map((company) => [company.id, company]))
  const stale = markDistinctStaleFailure(input, candidate, companyById)
  if (stale) return blockedMarkDistinct(input, stale)
  const aliases = await tx
    .select({
      companyId: companyAliases.companyId,
      normalizedValue: companyAliases.normalizedValue,
    })
    .from(companyAliases)
    .where(and(
      eq(companyAliases.workspaceId, options.workspaceId),
      inArray(companyAliases.companyId, requestedIds),
      isNull(companyAliases.removedAt),
    ))
    .orderBy(asc(companyAliases.normalizedValue), asc(companyAliases.id))
  const aliasesByCompany = new Map<string, string[]>()
  for (const alias of aliases) {
    const values = aliasesByCompany.get(alias.companyId) ?? []
    values.push(alias.normalizedValue)
    aliasesByCompany.set(alias.companyId, values)
  }
  const lower = companyById.get(candidate.lowerCompanyId)!
  const higher = companyById.get(candidate.higherCompanyId)!
  if (
    candidate.matcherVersion !== COMPANY_DUPLICATE_MATCHER_VERSION
    || candidate.lowerInputFingerprint !== companyDuplicateFingerprint({
      companyId: lower.id,
      revision: lower.revision,
      normalizedName: lower.normalizedDisplayName,
      normalizedAliases: aliasesByCompany.get(lower.id) ?? [],
      websiteHost: lower.websiteHost,
    })
    || candidate.higherInputFingerprint !== companyDuplicateFingerprint({
      companyId: higher.id,
      revision: higher.revision,
      normalizedName: higher.normalizedDisplayName,
      normalizedAliases: aliasesByCompany.get(higher.id) ?? [],
      websiteHost: higher.websiteHost,
    })
  ) {
    return blockedMarkDistinct(input, lifecycleFailure(
      'impossible_state',
      'The duplicate signals changed. Refresh and review the pair again.',
    ))
  }
  if (candidate.status !== 'open') {
    return blockedMarkDistinct(input, lifecycleFailure(
      'impossible_state',
      'Only an open duplicate candidate can be marked distinct.',
    ))
  }
  if (companies.some((company) => company.status !== 'active')) {
    return blockedMarkDistinct(input, lifecycleFailure(
      'impossible_state',
      'Both Companies must be active to mark this pair distinct.',
    ))
  }
  const timestamp = options.nowIso()
  const [updated] = await tx
    .update(companyDuplicateCandidates)
    .set({
      revision: candidate.revision + 1,
      status: 'marked_distinct',
      updatedAt: timestamp,
    })
    .where(and(
      eq(companyDuplicateCandidates.id, candidate.id),
      eq(companyDuplicateCandidates.revision, input.expectedCandidateRevision),
      eq(companyDuplicateCandidates.status, 'open'),
    ))
    .returning()
  if (!updated) {
    return blockedMarkDistinct(input, candidateStale(
      input.candidateId,
      input.expectedCandidateRevision,
      candidate.revision + 1,
    ))
  }
  await tx.insert(companyDuplicateCandidateReviews).values({
    id: options.newId(),
    workspaceId: options.workspaceId,
    candidateId: candidate.id,
    candidateRevision: updated.revision,
    decision: 'mark_distinct',
    actorJson: JSON.stringify(input.actor),
    rationale: input.rationale,
    createdAt: timestamp,
  })
  return {
    status: 'marked_distinct',
    workspaceId: options.workspaceId,
    candidateId: input.candidateId,
    requestCandidateRevision: input.expectedCandidateRevision,
    leftCompanyId: input.leftCompanyId,
    requestLeftCompanyRevision: input.expectedLeftCompanyRevision,
    rightCompanyId: input.rightCompanyId,
    requestRightCompanyRevision: input.expectedRightCompanyRevision,
    idempotencyKey: input.idempotencyKey,
    candidate: await candidatePresentation(tx, updated),
  }
}

function markDistinctStaleFailure(
  input: MarkDistinctInput,
  candidate: CandidateRow,
  companies: ReadonlyMap<string, CompanyRow>,
): CompanyCommandFailure | null {
  const guards: Extract<
    CompanyCommandFailure,
    { kind: 'stale_guard' }
  >['recovery']['guards'][number][] = []
  if (candidate.revision !== input.expectedCandidateRevision) {
    guards.push({
      kind: 'duplicate_candidate_revision',
      candidateId: input.candidateId,
      expectedRevision: input.expectedCandidateRevision,
      currentRevision: candidate.revision,
    })
  }
  for (const [companyId, expectedRevision] of [
    [input.leftCompanyId, input.expectedLeftCompanyRevision],
    [input.rightCompanyId, input.expectedRightCompanyRevision],
  ] as const) {
    const company = companies.get(companyId)
    if (company && company.revision !== expectedRevision) {
      guards.push({
        kind: 'company_revision',
        companyId,
        expectedRevision,
        currentRevision: company.revision,
      })
    }
  }
  return guards.length === 0 ? null : {
    kind: 'stale_guard',
    blocker: {
      code: 'impossible_state',
      message: 'The candidate or a Company changed. Refresh and review the pair again.',
    },
    recovery: { action: 'refresh_and_resubmit', guards },
  }
}

function candidateStale(
  candidateId: string,
  expectedRevision: number,
  currentRevision: number,
): CompanyCommandFailure {
  return {
    kind: 'stale_guard',
    blocker: {
      code: 'impossible_state',
      message: 'The duplicate candidate changed. Refresh and review it again.',
    },
    recovery: {
      action: 'refresh_and_resubmit',
      guards: [{
        kind: 'duplicate_candidate_revision',
        candidateId,
        expectedRevision,
        currentRevision,
      }],
    },
  }
}

async function candidatePresentation(
  exec: Pick<PgliteDatabase, 'select'> | CompanyTx,
  candidate: CandidateRow,
): Promise<CompanyDuplicateCandidateRow> {
  if (
    candidate.status === 'resolved_by_merge'
    && candidate.lowerResolvedSnapshotJson
    && candidate.higherResolvedSnapshotJson
  ) {
    return {
      candidateId: candidate.id,
      candidateRevision: candidate.revision,
      left: companySearchResultSchema.parse(
        JSON.parse(candidate.lowerResolvedSnapshotJson),
      ),
      right: companySearchResultSchema.parse(
        JSON.parse(candidate.higherResolvedSnapshotJson),
      ),
      score: candidate.score / 10_000,
      reasons: reasonCodes(candidate.reasonCodesJson),
      status: 'resolved_by_merge',
      updatedAt: candidate.updatedAt,
    }
  }
  const companies = await exec
    .select({
      id: workspaceCompanies.id,
      revision: workspaceCompanies.revision,
      displayName: workspaceCompanies.displayName,
      websiteUrl: workspaceCompanies.websiteUrl,
      status: workspaceCompanies.status,
      assignedJobCount: sql<number>`(
        select count(*)::int from job_company_assignments
        where job_company_assignments.workspace_id = ${candidate.workspaceId}
          and job_company_assignments.company_id = ${workspaceCompanies.id}
      )`,
    })
    .from(workspaceCompanies)
    .where(and(
      eq(workspaceCompanies.workspaceId, candidate.workspaceId),
      inArray(workspaceCompanies.id, [
        candidate.lowerCompanyId,
        candidate.higherCompanyId,
      ]),
    ))
  const companyById = new Map(companies.map((company) => [company.id, company]))
  const left = companyById.get(candidate.lowerCompanyId)
  const right = companyById.get(candidate.higherCompanyId)
  if (!left || !right || left.status === 'merged' || right.status === 'merged') {
    throw new Error('Duplicate candidate Company presentation is unavailable.')
  }
  const reasons = reasonCodes(candidate.reasonCodesJson)
  return {
    candidateId: candidate.id,
    candidateRevision: candidate.revision,
    left: searchResult(left),
    right: searchResult(right),
    score: candidate.score / 10_000,
    reasons,
    status: candidate.status as CompanyDuplicateCandidateRow['status'],
    updatedAt: candidate.updatedAt,
  }
}

function searchResult(company: {
  id: string
  revision: number
  displayName: string
  websiteUrl: string | null
  status: string
  assignedJobCount: number
}): CompanyDuplicateCandidateRow['left'] {
  return {
    companyId: company.id as CompanyDuplicateCandidateRow['left']['companyId'],
    revision: company.revision,
    displayName: company.displayName,
    websiteUrl: company.websiteUrl,
    status: company.status as 'active' | 'archived',
    assignedJobCount: Number(company.assignedJobCount),
  }
}

function reasonCodes(value: string): CompanyDuplicateCandidateRow['reasons'] {
  const codes = JSON.parse(value) as string[]
  return codes.map((code) => {
    if (code === 'normalized_name_similarity') {
      return { code, label: 'Company names are similar.' }
    }
    if (code === 'alias_similarity') {
      return { code, label: 'A Company alias is similar.' }
    }
    if (code === 'same_declared_domain') {
      return { code, label: 'The declared website domain matches.' }
    }
    throw new Error('Duplicate candidate contains an unsupported reason code.')
  })
}

function duplicateBaseFilters(
  workspaceId: string,
  filter: 'open' | 'all',
): SQL[] {
  const filters: SQL[] = [eq(companyDuplicateCandidates.workspaceId, workspaceId)]
  if (filter === 'open') {
    filters.push(
      eq(companyDuplicateCandidates.status, 'open'),
      sql`exists (
        select 1 from workspace_companies
        where workspace_companies.workspace_id = ${workspaceId}
          and workspace_companies.id = ${companyDuplicateCandidates.lowerCompanyId}
          and workspace_companies.status = 'active'
      )`,
      sql`exists (
        select 1 from workspace_companies
        where workspace_companies.workspace_id = ${workspaceId}
          and workspace_companies.id = ${companyDuplicateCandidates.higherCompanyId}
          and workspace_companies.status = 'active'
      )`,
    )
  }
  return filters
}

function duplicateCursorCondition(
  cursor: DuplicateCursor,
  before: boolean,
) {
  const scoreCompare = before ? gt : lt
  const updatedCompare = before ? gt : lt
  const idCompare = before ? lt : gt
  return or(
    scoreCompare(companyDuplicateCandidates.score, cursor.score),
    and(
      eq(companyDuplicateCandidates.score, cursor.score),
      updatedCompare(companyDuplicateCandidates.updatedAt, cursor.updatedAt),
    ),
    and(
      eq(companyDuplicateCandidates.score, cursor.score),
      eq(companyDuplicateCandidates.updatedAt, cursor.updatedAt),
      idCompare(companyDuplicateCandidates.id, cursor.id),
    ),
  )!
}

interface DuplicateCursor {
  readonly score: number
  readonly updatedAt: string
  readonly id: string
}

function duplicateCursor(
  row: CandidateRow | undefined,
): CompanyDuplicatePage['pageInfo']['startCursor'] {
  return row
    ? Buffer.from(JSON.stringify({
        score: row.score,
        updatedAt: row.updatedAt,
        id: row.id,
      }), 'utf8').toString('base64url') as
      CompanyDuplicatePage['pageInfo']['startCursor']
    : null
}

function decodeDuplicateCursor(value: string): DuplicateCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    if (
      !parsed
      || typeof parsed !== 'object'
      || typeof (parsed as DuplicateCursor).score !== 'number'
      || !Number.isInteger((parsed as DuplicateCursor).score)
      || typeof (parsed as DuplicateCursor).updatedAt !== 'string'
      || typeof (parsed as DuplicateCursor).id !== 'string'
    ) {
      throw new Error('invalid cursor')
    }
    return parsed as DuplicateCursor
  } catch (error) {
    throw Object.assign(new Error('Invalid Company duplicate cursor.'), {
      cause: error,
      code: 'invalid_company_duplicate_cursor',
      statusCode: 400,
    })
  }
}

async function selectCandidate(
  database: PgliteDatabase,
  workspaceId: string,
  candidateId: string,
) {
  const [row] = await database
    .select()
    .from(companyDuplicateCandidates)
    .where(and(
      eq(companyDuplicateCandidates.workspaceId, workspaceId),
      eq(companyDuplicateCandidates.id, candidateId),
    ))
    .limit(1)
  return row ?? null
}

function blockedMarkDistinct(
  input: MarkDistinctInput,
  failure: CompanyCommandFailure,
): MarkCompaniesDistinctResult {
  return {
    status: 'blocked',
    workspaceId: input.workspaceId,
    idempotencyKey: input.idempotencyKey,
    failure,
    candidateId: input.candidateId,
    requestCandidateRevision: input.expectedCandidateRevision,
    leftCompanyId: input.leftCompanyId,
    requestLeftCompanyRevision: input.expectedLeftCompanyRevision,
    rightCompanyId: input.rightCompanyId,
    requestRightCompanyRevision: input.expectedRightCompanyRevision,
  }
}

class CompanyDuplicateCandidateNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('The requested Company duplicate candidate was not found.')
    this.name = 'CompanyDuplicateCandidateNotFoundError'
  }
}
