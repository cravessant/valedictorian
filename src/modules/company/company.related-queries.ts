import { and, asc, count, desc, eq, gt, lt, or, sql, type SQL } from 'drizzle-orm'
import {
  companyAssignedJobListInputSchema,
  companyHistoryListInputSchema,
  type CompanyAssignedJobPage,
  type CompanyHistoryEvent,
  type CompanyHistoryPage,
} from '@sparxie/sdk'
import type { PgliteDatabase } from '../../db/pglite'
import { jobs } from '../job/job.schema'
import {
  companyHistory,
  jobCompanyAssignments,
} from './company.schema'
import {
  CompanyNotFoundError,
  decodeCompanyCursor,
  encodeCompanyCursor,
  normalizeCompanyText,
  parseActor,
  roleAndAssertedCompany,
  selectCompany,
} from './company.values'

export interface CompanyRelatedQueries {
  listAssignedJobs(companyId: string, input: unknown): Promise<CompanyAssignedJobPage>
  listHistory(companyId: string, input: unknown): Promise<CompanyHistoryPage>
}

export function createCompanyRelatedQueries(
  database: PgliteDatabase,
  workspaceId: string,
): CompanyRelatedQueries {
  async function listAssignedJobs(
    companyId: string,
    input: unknown,
  ): Promise<CompanyAssignedJobPage> {
    const parsed = companyAssignedJobListInputSchema.parse(input)
    const company = await selectCompany(database, workspaceId, companyId)
    if (!company) throw new CompanyNotFoundError()
    const cursor = parsed.after
      ? decodeCompanyCursor(parsed.after)
      : parsed.before ? decodeCompanyCursor(parsed.before) : null
    const before = Boolean(parsed.before)
    const roleTitle = sql<string>`coalesce(
      left(nullif(btrim(${jobs.factsJson}::jsonb ->> 'roleTitle'), ''), 500),
      'Unknown role'
    )`
    const filters: SQL[] = [
      eq(jobCompanyAssignments.workspaceId, workspaceId),
      eq(jobCompanyAssignments.companyId, companyId),
    ]
    if (cursor) {
      const comparePrimary = before ? lt : gt
      const compareId = before ? lt : gt
      filters.push(or(
        comparePrimary(roleTitle, cursor.primary),
        and(eq(roleTitle, cursor.primary), compareId(jobs.id, cursor.id)),
      )!)
    }
    const rows = await database
      .select({
        jobId: jobs.id,
        factsJson: jobs.factsJson,
        assignmentRevision: jobCompanyAssignments.revision,
      })
      .from(jobCompanyAssignments)
      .innerJoin(jobs, eq(jobs.id, jobCompanyAssignments.jobId))
      .where(and(...filters))
      .orderBy(before ? desc(roleTitle) : asc(roleTitle), before ? desc(jobs.id) : asc(jobs.id))
      .limit(parsed.limit + 1)
    const hasMore = rows.length > parsed.limit
    const pageRows = rows.slice(0, parsed.limit)
    if (before) pageRows.reverse()
    const items = pageRows.map((row) => {
      const facts = roleAndAssertedCompany(row.factsJson)
      return {
        jobId: row.jobId as CompanyAssignedJobPage['items'][number]['jobId'],
        assignmentRevision: row.assignmentRevision,
        workspaceCompany: {
          companyId: company.id as CompanyAssignedJobPage['items'][number]['workspaceCompany']['companyId'],
          revision: company.revision,
          displayName: company.displayName,
          status: company.status as 'active' | 'archived',
        },
        jobFactsCompanyName: facts.companyName,
        roleTitle: facts.roleTitle,
        namesDiffer: normalizeCompanyText(facts.companyName)
          !== company.normalizedDisplayName,
      }
    })
    const [total] = await database
      .select({ value: count() })
      .from(jobCompanyAssignments)
      .where(and(
        eq(jobCompanyAssignments.workspaceId, workspaceId),
        eq(jobCompanyAssignments.companyId, companyId),
      ))
    return {
      items,
      pageInfo: pageInfo(
        pageRows.map((row) => ({
          primary: roleAndAssertedCompany(row.factsJson).roleTitle,
          id: row.jobId,
        })),
        parsed.after,
        parsed.before,
        hasMore,
      ) as CompanyAssignedJobPage['pageInfo'],
      totalCount: Number(total?.value ?? 0),
    }
  }

  async function listHistory(
    companyId: string,
    input: unknown,
  ): Promise<CompanyHistoryPage> {
    const parsed = companyHistoryListInputSchema.parse(input)
    if (!await selectCompany(database, workspaceId, companyId)) {
      throw new CompanyNotFoundError()
    }
    const cursor = parsed.after
      ? decodeCompanyCursor(parsed.after)
      : parsed.before ? decodeCompanyCursor(parsed.before) : null
    const before = Boolean(parsed.before)
    const filters: SQL[] = [
      eq(companyHistory.workspaceId, workspaceId),
      eq(companyHistory.companyId, companyId),
    ]
    if (cursor) {
      const comparePrimary = before ? gt : lt
      const compareId = before ? gt : lt
      filters.push(or(
        comparePrimary(companyHistory.createdAt, cursor.primary),
        and(
          eq(companyHistory.createdAt, cursor.primary),
          compareId(companyHistory.id, cursor.id),
        ),
      )!)
    }
    const rows = await database
      .select()
      .from(companyHistory)
      .where(and(...filters))
      .orderBy(
        before ? asc(companyHistory.createdAt) : desc(companyHistory.createdAt),
        before ? asc(companyHistory.id) : desc(companyHistory.id),
      )
      .limit(parsed.limit + 1)
    const hasMore = rows.length > parsed.limit
    const pageRows = rows.slice(0, parsed.limit)
    if (before) pageRows.reverse()
    const [total] = await database
      .select({ value: count() })
      .from(companyHistory)
      .where(and(
        eq(companyHistory.workspaceId, workspaceId),
        eq(companyHistory.companyId, companyId),
      ))
    return {
      items: pageRows.map(toHistoryEvent),
      pageInfo: pageInfo(
        pageRows.map((row) => ({ primary: row.createdAt, id: row.id })),
        parsed.after,
        parsed.before,
        hasMore,
      ) as CompanyHistoryPage['pageInfo'],
      totalCount: Number(total?.value ?? 0),
    }
  }

  return { listAssignedJobs, listHistory }
}

