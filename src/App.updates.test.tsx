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
  it('shows download progress and lets users restart when an update is ready', async () => {
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
    expect(screen.queryByRole('button', { name: 'Restart to update' })).not.toBeInTheDocument()

    updatesApi.emitState({
      availableVersion: '0.1.0-alpha.11',
      currentVersion: '0.1.0-alpha.10',
      percent: 43,
      status: 'downloading',
    })

    expect(await screen.findByText('Downloading update 43%')).toBeInTheDocument()

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
})
