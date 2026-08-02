import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  companyDirectoryListInputSchema,
  companyMatchPreviewInputSchema,
  companySearchInputSchema,
  type CompanyDetail,
  type CompanyDirectoryPage,
  type CompanyMatchPreview,
  type CompanyMatchPreviewPage,
  type CompanySearchPage,
  type WorkspaceCompanyLookup,
} from '@sparxie/sdk'
import type { PgliteDatabase } from '../../db/pglite.js'
import {
  companyAliases,
  companyDuplicateCandidates,
  companyHistory,
  jobCompanyAssignments,
  workspaceCompanies,
} from './company.schema.js'
import {
  CompanyNotFoundError,
  decodeCompanyCursor,
  encodeCompanyCursor,
  normalizeCompanyText,
  selectCompany,
  toWorkspaceCompany,
  websiteHost,
} from './company.values.js'

export interface CompanyQueries {
  get(companyId: string): Promise<CompanyDetail>
  lookup(companyId: string): Promise<WorkspaceCompanyLookup>
  search(input: unknown): Promise<CompanySearchPage>
  previewMatches(input: unknown): Promise<CompanyMatchPreviewPage>
  listDirectory(input: unknown): Promise<CompanyDirectoryPage>
}

export function createCompanyQueries(
  database: PgliteDatabase,
  workspaceId: string,
): CompanyQueries {
  async function lookup(companyId: string): Promise<WorkspaceCompanyLookup> {
    const requestedRow = await selectCompany(database, workspaceId, companyId)
    if (!requestedRow) throw new CompanyNotFoundError()
    const requested = await toWorkspaceCompany(database, requestedRow)
    if (requestedRow.status !== 'merged') {
      return { requested, canonical: requested, redirectPath: [] }
    }
    if (!requestedRow.mergedIntoCompanyId) {
      throw new Error('Merged Company has no canonical target.')
    }
    const canonicalRow = await selectCompany(
      database,
      workspaceId,
      requestedRow.mergedIntoCompanyId,
    )
    if (!canonicalRow || canonicalRow.status === 'merged') {
      throw new Error('Merged Company canonical target is not terminal.')
    }
    return {
      requested,
      canonical: await toWorkspaceCompany(database, canonicalRow),
      redirectPath: [canonicalRow.id as WorkspaceCompanyLookup['redirectPath'][number]],
    }
  }

  async function get(companyId: string): Promise<CompanyDetail> {
    const companyLookup = await lookup(companyId)
    const [assignmentCount] = await database
      .select({ value: count() })
      .from(jobCompanyAssignments)
      .where(and(
        eq(jobCompanyAssignments.workspaceId, workspaceId),
        eq(jobCompanyAssignments.companyId, companyId),
      ))
    const events = await database
      .select({
        eventId: companyHistory.id,
        kind: companyHistory.kind,
        occurredAt: companyHistory.createdAt,
      })
      .from(companyHistory)
      .where(and(
        eq(companyHistory.workspaceId, workspaceId),
        eq(companyHistory.companyId, companyId),
      ))
      .orderBy(desc(companyHistory.createdAt), desc(companyHistory.id))
      .limit(20)
    const [eventCount] = await database
      .select({ value: count() })
      .from(companyHistory)
      .where(and(
        eq(companyHistory.workspaceId, workspaceId),
        eq(companyHistory.companyId, companyId),
      ))
    const duplicateCounts = await openDuplicateCounts(database, workspaceId, [companyId])
    return {
      lookup: companyLookup,
      assignedJobCount: Number(assignmentCount?.value ?? 0),
      openDuplicateCandidateCount: companyLookup.requested.status === 'active'
        ? duplicateCounts.get(companyId) ?? 0
        : 0,
      history: {
        lastEventAt: events[0]?.occurredAt ?? null,
        eventCount: Number(eventCount?.value ?? 0),
        recentEvents: events.map((event) => ({
          eventId: event.eventId,
          kind: event.kind as CompanyDetail['history']['recentEvents'][number]['kind'],
          occurredAt: event.occurredAt,
        })),
      },
    }
  }

  async function search(input: unknown): Promise<CompanySearchPage> {
    const parsed = companySearchInputSchema.parse(input)
    const query = normalizeCompanyText(parsed.query)
    const statusCondition = parsed.scope === 'active'
      ? eq(workspaceCompanies.status, 'active')
      : ne(workspaceCompanies.status, 'merged')
    const aliasMatch = sql`exists (
      select 1 from company_aliases
      where company_aliases.workspace_id = ${workspaceId}
        and company_aliases.company_id = ${workspaceCompanies.id}
        and company_aliases.removed_at is null
        and position(${query} in company_aliases.normalized_value) > 0
    )`
    const rows = await database
      .select({
        id: workspaceCompanies.id,
        revision: workspaceCompanies.revision,
        displayName: workspaceCompanies.displayName,
        websiteUrl: workspaceCompanies.websiteUrl,
        status: workspaceCompanies.status,
        assignedJobCount: sql<number>`(
          select count(*)::int from job_company_assignments
          where job_company_assignments.workspace_id = ${workspaceId}
            and job_company_assignments.company_id = ${workspaceCompanies.id}
        )`,
      })
      .from(workspaceCompanies)
      .where(and(
        eq(workspaceCompanies.workspaceId, workspaceId),
        statusCondition,
        or(
          sql`position(${query} in ${workspaceCompanies.normalizedDisplayName}) > 0`,
          aliasMatch,
        ),
      ))
      .orderBy(asc(workspaceCompanies.normalizedDisplayName), asc(workspaceCompanies.id))
      .limit(parsed.limit + 1)
    return {
      items: rows.slice(0, parsed.limit).map((row) => ({
        companyId: row.id as CompanySearchPage['items'][number]['companyId'],
        revision: row.revision,
        displayName: row.displayName,
        websiteUrl: row.websiteUrl,
        status: row.status as CompanySearchPage['items'][number]['status'],
        assignedJobCount: Number(row.assignedJobCount),
      })),
      truncated: rows.length > parsed.limit,
    }
  }

  async function previewMatches(input: unknown): Promise<CompanyMatchPreviewPage> {
    const parsed = companyMatchPreviewInputSchema.parse(input)
    const rows = await database
      .select()
      .from(workspaceCompanies)
      .where(and(
        eq(workspaceCompanies.workspaceId, workspaceId),
        eq(workspaceCompanies.status, 'active'),
      ))
      .orderBy(asc(workspaceCompanies.normalizedDisplayName), asc(workspaceCompanies.id))
      .limit(201)
    const matches: CompanyMatchPreview[] = []
    for (const row of rows.slice(0, 200)) {
      const aliases = await database
        .select({ normalizedValue: companyAliases.normalizedValue })
        .from(companyAliases)
        .where(and(
          eq(companyAliases.workspaceId, workspaceId),
          eq(companyAliases.companyId, row.id),
          sql`${companyAliases.removedAt} is null`,
        ))
      const nameScore = dice(
        normalizeCompanyText(parsed.displayName),
        row.normalizedDisplayName,
      )
      const aliasScore = Math.max(
        0,
        ...aliases.map((value) =>
          dice(normalizeCompanyText(parsed.displayName), value.normalizedValue)),
      )
      const sameDomain = websiteHost(parsed.websiteUrl)
        && websiteHost(parsed.websiteUrl) === row.websiteHost
      const reasons: CompanyMatchPreview['reasons'] = []
      if (nameScore >= 0.45) {
        reasons.push({
          code: 'normalized_name_similarity',
          label: 'Company names are similar.',
        })
      }
      if (aliasScore >= 0.45) {
        reasons.push({ code: 'alias_similarity', label: 'A Company alias is similar.' })
      }
      if (sameDomain) {
        reasons.push({
          code: 'same_declared_domain',
          label: 'The declared website domain matches.',
        })
      }
      if (reasons.length === 0) continue
      matches.push({
        companyId: row.id as CompanyMatchPreview['companyId'],
        revision: row.revision,
        displayName: row.displayName,
        websiteUrl: row.websiteUrl,
        score: Math.max(nameScore, aliasScore, sameDomain ? 1 : 0),
        reasons,
      })
    }
    matches.sort((left, right) =>
      right.score - left.score
      || left.displayName.localeCompare(right.displayName)
      || left.companyId.localeCompare(right.companyId))
    return {
      items: matches.slice(0, parsed.limit),
      truncated: matches.length > parsed.limit || rows.length > 200,
    }
  }

  async function listDirectory(input: unknown): Promise<CompanyDirectoryPage> {
    const parsed = companyDirectoryListInputSchema.parse(input)
    const cursorValue = parsed.after
      ? decodeCompanyCursor(parsed.after)
      : parsed.before ? decodeCompanyCursor(parsed.before) : null
    const before = Boolean(parsed.before)
    const filters: SQL[] = [eq(workspaceCompanies.workspaceId, workspaceId)]
    if (parsed.filter !== 'all') {
      filters.push(eq(workspaceCompanies.status, parsed.filter))
    }
    if (cursorValue) {
      filters.push(directoryCursorCondition(cursorValue, before))
    }
    const rows = await database
      .select({
        id: workspaceCompanies.id,
        revision: workspaceCompanies.revision,
        displayName: workspaceCompanies.displayName,
        normalizedDisplayName: workspaceCompanies.normalizedDisplayName,
        websiteHost: workspaceCompanies.websiteHost,
        status: workspaceCompanies.status,
        updatedAt: workspaceCompanies.updatedAt,
        mergedIntoCompanyId: workspaceCompanies.mergedIntoCompanyId,
        assignedJobCount: sql<number>`(
          select count(*)::int from job_company_assignments
          where job_company_assignments.workspace_id = ${workspaceId}
            and job_company_assignments.company_id = ${workspaceCompanies.id}
        )`,
      })
      .from(workspaceCompanies)
      .where(and(...filters))
      .orderBy(
        before ? desc(workspaceCompanies.normalizedDisplayName) : asc(workspaceCompanies.normalizedDisplayName),
        before ? desc(workspaceCompanies.id) : asc(workspaceCompanies.id),
      )
      .limit(parsed.limit + 1)
    const hasMore = rows.length > parsed.limit
    const pageRows = rows.slice(0, parsed.limit)
    if (before) pageRows.reverse()
    const duplicateCounts = await openDuplicateCounts(
      database,
      workspaceId,
      pageRows.filter((row) => row.status === 'active').map((row) => row.id),
    )
    const [total] = await database
      .select({ value: count() })
      .from(workspaceCompanies)
      .where(and(...filters.slice(0, parsed.filter === 'all' ? 1 : 2)))
    return {
      items: pageRows.map((row) => ({
        companyId: row.id as CompanyDirectoryPage['items'][number]['companyId'],
        revision: row.revision,
        displayName: row.displayName,
        websiteHost: row.websiteHost,
        status: row.status as CompanyDirectoryPage['items'][number]['status'],
        assignedJobCount: Number(row.assignedJobCount),
        openDuplicateCandidateCount: row.status === 'active'
          ? duplicateCounts.get(row.id) ?? 0
          : 0,
        updatedAt: row.updatedAt,
        canonicalCompanyId: (row.mergedIntoCompanyId ?? row.id) as
          CompanyDirectoryPage['items'][number]['canonicalCompanyId'],
      })),
      pageInfo: {
        startCursor: directoryCursor(pageRows[0]),
        endCursor: directoryCursor(pageRows.at(-1)),
        hasPreviousPage: parsed.before ? hasMore : Boolean(parsed.after),
        hasNextPage: parsed.after ? hasMore : before ? true : hasMore,
      },
      totalCount: Number(total?.value ?? 0),
    }
  }

  return { get, listDirectory, lookup, previewMatches, search }
}

