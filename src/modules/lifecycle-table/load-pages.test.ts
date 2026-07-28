import { describe, expect, it, vi } from 'vitest'

import type { LifecyclePageInfo } from '@sparxie/sdk'
import { afterPage, loadAllPages } from './load-pages'

/** Opaque lifecycle cursors are branded; fixtures keep readable literals. */
const cursor = (value: string) => value as LifecyclePageInfo['endCursor']

const page = (endCursor: string | null): LifecyclePageInfo => ({
  startCursor: cursor('start'),
  endCursor: endCursor === null ? null : cursor(endCursor),
  hasPreviousPage: false,
  hasNextPage: endCursor !== null,
})

describe('loadAllPages', () => {
  it('follows every forward boundary and preserves entry order', async () => {
    const loadPage = vi.fn()
      .mockResolvedValueOnce({ items: ['first'], pageInfo: page('page-2') })
      .mockResolvedValueOnce({ items: ['second'], pageInfo: page(null) })

    await expect(loadAllPages(loadPage)).resolves.toEqual(['first', 'second'])
    expect(loadPage).toHaveBeenNthCalledWith(1, undefined)
    expect(loadPage).toHaveBeenNthCalledWith(2, 'page-2')
  })

  it('stops at the final page even when it still reports a boundary cursor', async () => {
    const loadPage = vi.fn(async () => ({
      items: ['only'],
      pageInfo: { ...page('end'), hasNextPage: false },
    }))
    await expect(loadAllPages(loadPage)).resolves.toEqual(['only'])
    expect(loadPage).toHaveBeenCalledTimes(1)
  })

  it('rejects a repeated cursor instead of looping forever', async () => {
    const loadPage = vi.fn(async () => ({ items: [], pageInfo: page('same') }))
    await expect(loadAllPages(loadPage)).rejects.toThrow('repeated cursor')
  })
})

describe('afterPage', () => {
  it('asks for the first page when no boundary is known', () => {
    expect(afterPage(undefined)).toEqual({})
    expect(afterPage('c')).toEqual({ after: 'c' })
  })
})
