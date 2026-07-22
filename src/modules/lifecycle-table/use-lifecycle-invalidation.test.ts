// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { useLifecycleInvalidation } from './use-lifecycle-invalidation'

describe('useLifecycleInvalidation', () => {
  it('invokes the refresh callback on window focus', async () => {
    const refresh = vi.fn(async () => {})
    renderHook(() => useLifecycleInvalidation(refresh, { enabled: true, intervalMs: 60_000 }))

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('invokes the refresh callback when the document becomes visible', async () => {
    const refresh = vi.fn(async () => {})
    renderHook(() => useLifecycleInvalidation(refresh, { enabled: true, intervalMs: 60_000 }))

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('invokes the refresh callback after the slow interval elapses', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn(async () => {})
    renderHook(() => useLifecycleInvalidation(refresh, { enabled: true, intervalMs: 1_000 }))

    await act(async () => { vi.advanceTimersByTime(1_200) })
    expect(refresh).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does not refresh when disabled', async () => {
    const refresh = vi.fn(async () => {})
    renderHook(() => useLifecycleInvalidation(refresh, { enabled: false, intervalMs: 60_000 }))

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('coalesces overlapping refreshes and ignores stale completion when a newer load started', async () => {
    let resolveFirst: () => void = () => {}
    const refresh = vi.fn(() => new Promise<void>((resolve) => { resolveFirst = resolve }))
    renderHook(() => useLifecycleInvalidation(refresh, { enabled: true, intervalMs: 60_000 }))

    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(refresh).toHaveBeenCalledTimes(1)
    await act(async () => { resolveFirst() })
  })

  it('cleans up listeners and timers on unmount', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn(async () => {})
    const { unmount } = renderHook(() => useLifecycleInvalidation(refresh, { enabled: true, intervalMs: 1_000 }))
    unmount()
    await act(async () => { vi.advanceTimersByTime(2_000) })
    expect(refresh).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})