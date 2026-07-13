import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectorRetirementConflictError } from 'sparxie'

import { createConnectorsApi, createProfileApi } from '../App.test-helpers'
import type { ConnectorScheduleUiApi } from './connector-schedule.types'
import { ConnectorSettingsPanel } from './ConnectorSettingsPanel'

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

describe('ConnectorSettingsPanel', () => {
  it('saves an accessible enabled switch for every connector type', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'fixture-connector', connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
      displayName: 'Fixture jobs', enabled: true, auth: [], config: {}, filters: {},
    })
    render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={createUnavailableScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-1"
      />,
    )

    const enabled = await screen.findByRole('switch', { name: 'Fixture jobs connector enabled' })
    expect(enabled).toBeChecked()
    fireEvent.click(enabled)
    fireEvent.click(screen.getByRole('button', { name: 'Save Fixture jobs settings' }))

    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledWith({
      connectorInstanceId: 'fixture-connector',
      enabled: false,
    }))
    expect(enabled).not.toBeChecked()
  })

  it('requires confirmation before removing an instance and preserves historical lineage', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'fixture-connector', connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
      displayName: 'Fixture jobs', enabled: true, auth: [], config: {}, filters: {},
    })
    render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={createUnavailableScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-1"
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Fixture jobs' }))

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: 'Remove Fixture jobs?' })).toBeInTheDocument()
    expect(within(dialog).getByText(/historical runs and sourcing lineage are preserved/i)).toBeInTheDocument()
    expect(connectorsApi.remove).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove connector' }))

    await waitFor(() => expect(connectorsApi.remove).toHaveBeenCalledWith({
      connectorInstanceId: 'fixture-connector',
    }))
    await waitFor(() => expect(screen.queryByText('Fixture jobs')).not.toBeInTheDocument())
  })

  it('shows a sanitized action for an active-work retirement conflict', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'fixture-connector', connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
      displayName: 'Fixture jobs', enabled: true, auth: [], config: {}, filters: {},
    })
    vi.mocked(connectorsApi.remove).mockRejectedValueOnce(new ConnectorRetirementConflictError({
      code: 'connector_retirement_active_work_conflict',
      connectorInstanceId: 'fixture-connector',
      message: 'sensitive backend diagnostic',
      cancellationRequired: true,
      activeRuns: [{ connectorRunId: 'run-queued', status: 'queued' }],
    }))
    render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={createUnavailableScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-1"
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Fixture jobs' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Remove connector',
    }))

    expect(await screen.findByText(
      'Cancel queued or running connector work before removing this connector.',
    )).toBeInTheDocument()
    expect(screen.queryByText('sensitive backend diagnostic')).not.toBeInTheDocument()
    expect(screen.getByText('Fixture jobs')).toBeInTheDocument()
  })

  it('renders Empty for zero connector instances while preserving the Add Jobright card', async () => {
    render(
      <ConnectorSettingsPanel
        connectorsApi={createConnectorsApi()}
        connectorScheduleApi={createUnavailableScheduleApi()}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-1"
      />,
    )

    const addButton = await screen.findByRole('button', { name: 'Add Jobright connector' })
    expect(addButton).toBeEnabled()
    expect(screen.getByRole('heading', { name: 'Jobright internslist' })).toBeInTheDocument()

    const empty = screen.getByLabelText('Empty connector instances')
    expect(empty).toHaveAttribute('data-slot', 'empty')
    expect(within(empty).getByRole('heading', { name: 'No connector instances' })).toBeInTheDocument()
    expect(
      within(empty).getByText(
        'Add the Jobright connector above to configure authentication and schedules.',
      ),
    ).toBeInTheDocument()
    expect(within(empty).queryByRole('button', { name: 'Add Jobright connector' })).not.toBeInTheDocument()
    expect(screen.queryByText('No connector instances configured.')).not.toBeInTheDocument()
  })
})
