import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkspaceLocation } from './use-workspace-location'

describe('useWorkspaceLocation', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/?view=jobs')
    document.body.innerHTML = ''
  })

  it('uses real browser Back to restore prior cursor, filter, and origin focus', async () => {
    const cursor = 'opaque page/+=='
    window.history.replaceState(
      null,
      '',
      `/?view=jobs&filter=include_removed&cursor=${encodeURIComponent(cursor)}&direction=after`,
    )
    const anchor = document.createElement('button')
    anchor.id = 'job-link-job-1'
    document.body.append(anchor)
    const { result } = renderHook(() => useWorkspaceLocation())

    act(() => result.current.navigate(
      { view: 'jobs', resourceId: 'job-1' },
      { focusAnchor: anchor.id },
    ))
    expect(window.location.search).toContain('resource=job-1')

    await act(async () => window.history.back())

    await waitFor(() => expect(anchor).toHaveFocus())
    expect(result.current.entry.location).toEqual({
      view: 'jobs',
      filter: 'include_removed',
      cursor,
      cursorDirection: 'after',
    })
  })

  it('normalizes an invalid browser address to the safe view', () => {
    window.history.replaceState(null, '', '/?view=companies&filter=removed')
    const { result } = renderHook(() => useWorkspaceLocation())
    expect(result.current.entry.location).toEqual({ view: 'captures' })
    expect(window.location.search).toBe('?view=captures')
  })

  it('preserves percent-encoded controls, plus, and spaces in URL and history state', () => {
    const { result } = renderHook(() => useWorkspaceLocation())
    const cursor = '\u0000\n+\t space '
    act(() => result.current.navigate({
      view: 'jobs',
      cursor,
      cursorDirection: 'after',
    }))

    expect(new URL(window.location.href).searchParams.get('cursor')).toBe(cursor)
    expect(window.history.state.location.cursor).toBe(cursor)
    expect(result.current.entry.location.cursor).toBe(cursor)
  })

  it('addresses a backward Jobs page in the URL and restores it from history', async () => {
    const { result } = renderHook(() => useWorkspaceLocation())
    act(() => result.current.navigate({
      view: 'jobs',
      filter: 'include_removed',
      cursor: 'page-two',
      cursorDirection: 'after',
    }))
    act(() => result.current.navigate({
      view: 'jobs',
      filter: 'include_removed',
      cursor: 'page-two-start',
      cursorDirection: 'before',
    }))

    const url = new URL(window.location.href)
    expect(url.searchParams.get('cursor')).toBe('page-two-start')
    expect(url.searchParams.get('direction')).toBe('before')

    await act(async () => window.history.back())

    await waitFor(() => expect(result.current.entry.location).toEqual({
      view: 'jobs',
      filter: 'include_removed',
      cursor: 'page-two',
      cursorDirection: 'after',
    }))
    expect(new URL(window.location.href).searchParams.get('direction')).toBe('after')
  })

  it('applies both Back and Forward history locations', async () => {
    const { result } = renderHook(() => useWorkspaceLocation())
    const listState = {
      location: { view: 'jobs' as const, filter: 'all' },
      focusAnchor: 'job-link',
    }
    const detailState = {
      location: { view: 'jobs' as const, resourceId: 'job-id' },
      focusAnchor: 'job-link',
    }

    await act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: listState })))
    expect(result.current.entry).toEqual(listState)
    await act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: detailState })))
    expect(result.current.entry).toEqual(detailState)
  })
})
