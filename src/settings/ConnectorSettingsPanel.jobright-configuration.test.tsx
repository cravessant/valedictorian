import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createConnectorsApi,
  createProfileApi,
} from '../App.test-helpers'
import type { ConnectorScheduleUiApi } from './connector-schedule.types'
import type { ConnectorSettingsUiApi } from './connector-settings.types'
import { ConnectorSettingsPanel } from './ConnectorSettingsPanel'

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(cleanup)

function createUnavailableScheduleApi(): ConnectorScheduleUiApi {
  return {
    getCapabilities: vi.fn(async () => ({
      connectorScheduling: { available: false as const },
    })),
    getSchedule: vi.fn(async () => null),
    upsertSchedule: vi.fn(async () => {
      throw new Error('unavailable')
    }),
    pauseSchedule: vi.fn(async () => {
      throw new Error('unavailable')
    }),
    resumeSchedule: vi.fn(async () => {
      throw new Error('unavailable')
    }),
    deleteSchedule: vi.fn(async () => {
      throw new Error('unavailable')
    }),
  }
}

async function openConnectorEditor(displayName = 'Jobright internslist') {
  fireEvent.click(await screen.findByRole('button', {
    name: `View ${displayName} details`,
  }))
  const dialog = await screen.findByRole('dialog', { name: `${displayName} details` })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Edit connector' }))
  await within(dialog).findByRole('button', { name: 'Close details' })
  return dialog
}

function instanceFixture(overrides: { enabled?: boolean } = {}) {
  return {
    id: 'jobright-default',
    connectorId: 'jobright.resolver',
    connectorVersion: '0.11.0',
    displayName: 'Jobright internslist',
    enabled: overrides.enabled ?? true,
    auth: [{
      id: 'jobright',
      mode: 'username_password' as const,
      label: 'Jobright username and password',
      configured: true,
    }],
    config: { discoveryCount: 100 },
    filters: { providerOwned: 'preserve-me' },
    earliestBackfillDate: '2026-07-02',
    createdAt: '2026-07-09T15:00:00.000Z',
    updatedAt: '2026-07-09T15:00:00.000Z',
  }
}

function renderPanel(
  connectorsApi: ConnectorSettingsUiApi,
  profileApi = createProfileApi(),
) {
  return render(
    <ConnectorSettingsPanel
      connectorsApi={connectorsApi}
      connectorScheduleApi={createUnavailableScheduleApi()}
      onRunSettled={vi.fn()}
      profileApi={profileApi}
      workspaceId="workspace-1"
    />,
  )
}

describe('ConnectorSettingsPanel Jobright configuration', () => {
  it('saves enabled state without exposing request size or erasing persisted filters', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [instanceFixture()] })

    renderPanel(connectorsApi)
    await openConnectorEditor()

    expect(await screen.findByLabelText('Jobright connector enabled')).toBeChecked()
    expect(screen.queryByLabelText('Discovery page size')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Useful results target')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Requested detail-resolution attempts')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Jobright connector enabled'))
    fireEvent.click(screen.getByRole('button', {
      name: 'Save changes',
    }))

    await waitFor(() => {
      expect(connectorsApi.update).toHaveBeenCalledWith({
        connectorInstanceId: 'jobright-default',
        enabled: false,
      })
    })
  })

  it('keeps Run disabled after saving disabled state and restores it after reenabling', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [instanceFixture()] })
    vi.mocked(connectorsApi.update)
      .mockResolvedValueOnce(instanceFixture({ enabled: false }))
      .mockResolvedValueOnce(instanceFixture({ enabled: true }))

    renderPanel(connectorsApi, profileApi)
    await openConnectorEditor()
    expect(await screen.findByText('Auth verified')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Jobright connector enabled'))
    fireEvent.click(screen.getByRole('button', {
      name: 'Save changes',
    }))
    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Edit connector' }))
    fireEvent.click(screen.getByLabelText('Jobright connector enabled'))
    fireEvent.click(screen.getByRole('button', {
      name: 'Save changes',
    }))
    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()
  })

  it('shows the persisted date, saves calendar changes, discards drafts, and gates Run', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'jobright-a',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.11.0',
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
      connectorVersion: '0.11.0',
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

    renderPanel(connectorsApi)

    const dialogB = await openConnectorEditor('Jobright B')
    expect(within(dialogB).getByTestId('connector-earliest-backfill-value-jobright-b'))
      .toHaveTextContent('2026-06-01')
    fireEvent.click(within(dialogB).getByRole('button', { name: 'Close' }))

    const cardA = await openConnectorEditor('Jobright A')
    expect(within(cardA).getByTestId('connector-earliest-backfill-value-jobright-a'))
      .toHaveTextContent('2026-07-04')
    await waitFor(() => {
      expect(within(cardA).getAllByText('Auth verified').length).toBeGreaterThan(0)
    })

    fireEvent.click(within(cardA).getByRole('button', {
      name: 'Choose earliest backfill date for jobright-a',
    }))
    const julyGrid = await screen.findByRole('grid')
    const dayOne = within(julyGrid).getAllByRole('gridcell', { name: '1' })
      .find((cell) => !cell.hasAttribute('disabled') && cell.getAttribute('aria-disabled') !== 'true')
    expect(dayOne).toBeTruthy()
    fireEvent.click(dayOne!)
    await waitFor(() => {
      expect(within(cardA).getByTestId('connector-earliest-backfill-value-jobright-a'))
        .toHaveTextContent('2026-07-01')
    })
    expect(within(cardA).getByRole('button', { name: 'Run Jobright now' })).toBeDisabled()

    fireEvent.click(within(cardA).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      expect(connectorsApi.update).toHaveBeenCalledWith(expect.objectContaining({
        connectorInstanceId: 'jobright-a',
        earliestBackfillDate: '2026-07-01',
      }))
    })
    await waitFor(() => {
      expect(within(cardA).getByRole('button', { name: 'Run Jobright now' })).not.toBeDisabled()
    })

    fireEvent.click(within(cardA).getByRole('button', { name: 'Edit connector' }))
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
    fireEvent.click(within(cardA).getByRole('button', { name: 'Discard changes' }))
    fireEvent.click(within(await screen.findByRole('alertdialog', {
      name: 'Discard unsaved changes?',
    })).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const reopenedCardA = await openConnectorEditor('Jobright A')
    await waitFor(() => {
      expect(within(reopenedCardA).getByTestId('connector-earliest-backfill-value-jobright-a'))
        .toHaveTextContent('2026-07-01')
    })
  })
})
