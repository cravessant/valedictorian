import type { ApplicationListQuery } from '../modules/applications/application.types'
import type { QueueListQuery, SourcingFindingsListInput, SourcingMergeStatus, QueueBucket } from 'sparxie'
import { PAGE_LIMIT, type FilterState } from './types'

export function buildApplicationListQuery(
  filters: FilterState,
  offset: number,
): ApplicationListQuery {
  return removeEmptyValues({
    search: filters.search,
    status: filters.status as ApplicationListQuery['status'],
    priorityBand: filters.priorityBand,
    minScore: filters.minScore ? Number(filters.minScore) : undefined,
    workMode: filters.workMode as ApplicationListQuery['workMode'],
    sort: filters.sort,
    createdFrom: normalizeDateFilter(filters.createdFrom, 'start'),
    createdTo: normalizeDateFilter(filters.createdTo, 'end'),
    updatedFrom: normalizeDateFilter(filters.updatedFrom, 'start'),
    updatedTo: normalizeDateFilter(filters.updatedTo, 'end'),
    limit: PAGE_LIMIT,
    offset,
  })
}

export function buildQueueListQuery(
  bucket: QueueBucket | undefined,
  offset: number,
): QueueListQuery {
  return removeEmptyQueueValues({
    bucket,
    limit: PAGE_LIMIT,
    offset,
  })
}

export function buildSourcingFindingsListQuery(
  mergeStatus: SourcingMergeStatus | undefined,
  sourceId: string,
  offset: number,
): SourcingFindingsListInput {
  return removeEmptySourcingValues({
    mergeStatus,
    sourceId,
    limit: PAGE_LIMIT,
    offset,
  })
}

function removeEmptyValues(query: ApplicationListQuery): ApplicationListQuery {
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== '' && value !== undefined),
  ) as ApplicationListQuery
}

function removeEmptyQueueValues(query: QueueListQuery): QueueListQuery {
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== '' && value !== undefined),
  ) as QueueListQuery
}

function removeEmptySourcingValues(query: SourcingFindingsListInput): SourcingFindingsListInput {
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== '' && value !== undefined),
  ) as SourcingFindingsListInput
}

function normalizeDateFilter(value: string, boundary: 'start' | 'end') {
  if (!value) {
    return undefined
  }

  return `${value}T${boundary === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`
}