async function openDuplicateCounts(
  database: PgliteDatabase,
  workspaceId: string,
  companyIds: readonly string[],
) {
  const result = new Map<string, number>()
  if (companyIds.length === 0) return result
  const lowerCompanies = alias(workspaceCompanies, 'duplicate_lower_companies')
  const higherCompanies = alias(workspaceCompanies, 'duplicate_higher_companies')
  const lower = await database
    .select({
      companyId: companyDuplicateCandidates.lowerCompanyId,
      value: count(),
    })
    .from(companyDuplicateCandidates)
    .innerJoin(lowerCompanies, and(
      eq(lowerCompanies.workspaceId, companyDuplicateCandidates.workspaceId),
      eq(lowerCompanies.id, companyDuplicateCandidates.lowerCompanyId),
      eq(lowerCompanies.status, 'active'),
    ))
    .innerJoin(higherCompanies, and(
      eq(higherCompanies.workspaceId, companyDuplicateCandidates.workspaceId),
      eq(higherCompanies.id, companyDuplicateCandidates.higherCompanyId),
      eq(higherCompanies.status, 'active'),
    ))
    .where(and(
      eq(companyDuplicateCandidates.workspaceId, workspaceId),
      eq(companyDuplicateCandidates.status, 'open'),
      inArray(companyDuplicateCandidates.lowerCompanyId, [...companyIds]),
    ))
    .groupBy(companyDuplicateCandidates.lowerCompanyId)
  const higher = await database
    .select({
      companyId: companyDuplicateCandidates.higherCompanyId,
      value: count(),
    })
    .from(companyDuplicateCandidates)
    .innerJoin(lowerCompanies, and(
      eq(lowerCompanies.workspaceId, companyDuplicateCandidates.workspaceId),
      eq(lowerCompanies.id, companyDuplicateCandidates.lowerCompanyId),
      eq(lowerCompanies.status, 'active'),
    ))
    .innerJoin(higherCompanies, and(
      eq(higherCompanies.workspaceId, companyDuplicateCandidates.workspaceId),
      eq(higherCompanies.id, companyDuplicateCandidates.higherCompanyId),
      eq(higherCompanies.status, 'active'),
    ))
    .where(and(
      eq(companyDuplicateCandidates.workspaceId, workspaceId),
      eq(companyDuplicateCandidates.status, 'open'),
      inArray(companyDuplicateCandidates.higherCompanyId, [...companyIds]),
    ))
    .groupBy(companyDuplicateCandidates.higherCompanyId)
  for (const row of [...lower, ...higher]) {
    result.set(row.companyId, (result.get(row.companyId) ?? 0) + Number(row.value))
  }
  return result
}

