import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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
    expect(screen.queryByRole('button', { name: 'Restart to update' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check for updates' })).not.toBeInTheDocument()
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

    expect(await screen.findByText('feed unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))

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
