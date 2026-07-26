// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

import { testQueryClient } from '@/test/query-client'
import {
  LIFECYCLE_FALLBACK_REFRESH_MS,
  actionQueueQuery,
  capturePageQuery,
  jobPageQuery,
  jobProjectionQuery,
  lifecycleKeys,
} from './lifecycle-queries'
import { useLifecycleInvalidation } from './use-lifecycle-invalidation'

const scope = { workspaceId: 'ws-1', connectionId: 3 } as const
const captures = { filter: 'all', sort: 'observed_desc' } as const
const captureKey = (input: Parameters<typeof capturePageQuery>[2]) =>
  capturePageQuery(null, scope, input).queryKey

function renderInvalidation() {
  const queryClient = testQueryClient()
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    .mockResolvedValue(undefined)
  const { result } = renderHook(() => useLifecycleInvalidation(scope), {
    wrapper: ({ children }: { children?: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  })
  return { invalidate: result.current, invalidateQueries }
}

describe('lifecycle query keys', () => {
  it('scopes every family to its workspace and connection before the aggregate', () => {
    expect(lifecycleKeys.captures(scope)).toEqual(['lifecycle', 'ws-1', 3, 'captures'])
    expect(lifecycleKeys.actionQueue(scope)).toEqual(['lifecycle', 'ws-1', 3, 'action-queue'])
    expect(lifecycleKeys.workspace({ workspaceId: null, connectionId: 0 }))
      .toEqual(['lifecycle', 'unscoped', 0])
  })

  it('separates every scope, filter, sort, page, and mode input that changes the result', () => {
    const distinct = [
      captureKey(captures),
      capturePageQuery(null, { workspaceId: 'ws-2', connectionId: 3 }, captures).queryKey,
      capturePageQuery(null, { workspaceId: 'ws-1', connectionId: 4 }, captures).queryKey,
      captureKey({ ...captures, filter: 'removed' }),
      captureKey({ ...captures, cursor: 'c', cursorDirection: 'after' }),
      captureKey({ ...captures, cursor: 'c', cursorDirection: 'before' }),
      jobPageQuery(null, scope, { includeRemoved: true }).queryKey,
      jobPageQuery(null, scope, { includeRemoved: false }).queryKey,
      actionQueueQuery(null, scope, { offset: 0 }).queryKey,
      actionQueueQuery(null, scope, { offset: 50 }).queryKey,
      actionQueueQuery(null, scope, { offset: 0, bucket: 'apply_now' }).queryKey,
    ].map((key) => JSON.stringify(key))
    expect(new Set(distinct).size).toBe(distinct.length)
  })

  it('keeps the addressed page and the drained projection in one invalidatable family', () => {
    const family = lifecycleKeys.jobs(scope)
    for (const key of [
      jobPageQuery(null, scope, { includeRemoved: false }).queryKey,
      jobProjectionQuery(null, scope, { includeRemoved: false }).queryKey,
    ]) {
      expect(key.slice(0, family.length)).toEqual([...family])
    }
  })

  it('gives every lifecycle read the same bounded fallback refresh, hidden window included', () => {
    for (const read of [
      capturePageQuery(null, scope, captures),
      jobPageQuery(null, scope, { includeRemoved: false }),
      jobProjectionQuery(null, scope, { includeRemoved: false }),
      actionQueueQuery(null, scope, { offset: 0 }),
    ]) {
      expect(read.refetchInterval).toBe(LIFECYCLE_FALLBACK_REFRESH_MS)
      // Connector runs and the CLI write while the workspace window is hidden,
      // so the fallback must not pause with the document.
      expect(read.refetchIntervalInBackground).toBe(true)
    }
  })
})

describe('useLifecycleInvalidation', () => {
  it('targets only the owning family, and the workspace chain only when asked', async () => {
    const { invalidate, invalidateQueries } = renderInvalidation()

    await invalidate.captures()
    await invalidate.workspace()

    expect(invalidateQueries.mock.calls).toEqual([
      [{ queryKey: lifecycleKeys.captures(scope) }, { throwOnError: true }],
      [{ queryKey: lifecycleKeys.workspace(scope) }, { throwOnError: true }],
    ])
  })

  it('refreshes both Application presentations, and nothing else, after an Application command', async () => {
    const { invalidate, invalidateQueries } = renderInvalidation()

    await invalidate.applicationPresentations()

    expect(invalidateQueries.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      [...lifecycleKeys.applications(scope)],
      [...lifecycleKeys.actionQueue(scope)],
    ])
  })

  it('surfaces a rejected re-read instead of reporting a refreshed view', async () => {
    const { invalidate, invalidateQueries } = renderInvalidation()
    invalidateQueries.mockRejectedValueOnce(new Error('projection unavailable'))

    await expect(invalidate.jobs()).rejects.toThrow('projection unavailable')
  })
})
