import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '../ipc/updates.preload'
import { createUpdatesApi } from '../App.test-helpers'
import { useAppUpdates } from './use-app-updates'

describe('useAppUpdates rejection settlement ownership', () => {
  it('does not let a rejected getState overwrite a newer onStateChanged update', async () => {
    let rejectGetState!: (reason?: unknown) => void
    const updatesApi = createUpdatesApi({
      currentVersion: '0.1.0-alpha.10',
      status: 'idle',
    })
    vi.mocked(updatesApi.getState).mockImplementationOnce(
      () => new Promise((_, reject) => {
        rejectGetState = reject
      }),
    )

    const { result } = renderHook(() => useAppUpdates(updatesApi))

    act(() => {
      updatesApi.emitState({
        availableVersion: '0.1.0-alpha.11',
        currentVersion: '0.1.0-alpha.10',
        status: 'ready',
      })
    })
    await waitFor(() => {
      expect(result.current.updateState?.status).toBe('ready')
    })

    await act(async () => {
      rejectGetState(new Error('CANARY_UPDATE_GETSTATE_STALE /secret'))
    })

    expect(result.current.updateState).toMatchObject({
      availableVersion: '0.1.0-alpha.11',
      status: 'ready',
    })
    expect(result.current.updateState?.status).not.toBe('error')
  })

  it('does not let a rejected check overwrite a newer onStateChanged update', async () => {
    let rejectCheck!: (reason?: unknown) => void
    const updatesApi = createUpdatesApi({
      currentVersion: '0.1.0-alpha.10',
      status: 'idle',
    })
    vi.mocked(updatesApi.getState).mockResolvedValue({
      currentVersion: '0.1.0-alpha.10',
      status: 'idle',
    })
    vi.mocked(updatesApi.check).mockImplementationOnce(
      () => new Promise((_, reject) => {
        rejectCheck = reject
      }),
    )

    const { result } = renderHook(() => useAppUpdates(updatesApi))
    await waitFor(() => {
      expect(result.current.updateState?.status).toBe('idle')
    })

    let checkPromise!: Promise<UpdateState>
    act(() => {
      checkPromise = result.current.checkForUpdates()
    })

    act(() => {
      updatesApi.emitState({
        availableVersion: '0.1.0-alpha.11',
        currentVersion: '0.1.0-alpha.10',
        percent: 12,
        status: 'downloading',
      })
    })
    await waitFor(() => {
      expect(result.current.updateState?.status).toBe('downloading')
    })

    await act(async () => {
      rejectCheck(new Error('CANARY_UPDATE_CHECK_STALE /secret'))
      await checkPromise.catch(() => undefined)
    })

    expect(result.current.updateState).toMatchObject({
      status: 'downloading',
      percent: 12,
    })
    expect(result.current.updateState?.status).not.toBe('error')
  })

  it('ignores install rejection after unmount', async () => {
    let rejectInstall!: (reason?: unknown) => void
    const updatesApi = createUpdatesApi({
      availableVersion: '0.1.0-alpha.11',
      currentVersion: '0.1.0-alpha.10',
      status: 'ready',
    })
    vi.mocked(updatesApi.install).mockImplementationOnce(
      () => new Promise((_, reject) => {
        rejectInstall = reject
      }),
    )

    const { result, unmount } = renderHook(() => useAppUpdates(updatesApi))
    await waitFor(() => {
      expect(result.current.updateState?.status).toBe('ready')
    })

    let installPromise!: Promise<void>
    act(() => {
      installPromise = result.current.installUpdate()
    })
    unmount()

    await act(async () => {
      rejectInstall(new Error('CANARY_UPDATE_INSTALL_UNMOUNT /secret'))
      await installPromise
    })

    // Hook is unmounted; re-render a fresh instance to prove we did not leave a poisoned API.
    const { result: next } = renderHook(() => useAppUpdates(updatesApi))
    await waitFor(() => {
      expect(next.current.updateState?.status).toBe('ready')
    })
    expect(next.current.updateState?.status).not.toBe('error')
  })

  it('does not let a deferred old-API check settlement overwrite a new updatesApi target', async () => {
    let resolveOldCheck!: (state: UpdateState) => void
    const oldApi = createUpdatesApi({
      currentVersion: '0.1.0-alpha.10',
      status: 'idle',
    })
    const newApi = createUpdatesApi({
      currentVersion: '0.2.0-alpha.1',
      status: 'unavailable',
    })
    vi.mocked(oldApi.check).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveOldCheck = resolve
      }),
    )
    // Keep the new target's initial getState pending so epoch does not advance from it.
    vi.mocked(newApi.getState).mockImplementation(
      () => new Promise(() => {}),
    )

    const { result, rerender } = renderHook(
      ({ api }) => useAppUpdates(api),
      { initialProps: { api: oldApi } },
    )
    await waitFor(() => {
      expect(result.current.updateState?.status).toBe('idle')
    })

    act(() => {
      void result.current.checkForUpdates()
    })

    rerender({ api: newApi })

    await act(async () => {
      resolveOldCheck({
        availableVersion: '0.1.0-alpha.99',
        currentVersion: '0.1.0-alpha.10',
        status: 'ready',
      })
    })

    expect(result.current.updateState?.status).not.toBe('ready')
    expect(result.current.updateState?.availableVersion).toBeUndefined()
    expect(result.current.updateState).toMatchObject({
      currentVersion: '0.1.0-alpha.10',
      status: 'idle',
    })
  })
})
