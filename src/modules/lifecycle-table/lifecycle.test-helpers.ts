import type { Application } from '@sparxie/sdk'

/** The canonical page boundaries a single-page lifecycle list reports. */
export const emptyPageInfo = {
  startCursor: null,
  endCursor: null,
  hasPreviousPage: false,
  hasNextPage: false,
} as const

export function emptyPage() {
  return { items: [], pageInfo: emptyPageInfo }
}

export function makeApplication(id: string, overrides: Partial<Application> = {}): Application {
  return {
    id: id as Application['id'],
    workspaceId: 'ws',
    opportunityId: 'opp-1' as Application['opportunityId'],
    jobId: 'job-1' as Application['jobId'],
    revision: 1,
    status: 'active',
    snapshot: {
      jobFactsRevision: 1,
      capturedAt: '2025-01-01T00:00:00Z',
      companyName: 'Acme',
      roleTitle: 'Engineer',
      sourceName: 'LinkedIn',
      roleKind: 'new_grad',
      term: null,
      terms: [],
      timingMode: 'unknown',
      startDate: null,
      endDate: null,
      location: null,
      workMode: 'unknown',
      initialDestination: null,
      initialLinks: [],
    },
    companyName: 'Acme',
    sourceName: 'LinkedIn',
    links: [],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    removedAt: null,
    ...overrides,
  }
}