function toHistoryEvent(
  row: typeof companyHistory.$inferSelect,
): CompanyHistoryEvent {
  const affectedJobIds = JSON.parse(row.affectedJobIdsJson) as string[]
  return {
    eventId: row.id,
    workspaceId: row.workspaceId,
    companyId: row.companyId as CompanyHistoryEvent['companyId'],
    companyRevision: row.companyRevision,
    kind: row.kind as CompanyHistoryEvent['kind'],
    occurredAt: row.createdAt,
    actor: parseActor(row.actorJson),
    rationale: row.rationale,
    change: {
      priorRevision: row.kind === 'created' ? null : row.companyRevision - 1,
      newRevision: row.companyRevision,
      changedFields: JSON.parse(row.changedFieldsJson) as CompanyHistoryEvent['change']['changedFields'],
      aliasId: row.aliasId,
      relatedCompanyId: row.relatedCompanyId as CompanyHistoryEvent['change']['relatedCompanyId'],
      affectedJobCount: affectedJobIds.length,
    },
  }
}

function pageInfo(
  rows: ReadonlyArray<{ primary: string; id: string }>,
  after: string | undefined,
  before: string | undefined,
  hasMore: boolean,
) {
  const cursor = (row: { primary: string; id: string } | undefined) =>
    row ? encodeCompanyCursor(row) : null
  return {
    startCursor: cursor(rows[0]),
    endCursor: cursor(rows.at(-1)),
    hasPreviousPage: before ? hasMore : Boolean(after),
    hasNextPage: after ? hasMore : before ? true : hasMore,
  }
}
