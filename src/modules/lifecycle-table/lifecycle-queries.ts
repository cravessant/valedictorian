import { queryOptions } from '@tanstack/react-query'
import type {
  ActionQueueBucket,
  Application,
  Job,
  JobCompanyAssignmentPresentation,
  JobListInput,
  LifecyclePageInfo,
  Opportunity,
} from '@sparxie/sdk'
import type { LocalWorkspaceClientV2 } from '@/runtime/local-connector-client.contract'

import { WorkspaceClientUnavailableError, scopedLoadFailure } from '@/app/app-load-failure'
import type { WorkspaceCursorDirection } from '@/app/workspace-location'
import { workspacePageRequest, type WorkspacePageInfo } from '@/app/workspace-page'
import { applicationConfig } from './configs/application-config'
import { jobConfig } from './configs/job-config'
import { opportunityConfig } from './configs/opportunity-config'
import type { LifecycleLoadState } from './lifecycle-table'
import { afterPage, loadAllPages } from './load-pages'

/**
 * Lifecycle server reads, owned beside the lifecycle table that renders them.
 *
 * Each factory derives its query key from the exact list request it sends, so a
 * filter, sort, page, aggregate, or mode input can never change the result
 * without changing the key.
 */

const PAGE_LIMIT = 50
const PROJECTION_LIMIT = 100
export const ACTION_QUEUE_PAGE_SIZE = 50

/**
 * Bounded fallback refresh. The workspace database is written by connector runs
 * and the CLI, and the renderer has no push channel yet, so every lifecycle read
 * re-asks on a slow interval until the workspace invalidation stream lands.
 */
export const LIFECYCLE_FALLBACK_REFRESH_MS = 60_000

/**
 * Read behavior every lifecycle list shares; deliberate, not inherited.
 *
 * `refetchIntervalInBackground` is stated because TanStack would otherwise stop
 * the fallback while the document is hidden. An Electron workspace window is
 * routinely hidden while connector runs and the CLI write to the same database,
 * and the workbench has always kept re-reading through that, so the interval
 * stays live in the background until the workspace invalidation stream lands.
 */
const lifecycleRead = {
  refetchInterval: LIFECYCLE_FALLBACK_REFRESH_MS,
  refetchIntervalInBackground: true,
  staleTime: 0,
} as const

/**
 * The cache scope every lifecycle key starts from.
 *
 * `workspaceId` keeps two workspaces from ever sharing an entry. `connectionId`
 * identifies the workspace client that answered: when the renderer's backend is
 * replaced the whole scope moves with it, so a response produced by a superseded
 * client cannot land in the active view.
 */
export interface LifecycleScope {
  readonly workspaceId: string | null
  readonly connectionId: number
}

export type LifecycleClient = LocalWorkspaceClientV2

export interface CapturePageInput {
  readonly filter: 'all' | 'needs_attention' | 'removed'
  readonly sort: 'observed_desc'
  readonly cursor?: string
  readonly cursorDirection?: WorkspaceCursorDirection
}

export interface AggregatePageInput {
  readonly includeRemoved: boolean
  readonly cursor?: string
  readonly cursorDirection?: WorkspaceCursorDirection
}

export interface ActionQueueInput {
  readonly bucket?: ActionQueueBucket
  readonly offset: number
}

export interface ProjectionInput {
  readonly includeRemoved: boolean
}

/** Preserves the list contract's `after`-xor-absent union across the drain. */
type ProjectionPageRequest = ProjectionInput
  & { readonly limit: number }
  & ({ readonly after?: never } | { readonly after: string })

export interface JobsPage {
  readonly items: ReadonlyArray<Job>
  readonly pageInfo: WorkspacePageInfo
  readonly assignments: ReadonlyMap<string, JobCompanyAssignmentPresentation>
}

/** Stable, serializable, workspace-scoped key families. */
export const lifecycleKeys = {
  workspace: (scope: LifecycleScope) =>
    ['lifecycle', scope.workspaceId ?? 'unscoped', scope.connectionId] as const,
  captures: (scope: LifecycleScope) => [...lifecycleKeys.workspace(scope), 'captures'] as const,
  jobs: (scope: LifecycleScope) => [...lifecycleKeys.workspace(scope), 'jobs'] as const,
  opportunities: (scope: LifecycleScope) =>
    [...lifecycleKeys.workspace(scope), 'opportunities'] as const,
  applications: (scope: LifecycleScope) =>
    [...lifecycleKeys.workspace(scope), 'applications'] as const,
  actionQueue: (scope: LifecycleScope) =>
    [...lifecycleKeys.workspace(scope), 'action-queue'] as const,
} as const

