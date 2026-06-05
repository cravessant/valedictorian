import { and, asc, count, desc, eq, gte, like, lte, or, type SQL } from 'drizzle-orm'
import { applicationLinks, applications, companies, sources } from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'
import {
  DEFAULT_APPLICATION_LIST_LIMIT,
  DEFAULT_APPLICATION_LIST_OFFSET,
  MAX_APPLICATION_LIST_LIMIT,
  isApplicationListSort,
  isApplicationStatus,
  type ApplicationListItem,
  type ApplicationListQuery,
  type ApplicationRepository,
  type WorkMode,
} from './application.types'

const applicationSelection = {
  id: applications.id,
  companyName: companies.name,
  roleTitle: applications.roleTitle,
  sourceName: sources.name,
  status: applications.status,
  term: applications.term,
  locationRaw: applications.locationRaw,
  city: applications.city,
  region: applications.region,
  country: applications.country,
  workMode: applications.workMode,
  hasApplied: applications.hasApplied,
  currentPriorityScore: applications.currentPriorityScore,
  currentPriorityBand: applications.currentPriorityBand,
  primaryLinkLabel: applicationLinks.label,
  primaryLinkUrl: applicationLinks.url,
  notes: applications.notes,
  createdAt: applications.createdAt,
  updatedAt: applications.updatedAt,
}

interface ApplicationRow {
  id: string
  companyName: string
  roleTitle: string
  sourceName: string
  status: string
  term: string | null
  locationRaw: string | null
  city: string | null
  region: string | null
  country: string
  workMode: string
  hasApplied: boolean
  currentPriorityScore: number | null
  currentPriorityBand: string | null
  primaryLinkLabel: string | null
  primaryLinkUrl: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export function createSqliteApplicationRepository(
  database: DrizzleDatabase,
): ApplicationRepository {
  return {
    async listApplications(query: ApplicationListQuery = {}) {
      if (query.sort && !isApplicationListSort(query.sort)) {
        throw new Error(`Invalid application list sort: ${query.sort}`)
      }

      const limit = validateListLimit(query.limit)
      const offset = query.offset ?? DEFAULT_APPLICATION_LIST_OFFSET
      const where = buildApplicationListWhere(query)
      const totalRow = database
        .select({
          value: count(),
        })
        .from(applications)
        .innerJoin(companies, eq(applications.companyId, companies.id))
        .innerJoin(sources, eq(applications.sourceId, sources.id))
        .leftJoin(
          applicationLinks,
          eq(applicationLinks.applicationId, applications.id),
        )
        .where(where)
        .get()
      const rows = database
        .select(applicationSelection)
        .from(applications)
        .innerJoin(companies, eq(applications.companyId, companies.id))
        .innerJoin(sources, eq(applications.sourceId, sources.id))
        .leftJoin(
          applicationLinks,
          eq(applicationLinks.applicationId, applications.id),
        )
        .where(where)
        .orderBy(...buildApplicationListOrder(query))
        .limit(limit)
        .offset(offset)
        .all()

      const items = rows.map(mapApplicationRow)

      const total = totalRow?.value ?? 0

      return {
        items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
      }
    },
    async getApplication(id) {
      return selectApplicationById(database, id)
    },
    async updateApplicationStatus(input) {
      if (!isApplicationStatus(input.status)) {
        throw new Error(`Invalid application status: ${input.status}`)
      }

      database
        .update(applications)
        .set({
          status: input.status,
          updatedAt: new Date().toISOString(),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        })
        .where(eq(applications.id, input.applicationId))
        .run()

      const updated = selectApplicationById(database, input.applicationId)

      if (!updated) {
        throw new Error(`Application not found: ${input.applicationId}`)
      }

      return updated
    },
  }
}

function validateListLimit(limit = DEFAULT_APPLICATION_LIST_LIMIT) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_APPLICATION_LIST_LIMIT) {
    throw new Error(
      `Application list limit must be between 1 and ${MAX_APPLICATION_LIST_LIMIT}`,
    )
  }

  return limit
}

function selectApplicationById(database: DrizzleDatabase, id: string) {
  const row = database
    .select(applicationSelection)
    .from(applications)
    .innerJoin(companies, eq(applications.companyId, companies.id))
    .innerJoin(sources, eq(applications.sourceId, sources.id))
    .leftJoin(
      applicationLinks,
      eq(applicationLinks.applicationId, applications.id),
    )
    .where(and(eq(applications.id, id), eq(applicationLinks.isPrimary, true)))
    .get()

  return row ? mapApplicationRow(row) : null
}

