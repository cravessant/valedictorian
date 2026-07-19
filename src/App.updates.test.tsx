import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createApplication,
  createListResult,
  createSettingsApi,
  createUpdatesApi,
} from './App.test-helpers'

afterEach(() => {
  cleanup()
})

function trackUnhandledRejections() {
  const reasons: unknown[] = []
  const onUnhandled = (event: PromiseRejectionEvent) => {
    reasons.push(event.reason)
    event.preventDefault()
  }
  window.addEventListener('unhandledrejection', onUnhandled)
  return {
    reasons,
    stop() {
      window.removeEventListener('unhandledrejection', onUnhandled)
    },
  }
}

async function expectSafeUpdaterErrorOwner(canary: RegExp) {
  const owner = await screen.findByRole('alert')
  expect(owner).toHaveAttribute('aria-live', 'polite')
  expect(owner).toHaveTextContent('Update check failed')
  expect(owner).toHaveTextContent('Retry')
  expect(screen.queryByText(canary)).not.toBeInTheDocument()
  return owner
}

function ownerRetryControl(owner: HTMLElement) {
  if (owner.matches('button')) {
    return owner
  }
  const nested = owner.querySelector('button')
  if (!nested) {
    throw new Error('Expected updater error owner to expose a Retry control')
  }
  return nested
}