export function capturePageQuery(
  client: LifecycleClient | null,
  scope: LifecycleScope,
  input: CapturePageInput,
) {
  const request = {
    filter: input.filter,
    sort: input.sort,
    limit: PAGE_LIMIT,
    ...workspacePageRequest(input.cursor, input.cursorDirection),
  }
  return queryOptions({
    queryKey: [...lifecycleKeys.captures(scope), 'page', request],
    queryFn: () => requireClient(client).captureResolutionV2.list(request),
    ...lifecycleRead,
  })
}

/**
 * The addressed Jobs page and the Company assignment each row displays load as
 * one unit, so a page never renders half-attributed.
 */
export function jobPageQuery(
  client: LifecycleClient | null,
  scope: LifecycleScope,
  input: AggregatePageInput,
) {
  const request: JobListInput = {
    includeRemoved: input.includeRemoved,
    limit: PAGE_LIMIT,
    ...workspacePageRequest(input.cursor, input.cursorDirection),
  }
  return queryOptions({
    queryKey: [...lifecycleKeys.jobs(scope), 'page', request],
    queryFn: async (): Promise<JobsPage> => {
      const workspace = requireClient(client)
      const page = await jobConfig.list(workspace, request)
      const assignments = await Promise.all(
        page.items.map((job) => workspace.companyAssignments.get(job.id)),
      )
      return {
        items: page.items,
        pageInfo: page.pageInfo,
        assignments: new Map(assignments.map((assignment) => [assignment.jobId, assignment])),
      }
    },
    ...lifecycleRead,
  })
}

/**
 * A projection the workbench counts and lists in full: every page of one list,
 * drained through the canonical forward boundary and keyed by the request that
 * shapes it.
 */
function projectionQuery<Row>(
  family: readonly unknown[],
  input: ProjectionInput,
  listPage: (request: ProjectionPageRequest) => Promise<{
    readonly items: ReadonlyArray<Row>
    readonly pageInfo: LifecyclePageInfo
  }>,
) {
  const request = { includeRemoved: input.includeRemoved, limit: PROJECTION_LIMIT }
  return queryOptions({
    queryKey: [...family, 'projection', request],
    queryFn: (): Promise<ReadonlyArray<Row>> =>
      loadAllPages((after) => listPage({ ...request, ...afterPage(after) })),
    ...lifecycleRead,
  })
}

type ProjectionQuery<Row> = (
  client: LifecycleClient | null,
  scope: LifecycleScope,
  input: ProjectionInput,
) => ReturnType<typeof projectionQuery<Row>>

export const jobProjectionQuery: ProjectionQuery<Job> = (client, scope, input) =>
  projectionQuery<Job>(lifecycleKeys.jobs(scope), input, (request) =>
    jobConfig.list(requireClient(client), request))

export const opportunityProjectionQuery: ProjectionQuery<Opportunity> = (client, scope, input) =>
  projectionQuery<Opportunity>(lifecycleKeys.opportunities(scope), input, (request) =>
    opportunityConfig.list(requireClient(client), request))

export const applicationProjectionQuery: ProjectionQuery<Application> = (client, scope, input) =>
  projectionQuery<Application>(lifecycleKeys.applications(scope), input, (request) =>
    applicationConfig.list(requireClient(client), request))

export function actionQueueQuery(
  client: Pick<LifecycleClient, 'actionQueue'> | null,
  scope: LifecycleScope,
  input: ActionQueueInput,
) {
  const request = {
    ...(input.bucket !== undefined ? { actionBucket: input.bucket } : {}),
    limit: ACTION_QUEUE_PAGE_SIZE,
    offset: input.offset,
  }
  return queryOptions({
    queryKey: [...lifecycleKeys.actionQueue(scope), 'page', request],
    queryFn: () => requireClient(client).actionQueue.list(request),
    ...lifecycleRead,
  })
}

/** The shape of a `useQuery` result the shared table's load state is read from. */
export interface LifecycleReadStatus {
  readonly isPending: boolean
  readonly isFetching: boolean
  readonly isError: boolean
  readonly error: unknown
  readonly data: unknown
  readonly refetch: () => unknown
}

/**
 * Present a lifecycle read through the shared table's load state. An in-flight
 * re-read stays visibly loading rather than passing an older page off as current;
 * a failure keeps its locally owned retry control and the classifier's safe
 * public message and title. Upstream text never reaches the surface —
 * `fallbackMessage` is what a reader sees for a rejection nothing can name.
 */
export function lifecycleLoadState(
  query: LifecycleReadStatus,
  fallbackMessage: string,
): LifecycleLoadState {
  if (query.isFetching) return { status: 'loading' }
  if (!query.isError) return query.isPending ? { status: 'loading' } : { status: 'loaded' }
  const failure = scopedLoadFailure(query.error, fallbackMessage, query.data !== undefined)
  return {
    status: 'failure',
    message: failure?.message ?? fallbackMessage,
    title: failure?.title,
    onRetry: () => { void query.refetch() },
  }
}

function requireClient<T>(client: T | null): T {
  if (!client) throw new WorkspaceClientUnavailableError()
  return client
}
