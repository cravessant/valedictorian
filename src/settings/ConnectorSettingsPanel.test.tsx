import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectorRetirementConflictError } from '@sparxie/sdk'

import {
  createConnectorsApi,
  createConnectorsApiWithJobrightDescriptor,
  createProfileApi,
} from '../App.test-helpers'
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

async function openConnectorEditor(displayName: string, instanceId: string) {
  fireEvent.click(await screen.findByRole('button', {
    name: `View ${displayName} details`,
  }))
  const dialog = await screen.findByRole('dialog', { name: `${displayName} details` })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Edit connector' }))
  return screen.findByTestId(`connector-instance-card-${instanceId}`)
}

describe('ConnectorSettingsPanel', () => {
  it('keeps the page compact and gates detailed editing behind a ShadCN dialog', async () => {
    const connectorsApi = createConnectorsApiWithJobrightDescriptor()
    await connectorsApi.create({
      id: 'jobright-modal',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.16.0',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [{
        id: 'jobright',
        mode: 'username_password',
        label: 'Jobright username and password',
        configured: true,
      }],
      config: { discoveryCount: 20 },
      filters: { country: 'US' },
      earliestBackfillDate: '2026-07-02',
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

    const summary = await screen.findByTestId('connector-instance-summary-jobright-modal')
    expect(within(summary).getByText('Jobright internslist')).toBeInTheDocument()
    expect(within(summary).getByText('Enabled')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Provider filters' })).not.toBeInTheDocument()

    const detailsTrigger = within(summary).getByRole('button', {
      name: 'View Jobright internslist details',
    })
    fireEvent.click(detailsTrigger)

    const dialog = await screen.findByRole('dialog', { name: 'Jobright internslist details' })
    expect(dialog).toHaveAttribute('data-slot', 'dialog-content')
    expect(within(dialog).getByRole('heading', { name: 'Provider filters' })).toBeInTheDocument()
    expect(within(dialog).getByRole('switch', { name: 'Jobright connector enabled' }))
      .toBeDisabled()
    expect(within(dialog).queryByRole('button', {
      name: 'Save changes',
    })).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit connector' }))
    expect(within(dialog).getByRole('switch', { name: 'Jobright connector enabled' }))
      .toBeEnabled()
    const editingBadge = within(dialog).getByText('Editing')
    const dialogTitle = within(dialog).getByRole('heading', {
      name: 'Jobright internslist details',
    })
    expect(editingBadge.parentElement).toBe(dialogTitle.parentElement)
    expect(within(dialog).getByRole('button', {
      name: 'Save changes',
    })).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close details' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(detailsTrigger).toHaveFocus()
  })

  it('keeps semantic region and heading order aligned within a connector card', async () => {
    const connectorsApi = createConnectorsApiWithJobrightDescriptor()
    await connectorsApi.create({
      id: 'jobright-focus',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.11.0',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [{
        id: 'jobright',
        mode: 'username_password',
        label: 'Jobright username and password',
        configured: true,
      }],
      config: {},
      filters: {},
      earliestBackfillDate: '2026-07-02',
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

    const card = await openConnectorEditor('Jobright internslist', 'jobright-focus')
    const headingNames = within(card).getAllByRole('heading').map((node) => node.textContent)
    expect(headingNames).toEqual([
      'Jobright internslist details',
      'Credentials',
      'Connector settings',
      'Synchronization configuration',
      'Provider filters',
      'Automatic schedule',
      'Execution and status',
      'Connector management',
    ])
    expect(within(card).getByRole('heading', {
      level: 2,
      name: 'Jobright internslist details',
    })).toBeInTheDocument()
    for (const name of [
      'Credentials',
      'Connector settings',
      'Automatic schedule',
      'Execution and status',
      'Connector management',
    ]) {
      expect(within(card).getByRole('heading', { level: 4, name })).toBeInTheDocument()
    }
    for (const name of ['Synchronization configuration', 'Provider filters']) {
      expect(within(card).getByRole('heading', { level: 5, name })).toBeInTheDocument()
    }

    const credentials = within(card).getByRole('region', {
      name: 'Jobright internslist Credentials',
    })
    const connectorSettings = within(card).getByRole('region', {
      name: 'Jobright internslist Connector settings',
    })
    const schedule = within(card).getByRole('region', { name: /schedule/i })
    const execution = within(card).getByRole('region', {
      name: 'Jobright internslist Execution and status',
    })
    const management = within(card).getByRole('region', {
      name: 'Jobright internslist Connector management',
    })

    expect(credentials.compareDocumentPosition(connectorSettings)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(connectorSettings.compareDocumentPosition(schedule)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(schedule.compareDocumentPosition(execution)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(execution.compareDocumentPosition(management)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const credentialsAction = within(credentials).getByRole('button', {
      name: /Add credentials|Update credentials/,
    })
    const enabledSwitch = within(connectorSettings).getByRole('switch', {
      name: 'Jobright connector enabled',
    })
    const runNow = within(execution).getByRole('button', { name: 'Run Jobright now' })
    const remove = within(management).getByRole('button', { name: 'Remove Jobright internslist' })

    expect(credentialsAction.compareDocumentPosition(enabledSwitch)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(enabledSwitch.compareDocumentPosition(runNow)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(runNow.compareDocumentPosition(remove)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    for (const control of [credentialsAction, enabledSwitch, remove]) {
      control.focus()
      expect(control).toHaveFocus()
    }
  })

  it('exposes distinct named regions with scoped configuration actions', async () => {
    const connectorsApi = createConnectorsApiWithJobrightDescriptor()
    await connectorsApi.create({
      id: 'jobright-regions',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.11.0',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [{
        id: 'jobright',
        mode: 'username_password',
        label: 'Jobright username and password',
        configured: true,
      }],
      config: {},
      filters: {},
      earliestBackfillDate: '2026-07-02',
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

    const card = await openConnectorEditor('Jobright internslist', 'jobright-regions')
    expect(within(card).getByRole('heading', { name: 'Jobright internslist details' }))
      .toBeInTheDocument()

    const credentials = within(card).getByRole('region', {
      name: 'Jobright internslist Credentials',
    })
    const connectorSettings = within(card).getByRole('region', {
      name: 'Jobright internslist Connector settings',
    })
    const synchronization = within(card).getByRole('region', {
      name: 'Jobright internslist synchronization configuration',
    })
    const providerFilters = within(card).getByRole('region', {
      name: 'Jobright internslist provider filters',
    })
    const schedule = within(card).getByRole('region', { name: /schedule/i })
    const execution = within(card).getByRole('region', { name: /execution|status/i })
    const management = within(card).getByRole('region', { name: /management|remove/i })

    expect(within(credentials).getByRole('heading', { name: 'Credentials' })).toBeInTheDocument()
    expect(within(synchronization).getByRole('heading', {
      level: 5,
      name: 'Synchronization configuration',
    })).toBeInTheDocument()
    expect(within(providerFilters).getByRole('heading', {
      level: 5,
      name: 'Provider filters',
    })).toBeInTheDocument()
    expect(within(schedule).getByRole('heading', { name: 'Automatic schedule' })).toBeInTheDocument()
    expect(within(execution).getByRole('heading', {
      name: /execution|status/i,
    })).toBeInTheDocument()
    expect(within(management).getByRole('heading', {
      name: /management/i,
    })).toBeInTheDocument()

    const editActions = within(card).getByRole('group', {
      name: 'Jobright internslist edit actions',
    })
    const save = within(editActions).getByRole('button', {
      name: /Save changes/i,
    })
    const discardLabel = /Discard changes/i
    fireEvent.click(within(connectorSettings).getByRole('switch', {
      name: 'Jobright connector enabled',
    }))
    expect(within(editActions).getByRole('button', { name: discardLabel })).toBeInTheDocument()
    expect(within(execution).queryByRole('button', { name: /Save changes/i }))
      .not.toBeInTheDocument()
    expect(within(execution).getByRole('button', { name: 'Run Jobright now' })).toBeInTheDocument()
    expect(within(management).getByRole('button', { name: 'Remove Jobright internslist' }))
      .toBeInTheDocument()
    expect(save).toBeInTheDocument()

    fireEvent.click(within(management).getByRole('button', { name: 'Remove Jobright internslist' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('keeps connector-settings and schedule drafts isolated across discard', async () => {
    const connectorsApi = createConnectorsApiWithJobrightDescriptor()
    await connectorsApi.create({
      id: 'jobright-isolation',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.11.0',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [{
        id: 'jobright',
        mode: 'username_password',
        label: 'Jobright username and password',
        configured: true,
      }],
      config: { discoveryCount: 20 },
      filters: {},
      earliestBackfillDate: '2026-07-02',
    })
    const scheduleApi = {
      getCapabilities: vi.fn(async () => ({
        connectorScheduling: {
          available: true as const,
          supportedCadences: ['interval', 'daily', 'weekly'] as const,
          minimumIntervalMinutes: 15,
          maximumCatchUpAgeMinutes: 24 * 60,
          timezoneModel: 'iana' as const,
          missedOccurrencePolicy: 'coalesce_one' as const,
        },
      })),
      getSchedule: vi.fn(async () => ({
        id: 'schedule-1',
        connectorInstanceId: 'jobright-isolation',
        revision: 'rev-1',
        state: 'enabled' as const,
        cadence: { kind: 'interval' as const, everyMinutes: 60 },
        timezone: 'UTC',
        nextEligibleAt: '2026-07-12T13:00:00.000Z',
        createdAt: '2026-07-12T12:00:00.000Z',
        updatedAt: '2026-07-12T12:00:00.000Z',
        lastOccurrence: null,
        lastRun: null,
      })),
      upsertSchedule: vi.fn(async () => {
        throw new Error('unused')
      }),
      pauseSchedule: vi.fn(async () => {
        throw new Error('unused')
      }),
      resumeSchedule: vi.fn(async () => {
        throw new Error('unused')
      }),
      deleteSchedule: vi.fn(async () => {
        throw new Error('unused')
      }),
    }

    render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={scheduleApi}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-1"
      />,
    )

    const card = await openConnectorEditor('Jobright internslist', 'jobright-isolation')
    const discovery = await within(card).findByLabelText('Discovery count')
    fireEvent.change(discovery, { target: { value: '35' } })
    fireEvent.change(within(card).getByLabelText('Schedule mode'), {
      target: { value: 'preset' },
    })
    fireEvent.change(within(card).getByLabelText('Preset'), {
      target: { value: 'interval-30' },
    })

    expect(discovery).toHaveValue(35)
    expect(within(card).getByText(/Draft:\s*Common preset/i)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Discard changes' })).toBeInTheDocument()

    fireEvent.click(within(card).getByRole('button', {
      name: 'Discard changes',
    }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Discard changes',
    }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const reopened = await openConnectorEditor('Jobright internslist', 'jobright-isolation')
    const reopenedDiscovery = await within(reopened).findByLabelText('Discovery count')
    expect(reopenedDiscovery).toHaveValue(20)
    expect(within(reopened).getByLabelText('Schedule mode')).toHaveValue('preset')
    expect(within(reopened).getByLabelText('Preset')).toHaveValue('interval-60')
    expect(within(reopened).queryByText(/Draft:/i)).not.toBeInTheDocument()

    fireEvent.change(reopenedDiscovery, { target: { value: '40' } })
    fireEvent.click(within(reopened).getByRole('button', {
      name: 'Discard changes',
    }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Discard changes',
    }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const clean = await openConnectorEditor('Jobright internslist', 'jobright-isolation')
    expect(await within(clean).findByLabelText('Discovery count')).toHaveValue(20)
    expect(within(clean).queryByText(/Draft:/i)).not.toBeInTheDocument()
    expect(within(clean).getByRole('button', { name: 'Close details' })).toBeInTheDocument()
  })

  it('saves connector settings and the schedule from one global action', async () => {
    const instance = {
      id: 'jobright-unified-save',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.11.0',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [],
      config: { discoveryCount: 20 },
      filters: {},
      earliestBackfillDate: '2026-07-02',
      createdAt: '2026-07-09T15:00:00.000Z',
      updatedAt: '2026-07-09T15:00:00.000Z',
    }
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({ items: [instance] })
    vi.mocked(connectorsApi.update).mockResolvedValue({
      ...instance,
      enabled: false,
    })
    const savedSchedule = {
      id: 'schedule-unified',
      connectorInstanceId: instance.id,
      revision: 'rev-1',
      state: 'enabled' as const,
      cadence: { kind: 'interval' as const, everyMinutes: 30 },
      timezone: 'UTC',
      nextEligibleAt: '2026-07-12T13:00:00.000Z',
      createdAt: '2026-07-12T12:00:00.000Z',
      updatedAt: '2026-07-12T12:00:00.000Z',
      lastOccurrence: null,
      lastRun: null,
    }
    const scheduleApi = {
      getCapabilities: vi.fn(async () => ({
        connectorScheduling: {
          available: true as const,
          supportedCadences: ['interval', 'daily', 'weekly'] as const,
          minimumIntervalMinutes: 15,
          maximumCatchUpAgeMinutes: 24 * 60,
          timezoneModel: 'iana' as const,
          missedOccurrencePolicy: 'coalesce_one' as const,
        },
      })),
      getSchedule: vi.fn(async () => null),
      upsertSchedule: vi.fn(async () => savedSchedule),
      pauseSchedule: vi.fn(),
      resumeSchedule: vi.fn(),
      deleteSchedule: vi.fn(),
    }

    render(
      <ConnectorSettingsPanel
        connectorsApi={connectorsApi}
        connectorScheduleApi={scheduleApi}
        onRunSettled={vi.fn()}
        profileApi={createProfileApi()}
        workspaceId="workspace-1"
      />,
    )

    const card = await openConnectorEditor('Jobright internslist', instance.id)
    fireEvent.click(within(card).getByRole('switch', { name: 'Jobright connector enabled' }))
    fireEvent.change(within(card).getByLabelText('Schedule mode'), {
      target: { value: 'preset' },
    })
    fireEvent.change(within(card).getByLabelText('Preset'), {
      target: { value: 'interval-30' },
    })

    expect(within(card).queryByRole('button', { name: 'Save schedule' })).not.toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledWith(expect.objectContaining({
      connectorInstanceId: instance.id,
      enabled: false,
    })))
    await waitFor(() => expect(scheduleApi.upsertSchedule).toHaveBeenCalledWith({
      connectorInstanceId: instance.id,
      expectedRevision: null,
      state: 'enabled',
      cadence: { kind: 'interval', everyMinutes: 30 },
      timezone: 'UTC',
    }))
  })

  it('saves an accessible enabled switch for every connector type', async () => {
    const connectorsApi = createConnectorsApi()
    await connectorsApi.create({
      id: 'fixture-connector', connectorId: 'fixture.jobs', connectorVersion: '1.0.0',
      displayName: 'Fixture jobs', enabled: true, auth: [], config: {}, filters: {},
    })
    await connectorsApi.create({
      id: 'fixture-backup', connectorId: 'fixture.backup', connectorVersion: '1.0.0',
      displayName: 'Fixture backup', enabled: true, auth: [], config: {}, filters: {},
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

    expect(await screen.findByTestId('connector-instance-summary-fixture-connector'))
      .toBeInTheDocument()
    expect(screen.getByTestId('connector-instance-summary-fixture-backup')).toBeInTheDocument()
    const card = await openConnectorEditor('Fixture jobs', 'fixture-connector')
    const enabled = within(card).getByRole('switch', { name: 'Fixture jobs connector enabled' })
    expect(within(card).getByRole('region', { name: 'Fixture jobs Credentials' }))
      .toBeInTheDocument()
    expect(within(card).getByRole('region', { name: 'Fixture jobs Connector settings' }))
      .toBeInTheDocument()
    expect(within(card).getByRole('region', { name: 'Fixture jobs Connector management' }))
      .toBeInTheDocument()
    expect(enabled).toBeChecked()
    fireEvent.click(enabled)
    fireEvent.click(within(card).getByRole('button', {
      name: 'Save changes',
    }))

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

    const card = await openConnectorEditor('Fixture jobs', 'fixture-connector')
    fireEvent.click(within(card).getByRole('button', { name: 'Remove Fixture jobs' }))

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

    const card = await openConnectorEditor('Fixture jobs', 'fixture-connector')
    fireEvent.click(within(card).getByRole('button', { name: 'Remove Fixture jobs' }))
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
