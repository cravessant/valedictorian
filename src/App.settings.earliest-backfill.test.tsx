import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  createApplication,
  createConnectorsApi,
  createListResult,
  createSettingsApi,
  openSettingsPage,
} from './App.test-helpers'

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('connector earliest backfill date UI', () => {
  it('shows the persisted date, saves calendar changes, discards drafts, and gates Run', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'jobright-a',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.10.0',
      displayName: 'Jobright A',
      enabled: true,
      auth: [{
        id: 'jobright',
        mode: 'username_password',
        label: 'Jobright username and password',
        secretKey: 'connector_jobright_credentials_jobright_a',
      }],
      earliestBackfillDate: '2026-07-04',
    })
    await connectorsApi.create({
      id: 'jobright-b',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.10.0',
      displayName: 'Jobright B',
      enabled: true,
      auth: [{
        id: 'jobright',
        mode: 'username_password',
        label: 'Jobright username and password',
        secretKey: 'connector_jobright_credentials_jobright_b',
      }],
      earliestBackfillDate: '2026-06-01',
    })
    vi.mocked(connectorsApi.create).mockClear()
    vi.mocked(connectorsApi.update).mockClear()
    vi.mocked(connectorsApi.status.reconnect).mockImplementation(async (input) => ({
      connectorInstanceId: input.connectorInstanceId,
      message: 'Auth verified',
      reason: 'jobright_auth_ready',
      status: 'ready',
    }))

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        settingsApi={createSettingsApi()}
      />,
    )

    await openSettingsPage()
    const navigation = screen.getByRole('complementary', { name: 'Settings navigation' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Connectors' }))

    const cardA = await screen.findByTestId('connector-instance-card-jobright-a')
    const cardB = screen.getByTestId('connector-instance-card-jobright-b')
    expect(within(cardA).getByTestId('connector-earliest-backfill-value-jobright-a')).toHaveTextContent('2026-07-04')
    expect(within(cardB).getByTestId('connector-earliest-backfill-value-jobright-b')).toHaveTextContent('2026-06-01')
    await waitFor(() => {
      expect(within(cardA).getAllByText('Auth verified').length).toBeGreaterThan(0)
    })

    // Open calendar and select the first enabled day shown for July 2026.
    fireEvent.click(within(cardA).getByRole('button', {
      name: 'Choose earliest backfill date for jobright-a',
    }))
    const julyGrid = await screen.findByRole('grid')
    // Selected date is 2026-07-04; choose day 1 in the same month.
    const dayOne = within(julyGrid).getAllByRole('gridcell', { name: '1' })
      .find((cell) => !cell.hasAttribute('disabled') && cell.getAttribute('aria-disabled') !== 'true')
    expect(dayOne).toBeTruthy()
    fireEvent.click(dayOne!)
    await waitFor(() => {
      expect(within(cardA).getByTestId('connector-earliest-backfill-value-jobright-a'))
        .toHaveTextContent('2026-07-01')
    })
    expect(within(cardB).getByTestId('connector-earliest-backfill-value-jobright-b'))
      .toHaveTextContent('2026-06-01')
    expect(within(cardA).getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()

    fireEvent.click(within(cardA).getByRole('button', { name: 'Save Jobright settings' }))
    await waitFor(() => {
      expect(connectorsApi.update).toHaveBeenCalledWith(expect.objectContaining({
        connectorInstanceId: 'jobright-a',
        earliestBackfillDate: '2026-07-01',
      }))
    })
    await waitFor(() => {
      expect(within(cardA).getByRole('button', { name: 'Run Jobright now' })).not.toBeDisabled()
    })

    fireEvent.click(within(cardA).getByRole('button', {
      name: 'Choose earliest backfill date for jobright-a',
    }))
    const openGrid = await screen.findByRole('grid')
    const dayTwo = within(openGrid).getAllByRole('gridcell', { name: '2' })
      .find((cell) => !cell.hasAttribute('disabled') && cell.getAttribute('aria-disabled') !== 'true')
    expect(dayTwo).toBeTruthy()
    fireEvent.click(dayTwo!)
    await waitFor(() => {
      expect(within(cardA).getByTestId('connector-earliest-backfill-value-jobright-a'))
        .toHaveTextContent('2026-07-02')
    })
    fireEvent.click(within(cardA).getByRole('button', { name: 'Discard unsaved settings' }))
    await waitFor(() => {
      expect(within(cardA).getByTestId('connector-earliest-backfill-value-jobright-a'))
        .toHaveTextContent('2026-07-01')
    })
  })
})