function mapApplicationRow(row: ApplicationRow): ApplicationListItem {
  const location =
    row.locationRaw ?? [row.city, row.region, row.country].filter(Boolean).join(', ')

  return {
    id: row.id,
    companyName: row.companyName,
    roleTitle: row.roleTitle,
    sourceName: row.sourceName,
    status: row.status as ApplicationListItem['status'],
    term: row.term,
    location,
    workMode: row.workMode as WorkMode,
    hasApplied: row.hasApplied,
    currentPriorityScore: row.currentPriorityScore,
    currentPriorityBand: row.currentPriorityBand,
    primaryLink:
      row.primaryLinkLabel && row.primaryLinkUrl
        ? {
            label: row.primaryLinkLabel,
            url: row.primaryLinkUrl,
          }
        : null,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function buildApplicationListOrder(query: ApplicationListQuery) {
  if (query.sort === 'company_asc') {
    return [asc(companies.name), desc(applications.updatedAt)]
  }

  if (query.sort === 'company_desc') {
    return [desc(companies.name), desc(applications.updatedAt)]
  }

  if (query.sort === 'role_asc') {
    return [asc(applications.roleTitle), desc(applications.updatedAt)]
  }

  if (query.sort === 'role_desc') {
    return [desc(applications.roleTitle), desc(applications.updatedAt)]
  }

  if (query.sort === 'source_asc') {
    return [asc(sources.name), desc(applications.updatedAt)]
  }

  if (query.sort === 'source_desc') {
    return [desc(sources.name), desc(applications.updatedAt)]
  }

  if (query.sort === 'status_asc') {
    return [asc(applications.status), desc(applications.updatedAt)]
  }

  if (query.sort === 'status_desc') {
    return [desc(applications.status), desc(applications.updatedAt)]
  }

  if (query.sort === 'priority_asc') {
    return [asc(applications.currentPriorityScore), desc(applications.updatedAt)]
  }

  if (query.sort === 'updated_asc') {
    return [asc(applications.updatedAt), desc(applications.currentPriorityScore)]
  }

  if (query.sort === 'updated_desc') {
    return [desc(applications.updatedAt), desc(applications.currentPriorityScore)]
  }

  return [desc(applications.currentPriorityScore), desc(applications.updatedAt)]
}

function buildApplicationListWhere(query: ApplicationListQuery) {
  const filters: SQL[] = [eq(applicationLinks.isPrimary, true)]

  if (query.status) {
    filters.push(eq(applications.status, query.status))
  }

  if (query.hasApplied !== undefined) {
    filters.push(eq(applications.hasApplied, query.hasApplied))
  }

  if (query.priorityBand) {
    filters.push(eq(applications.currentPriorityBand, query.priorityBand))
  }

  if (query.minScore !== undefined) {
    filters.push(gte(applications.currentPriorityScore, query.minScore))
  }

  if (query.maxScore !== undefined) {
    filters.push(lte(applications.currentPriorityScore, query.maxScore))
  }

  if (query.company) {
    filters.push(like(companies.name, `%${query.company}%`))
  }

  if (query.role) {
    filters.push(like(applications.roleTitle, `%${query.role}%`))
  }

  if (query.source) {
    filters.push(like(sources.name, `%${query.source}%`))
  }

  if (query.search) {
    const pattern = `%${query.search}%`
    const searchFilter = or(
      like(companies.name, pattern),
      like(applications.roleTitle, pattern),
      like(sources.name, pattern),
      like(applications.locationRaw, pattern),
      like(applications.notes, pattern),
    )

    if (searchFilter) {
      filters.push(searchFilter)
    }
  }

  if (query.workMode) {
    filters.push(eq(applications.workMode, query.workMode))
  }

  if (query.createdFrom) {
    filters.push(gte(applications.createdAt, query.createdFrom))
  }

  if (query.createdTo) {
    filters.push(lte(applications.createdAt, query.createdTo))
  }

  if (query.updatedFrom) {
    filters.push(gte(applications.updatedAt, query.updatedFrom))
  }

  if (query.updatedTo) {
    filters.push(lte(applications.updatedAt, query.updatedTo))
  }

  return and(...filters)
}
