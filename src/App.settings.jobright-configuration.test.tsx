import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createApplication,
  createConnectorsApi,
  createListResult,
  createProfileApi,
  createSettingsApi,
  openSettingsPage,
} from './App.test-helpers'

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as Window & { applications?: unknown }).applications
  delete (window as Window & { sourcing?: unknown }).sourcing
  delete (window as Window & { settings?: unknown }).settings
  delete (window as Window & { profile?: unknown }).profile
  delete (window as Window & { workspace?: unknown }).workspace
  delete (window as Window & { valedictorianWindowChrome?: unknown }).valedictorianWindowChrome
})

describe('Jobright configuration', () => {
  it('saves enabled state without exposing request size or erasing persisted filters', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [instanceFixture()] })

    renderApp(connectorsApi)
    await openConnectors()

    expect(await screen.findByLabelText('Jobright connector enabled')).toBeChecked()
    expect(screen.queryByLabelText('Discovery page size')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Useful results target')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Requested detail-resolution attempts')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Jobright connector enabled'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))

    await waitFor(() => {
      expect(connectorsApi.update).toHaveBeenCalledWith({
        connectorInstanceId: 'jobright-default',
        enabled: false,
      })
    })
  })

  it('blocks Run while enabled state or earliest backfill is unsaved', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [instanceFixture()] })

    renderApp(connectorsApi, profileApi)
    await openConnectors()
    expect(await screen.findByText('Auth verified')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Jobright connector enabled'))
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()
    expect(connectorsApi.runs.trigger).not.toHaveBeenCalled()
    expect(connectorsApi.update).not.toHaveBeenCalled()
  })

  it('keeps Run disabled after saving disabled state and restores it after reenabling', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [instanceFixture()] })
    vi.mocked(connectorsApi.update)
      .mockResolvedValueOnce(instanceFixture({ enabled: false }))
      .mockResolvedValueOnce(instanceFixture({ enabled: true }))

    renderApp(connectorsApi, profileApi)
    await openConnectors()
    expect(await screen.findByText('Auth verified')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Jobright connector enabled'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))
    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()

    fireEvent.click(screen.getByLabelText('Jobright connector enabled'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))
    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()
  })

  it('persists enabled changes and retains earliest backfill and schedule controls after reload', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list)
      .mockResolvedValueOnce({ items: [instanceFixture()] })
      .mockResolvedValueOnce({ items: [instanceFixture({ enabled: false })] })

    const first = renderApp(connectorsApi)
    await openConnectors()
    fireEvent.click(await screen.findByLabelText('Jobright connector enabled'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Jobright settings' }))
    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalled())
    expect(screen.getByText('Earliest backfill date')).toBeInTheDocument()
    expect(screen.getByText('Automatic schedule')).toBeInTheDocument()

    first.unmount()
    renderApp(connectorsApi)
    await openConnectors()
    expect(await screen.findByLabelText('Jobright connector enabled')).not.toBeChecked()
    expect(screen.getByTestId('connector-earliest-backfill-value-jobright-default'))
      .toHaveTextContent('2026-07-02')
    expect(screen.getByText('Automatic schedule')).toBeInTheDocument()
  })
})

function instanceFixture(overrides: { enabled?: boolean } = {}) {
  return {
    id: 'jobright-default', connectorId: 'jobright.resolver', connectorVersion: '0.11.0',
    displayName: 'Jobright internslist', enabled: overrides.enabled ?? true,
    auth: [{
      id: 'jobright', mode: 'username_password' as const,
      label: 'Jobright username and password', configured: true,
    }],
    config: { discoveryCount: 100 },
    filters: { providerOwned: 'preserve-me' }, earliestBackfillDate: '2026-07-02',
    createdAt: '2026-07-09T15:00:00.000Z', updatedAt: '2026-07-09T15:00:00.000Z',
  }
}

function renderApp(connectorsApi: ReturnType<typeof createConnectorsApi>, profileApi = createProfileApi()) {
  return render(
    <App
      applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
      connectorsApi={connectorsApi}
      profileApi={profileApi}
      settingsApi={createSettingsApi()}
    />,
  )
}

async function openConnectors() {
  await openSettingsPage()
  const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
  fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))
}