describe('App updates', () => {
  it('lets users manually check for updates from idle and unavailable states', async () => {
    const updatesApi = createUpdatesApi({
      currentVersion: '0.1.0-alpha.10',
      status: 'idle',
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
        updatesApi={updatesApi}
      />,
    )

    expect(await screen.findByRole('table', { name: 'Applications' })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }))

    await waitFor(() => {
      expect(updatesApi.check).toHaveBeenCalledTimes(1)
    })

    updatesApi.emitState({
      currentVersion: '0.1.0-alpha.10',
      status: 'unavailable',
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }))

    await waitFor(() => {
      expect(updatesApi.check).toHaveBeenCalledTimes(2)
    })
  })

  it('shows checking state without restart or duplicate install actions', async () => {
    const updatesApi = createUpdatesApi({
      currentVersion: '0.1.0-alpha.10',
      status: 'checking',
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
        updatesApi={updatesApi}
      />,
    )

    expect(await screen.findByText('Checking for updates')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Checking for updates' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restart to update' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check for updates' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Checking for updates' })).not.toBeInTheDocument()
    expect(updatesApi.install).not.toHaveBeenCalled()
  })

  it('shows download progress and lets users restart from the topbar when an update is ready', async () => {
    const updatesApi = createUpdatesApi({
      currentVersion: '0.1.0-alpha.10',
      status: 'idle',
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
        updatesApi={updatesApi}
      />,
    )

    expect(await screen.findByRole('table', { name: 'Applications' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))

    await waitFor(() => {
      expect(updatesApi.check).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByRole('button', { name: 'Restart to update' })).not.toBeInTheDocument()

    updatesApi.emitState({
      availableVersion: '0.1.0-alpha.11',
      currentVersion: '0.1.0-alpha.10',
      percent: 43,
      status: 'downloading',
    })

    expect(await screen.findByText('Downloading update 43%')).toBeInTheDocument()
    const progressbar = screen.getByRole('progressbar', { name: 'Downloading update' })
    expect(progressbar).toHaveAttribute('aria-valuenow', '43')

    updatesApi.emitState({
      availableVersion: '0.1.0-alpha.11',
      currentVersion: '0.1.0-alpha.10',
      status: 'ready',
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Restart to update' }))

    await waitFor(() => {
      expect(updatesApi.install).toHaveBeenCalledTimes(1)
    })
  })

  it('clamps overflowed download progress text and progressbar to 100', async () => {
    const updatesApi = createUpdatesApi({
      availableVersion: '0.1.0-alpha.11',
      currentVersion: '0.1.0-alpha.10',
      percent: 140,
      status: 'downloading',
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
        updatesApi={updatesApi}
      />,
    )

    expect(await screen.findByText('Downloading update 100%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Downloading update' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
  })

  it('shows an update-ready toast once per available version with a restart action', async () => {
    const updatesApi = createUpdatesApi({
      currentVersion: '0.1.0-alpha.10',
      status: 'idle',
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
        updatesApi={updatesApi}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })

    updatesApi.emitState({
      availableVersion: '0.1.0-alpha.11',
      currentVersion: '0.1.0-alpha.10',
      status: 'ready',
    })

    expect(await screen.findByText('Update ready')).toBeInTheDocument()
    expect(screen.getByText('Valedictorian 0.1.0-alpha.11 has downloaded.')).toBeInTheDocument()

    updatesApi.emitState({
      availableVersion: '0.1.0-alpha.11',
      currentVersion: '0.1.0-alpha.10',
      status: 'ready',
    })

    await waitFor(() => {
      expect(screen.getAllByText('Update ready')).toHaveLength(1)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))

    await waitFor(() => {
      expect(updatesApi.install).toHaveBeenCalledTimes(1)
    })
  })

  it('shows update errors with a retry action', async () => {
    const updatesApi = createUpdatesApi({
      currentVersion: '0.1.0-alpha.10',
      message: 'feed unavailable',
      status: 'error',
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
        updatesApi={updatesApi}
      />,
    )

    expect(await screen.findByText('Update check failed')).toBeInTheDocument()
    expect(screen.queryByText('feed unavailable')).not.toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => {
      expect(updatesApi.check).toHaveBeenCalledTimes(1)
    })
  })

  it('hides update controls when updates are disabled', async () => {
    const updatesApi = createUpdatesApi({
      currentVersion: '0.1.0-alpha.10',
      message: 'Updates are only available in signed packaged Mac builds.',
      status: 'disabled',
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={createSettingsApi()}
        updatesApi={updatesApi}
      />,
    )

    expect(await screen.findByRole('table', { name: 'Applications' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check for updates' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restart to update' })).not.toBeInTheDocument()
    expect(screen.queryByText('Updates are only available in signed packaged Mac builds.')).not.toBeInTheDocument()
  })
})

describe('App updates renderer IPC rejection ownership', () => {
  it('turns initial getState rejection into one safe updater error owner', async () => {
    const canary = /CANARY_UPDATE_GETSTATE \/secret\/feed/
    const tracked = trackUnhandledRejections()
    const updatesApi = createUpdatesApi({
      currentVersion: '0.1.0-alpha.10',
      status: 'idle',
    })
    vi.mocked(updatesApi.getState).mockRejectedValueOnce(
      new Error('CANARY_UPDATE_GETSTATE /secret/feed'),
    )

    try {
      render(
        <App
          applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
          settingsApi={createSettingsApi()}
          updatesApi={updatesApi}
        />,
      )

      await screen.findByRole('table', { name: 'Applications' })
      const owner = await expectSafeUpdaterErrorOwner(canary)
      expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1)
      fireEvent.click(ownerRetryControl(owner))
      await waitFor(() => {
        expect(updatesApi.check).toHaveBeenCalledTimes(1)
      })
      expect(tracked.reasons).toEqual([])
    } finally {
      tracked.stop()
    }
  })

  it('turns Check/Retry rejection into the same safe error owner with actionable Retry', async () => {
    const canary = /CANARY_UPDATE_CHECK \/secret\/feed/
    const tracked = trackUnhandledRejections()
    const updatesApi = createUpdatesApi({
      currentVersion: '0.1.0-alpha.10',
      status: 'idle',
    })
    vi.mocked(updatesApi.check).mockRejectedValueOnce(
      new Error('CANARY_UPDATE_CHECK /secret/feed'),
    )

    try {
      render(
        <App
          applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
          settingsApi={createSettingsApi()}
          updatesApi={updatesApi}
        />,
      )

      expect(await screen.findByRole('button', { name: 'Check for updates' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))

      const owner = await expectSafeUpdaterErrorOwner(canary)
      expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1)
      fireEvent.click(ownerRetryControl(owner))
      await waitFor(() => {
        expect(updatesApi.check).toHaveBeenCalledTimes(2)
      })
      expect(tracked.reasons).toEqual([])
    } finally {
      tracked.stop()
    }
  })

  it('turns Restart install rejection into a recoverable check-Retry owner', async () => {
    const canary = /CANARY_UPDATE_INSTALL \/secret\/feed/
    const tracked = trackUnhandledRejections()
    const updatesApi = createUpdatesApi({
      currentVersion: '0.1.0-alpha.10',
      status: 'idle',
    })
    vi.mocked(updatesApi.install).mockRejectedValueOnce(
      new Error('CANARY_UPDATE_INSTALL /secret/feed'),
    )

    try {
      render(
        <App
          applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
          settingsApi={createSettingsApi()}
          updatesApi={updatesApi}
        />,
      )

      await screen.findByRole('table', { name: 'Applications' })
      updatesApi.emitState({
        availableVersion: '0.1.0-alpha.11',
        currentVersion: '0.1.0-alpha.10',
        status: 'ready',
      })
      fireEvent.click(await screen.findByRole('button', { name: 'Restart to update' }))

      const owner = await expectSafeUpdaterErrorOwner(canary)
      expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1)
      expect(screen.queryByRole('button', { name: 'Restart to update' })).not.toBeInTheDocument()
      fireEvent.click(ownerRetryControl(owner))
      await waitFor(() => {
        expect(updatesApi.check).toHaveBeenCalledTimes(1)
      })
      expect(tracked.reasons).toEqual([])
    } finally {
      tracked.stop()
    }
  })
})
