import { describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '../ipc/updates.preload'
import { createUpdateService, type UpdateBoundary } from './update.service'

describe('update service', () => {
  it('stays disabled when app updates are unavailable', async () => {
    const updater = createFakeUpdater()
    const service = createUpdateService({
      app: {
        getVersion: () => '0.1.0-alpha.10',
        isPackaged: false,
        platform: 'darwin',
      },
      updater,
    })

    await expect(service.check()).resolves.toEqual({
      currentVersion: '0.1.0-alpha.10',
      message: 'Updates are only available in signed packaged Mac builds.',
      status: 'disabled',
    })

    expect(service.getState()).toEqual({
      currentVersion: '0.1.0-alpha.10',
      message: 'Updates are only available in signed packaged Mac builds.',
      status: 'disabled',
    })
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('checks packaged Mac builds and reports when no update is available', async () => {
    const updater = createFakeUpdater()
    updater.checkForUpdates = vi.fn(async () => {
      updater.emit('update-not-available', { version: '0.1.0-alpha.10' })
    })
    const service = createUpdateService({
      app: {
        getVersion: () => '0.1.0-alpha.10',
        isPackaged: true,
        platform: 'darwin',
      },
      updater,
    })
    const states: UpdateState[] = []

    service.onStateChanged((state) => states.push(state))
    await expect(service.check()).resolves.toEqual({
      currentVersion: '0.1.0-alpha.10',
      status: 'unavailable',
    })

    expect(updater.setAutoDownload).toHaveBeenCalledWith(true)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(states).toEqual([
      { currentVersion: '0.1.0-alpha.10', status: 'checking' },
      { currentVersion: '0.1.0-alpha.10', status: 'unavailable' },
    ])
  })

  it('reports download progress and installs after an update is ready', async () => {
    const updater = createFakeUpdater()
    updater.checkForUpdates = vi.fn(async () => {
      updater.emit('update-available', { version: '0.1.0-alpha.11' })
      updater.emit('download-progress', { percent: 42.7 })
      updater.emit('update-downloaded', { version: '0.1.0-alpha.11' })
    })
    const service = createUpdateService({
      app: {
        getVersion: () => '0.1.0-alpha.10',
        isPackaged: true,
        platform: 'darwin',
      },
      updater,
    })
    const states: UpdateState[] = []

    service.onStateChanged((state) => states.push(state))
    await expect(service.check()).resolves.toEqual({
      availableVersion: '0.1.0-alpha.11',
      currentVersion: '0.1.0-alpha.10',
      status: 'ready',
    })
    await service.install()

    expect(states).toEqual([
      { currentVersion: '0.1.0-alpha.10', status: 'checking' },
      {
        availableVersion: '0.1.0-alpha.11',
        currentVersion: '0.1.0-alpha.10',
        percent: 0,
        status: 'downloading',
      },
      {
        availableVersion: '0.1.0-alpha.11',
        currentVersion: '0.1.0-alpha.10',
        percent: 43,
        status: 'downloading',
      },
      {
        availableVersion: '0.1.0-alpha.11',
        currentVersion: '0.1.0-alpha.10',
        status: 'ready',
      },
    ])
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('reports updater failures with fixed safe copy, never raw diagnostics', async () => {
    const updater = createFakeUpdater()
    updater.checkForUpdates = vi.fn(async () => {
      throw new Error('feed://internal/provider-path unavailable stack')
    })
    const service = createUpdateService({
      app: {
        getVersion: () => '0.1.0-alpha.10',
        isPackaged: true,
        platform: 'darwin',
      },
      updater,
    })
    const states: UpdateState[] = []

    service.onStateChanged((state) => states.push(state))
    await expect(service.check()).resolves.toEqual({
      currentVersion: '0.1.0-alpha.10',
      message: 'Update check failed',
      status: 'error',
    })

    expect(JSON.stringify(states)).not.toContain('feed://')
    expect(JSON.stringify(states)).not.toContain('provider-path')
    expect(states).toEqual([
      { currentVersion: '0.1.0-alpha.10', status: 'checking' },
      {
        currentVersion: '0.1.0-alpha.10',
        message: 'Update check failed',
        status: 'error',
      },
    ])
  })
})

type FakeUpdateBoundary = UpdateBoundary & {
  emit: (event: string, ...args: unknown[]) => void
}

function createFakeUpdater(): FakeUpdateBoundary {
  const listeners = new Map<string, (...args: unknown[]) => void>()

  return {
    checkForUpdates: vi.fn(),
    emit(event, ...args) {
      listeners.get(event)?.(...args)
    },
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener)
    }),
    quitAndInstall: vi.fn(),
    setAutoDownload: vi.fn(),
  }
}