function directoryCursorCondition(
  cursor: { primary: string; id: string },
  before: boolean,
) {
  const comparePrimary = before ? lt : gt
  const compareId = before ? lt : gt
  return or(
    comparePrimary(workspaceCompanies.normalizedDisplayName, cursor.primary),
    and(
      eq(workspaceCompanies.normalizedDisplayName, cursor.primary),
      compareId(workspaceCompanies.id, cursor.id),
    ),
  )!
}

function directoryCursor(
  row: { normalizedDisplayName: string; id: string } | undefined,
) {
  return row
    ? (encodeCompanyCursor({ primary: row.normalizedDisplayName, id: row.id }) as
      CompanyDirectoryPage['pageInfo']['startCursor'])
    : null
}

function dice(left: string, right: string): number {
  if (left === right) return 1
  if (left.length < 2 || right.length < 2) return 0
  const pairs = new Map<string, number>()
  for (let index = 0; index < left.length - 1; index += 1) {
    const pair = left.slice(index, index + 2)
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1)
  }
  let overlap = 0
  for (let index = 0; index < right.length - 1; index += 1) {
    const pair = right.slice(index, index + 2)
    const available = pairs.get(pair) ?? 0
    if (available > 0) {
      overlap += 1
      pairs.set(pair, available - 1)
    }
  }
  return (2 * overlap) / (left.length + right.length - 2)
}
