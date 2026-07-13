import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  ValedictorianHttpError,
  type ConnectorScheduleSummary,
  type ConnectorSchedulingCapability,
} from 'sparxie'
import App from './App'
import {
  createApplication,
  createConnectorsApi,
  createListResult,
  createProfileApi,
  createSettingsApi,
  createWorkspaceApi,
  createWorkspaceSummary,
  lastCreatedConnectorInstanceId,
  selectComboboxOption,
  stubCmdkEnvironment,
} from './App.test-helpers'
import type { ConnectorScheduleUiApi } from './settings/connector-schedule.types'
import {
  CONNECTOR_SCHEDULE_LOAD_FAILURE_EXPLANATION,
  CONNECTOR_SCHEDULE_UNAVAILABLE_EXPLANATION,
} from './settings/connector-schedule.helpers'

beforeEach(() => {
  stubCmdkEnvironment()
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
  delete (window as Window & { valedictorianHttp?: unknown }).valedictorianHttp
})

function openConnectorsOverview() {
  const appNavigation = within(
    screen.getByRole('complementary', { name: 'Application navigation' }),
  ).getByRole('navigation', { name: 'Application views' })
  fireEvent.click(within(appNavigation).getByRole('button', { name: 'Connectors' }))
  fireEvent.click(within(appNavigation).getByRole('button', { name: 'Overview' }))
  return appNavigation
}

const availableSchedulingCapability: Extract<ConnectorSchedulingCapability, { available: true }> = {
  available: true,
  supportedCadences: ['interval', 'daily', 'weekly'],
  minimumIntervalMinutes: 15,
  maximumCatchUpAgeMinutes: 24 * 60,
  timezoneModel: 'iana',
  missedOccurrencePolicy: 'coalesce_one',
}

function createScheduleSummary(
  overrides: Partial<ConnectorScheduleSummary> = {},
): ConnectorScheduleSummary {
  return {
    id: 'schedule-1',
    connectorInstanceId: 'jobright-default',
    revision: 'rev-1',
    state: 'enabled',
    cadence: { kind: 'interval', everyMinutes: 60 },
    timezone: 'UTC',
    nextEligibleAt: '2026-07-12T13:00:00.000Z',
    createdAt: '2026-07-12T12:00:00.000Z',
    updatedAt: '2026-07-12T12:00:00.000Z',
    lastOccurrence: null,
    lastRun: null,
    ...overrides,
  }
}

type ScheduleApiMocks = {
  getCapabilities: Mock
  getSchedule: Mock
  upsertSchedule: Mock
  pauseSchedule: Mock
  resumeSchedule: Mock
  deleteSchedule: Mock
}

function createUnavailableScheduleApi(): ScheduleApiMocks {
  return {
    getCapabilities: vi.fn(async () => ({
      connectorScheduling: { available: false as const },
    })),
    getSchedule: vi.fn(async () => null),
    upsertSchedule: vi.fn(async () => {
      throw new Error('upsert should not be called')
    }),
    pauseSchedule: vi.fn(async () => {
      throw new Error('pause should not be called')
    }),
    resumeSchedule: vi.fn(async () => {
      throw new Error('resume should not be called')
    }),
    deleteSchedule: vi.fn(async () => {
      throw new Error('delete should not be called')
    }),
  }
}

function createAvailableScheduleApi(
  options: {
    capability?: Extract<ConnectorSchedulingCapability, { available: true }>
    initialSchedule?: ConnectorScheduleSummary | null
    onUpsert?: ConnectorScheduleUiApi['upsertSchedule']
  } = {},
): ScheduleApiMocks & { store: { schedule: ConnectorScheduleSummary | null } } {
  const store: { schedule: ConnectorScheduleSummary | null } = {
    schedule: options.initialSchedule ?? null,
  }
  const capability = options.capability ?? availableSchedulingCapability

  return {
    store,
    getCapabilities: vi.fn(async () => ({
      connectorScheduling: capability,
    })),
    getSchedule: vi.fn(async () => store.schedule),
    upsertSchedule: vi.fn(async (input) => {
      if (options.onUpsert) {
        return options.onUpsert(input)
      }

      const saved = createScheduleSummary({
        connectorInstanceId: input.connectorInstanceId,
        revision: input.expectedRevision ? 'rev-2' : 'rev-1',
        state: input.state,
        cadence: input.cadence,
        timezone: input.timezone,
      })
      store.schedule = saved
      return saved
    }),
    pauseSchedule: vi.fn(async (input) => {
      if (!store.schedule) {
        throw new Error('missing schedule')
      }

      const paused = {
        ...store.schedule,
        revision: `${input.expectedRevision}-paused`,
        state: 'paused' as const,
      }
      store.schedule = paused
      return paused
    }),
    resumeSchedule: vi.fn(async (input) => {
      if (!store.schedule) {
        throw new Error('missing schedule')
      }

      const resumed = {
        ...store.schedule,
        revision: `${input.expectedRevision}-resumed`,
        state: 'enabled' as const,
      }
      store.schedule = resumed
      return resumed
    }),
    deleteSchedule: vi.fn(async () => {
      store.schedule = null
    }),
  }
}

async function authenticateJobrightInConnectors({
  connectorsApi,
  profileApi,
}: {
  connectorsApi: ReturnType<typeof createConnectorsApi>
  profileApi: ReturnType<typeof createProfileApi>
}) {
  fireEvent.click(await screen.findByRole('button', { name: 'Add Jobright connector' }))
  await waitFor(() => expect(connectorsApi.create).toHaveBeenCalled())
  const instanceId = lastCreatedConnectorInstanceId(connectorsApi)
  fireEvent.click(await screen.findByRole('button', { name: 'Add credentials' }))
  fireEvent.change(await screen.findByLabelText('Jobright email'), {
    target: { value: 'demo@example.com' },
  })
  fireEvent.change(screen.getByLabelText('Jobright password'), {
    target: { value: 'secret-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save and validate' }))
  await screen.findByText('Auth verified')
  expect(profileApi.secrets.upsert).toHaveBeenCalled()
  expect(connectorsApi.status.reconnect).toHaveBeenCalled()
  return instanceId
}

describe('App connector schedules', () => {
  it('keeps cards manual-only with an unavailable-scheduler explanation and never loads schedules', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const scheduleApi = createUnavailableScheduleApi()
    const workspace = createWorkspaceSummary({ id: 'workspace-schedule-unavailable' })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        connectorScheduleApi={scheduleApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi(workspace)}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    await authenticateJobrightInConnectors({ connectorsApi, profileApi })

    expect(await screen.findByText(CONNECTOR_SCHEDULE_UNAVAILABLE_EXPLANATION)).toBeInTheDocument()
    expect(screen.getByText('Manual only')).toBeInTheDocument()
    expect(scheduleApi.getCapabilities).toHaveBeenCalled()
    expect(scheduleApi.getSchedule).not.toHaveBeenCalled()
    expect(scheduleApi.upsertSchedule).not.toHaveBeenCalled()
    expect(scheduleApi.deleteSchedule).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))
    })

    await waitFor(() => {
      expect(connectorsApi.runs.trigger).toHaveBeenCalled()
    })
  })

  it('shows a capability-load failure without the unavailable explanation and never loads schedules', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const scheduleApi: ScheduleApiMocks = {
      getCapabilities: vi.fn(async () => {
        throw new Error('capabilities unavailable')
      }),
      getSchedule: vi.fn(async () => null),
      upsertSchedule: vi.fn(async () => {
        throw new Error('upsert should not be called')
      }),
      pauseSchedule: vi.fn(async () => {
        throw new Error('pause should not be called')
      }),
      resumeSchedule: vi.fn(async () => {
        throw new Error('resume should not be called')
      }),
      deleteSchedule: vi.fn(async () => {
        throw new Error('delete should not be called')
      }),
    }
    const workspace = createWorkspaceSummary({ id: 'workspace-schedule-capability-error' })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        connectorScheduleApi={scheduleApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi(workspace)}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    await authenticateJobrightInConnectors({ connectorsApi, profileApi })

    expect(await screen.findByText(CONNECTOR_SCHEDULE_LOAD_FAILURE_EXPLANATION)).toBeInTheDocument()
    expect(screen.queryByText(CONNECTOR_SCHEDULE_UNAVAILABLE_EXPLANATION)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Schedule mode')).not.toBeInTheDocument()
    expect(scheduleApi.getCapabilities).toHaveBeenCalled()
    expect(scheduleApi.getSchedule).not.toHaveBeenCalled()
    expect(scheduleApi.upsertSchedule).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))
    })
    await waitFor(() => {
      expect(connectorsApi.runs.trigger).toHaveBeenCalled()
    })
  })

  it('creates a supported preset schedule with expectedRevision null and reloads the returned summary', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const scheduleApi = createAvailableScheduleApi()
    const workspace = createWorkspaceSummary({ id: 'workspace-schedule-create' })

    const view = render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        connectorScheduleApi={scheduleApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi(workspace)}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    const instanceId = await authenticateJobrightInConnectors({ connectorsApi, profileApi })

    await waitFor(() => {
      expect(scheduleApi.getSchedule).toHaveBeenCalled()
    })

    fireEvent.change(await screen.findByLabelText('Schedule mode'), {
      target: { value: 'preset' },
    })
    fireEvent.change(screen.getByLabelText('Preset'), {
      target: { value: 'interval-60' },
    })
    selectComboboxOption('Timezone', 'UTC')
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }))

    await waitFor(() => {
      expect(scheduleApi.upsertSchedule).toHaveBeenCalledWith({
        connectorInstanceId: instanceId,
        expectedRevision: null,
        state: 'enabled',
        cadence: { kind: 'interval', everyMinutes: 60 },
        timezone: 'UTC',
      })
    })

    expect(await screen.findByText('Cadence: Every hour')).toBeInTheDocument()
    expect(screen.getByText('Timezone: UTC')).toBeInTheDocument()
    expect(screen.getByText(/Next eligible:/)).toBeInTheDocument()

    view.unmount()
    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        connectorScheduleApi={scheduleApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi(workspace)}
      />,
    )
    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()

    expect(await screen.findByText('Cadence: Every hour')).toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
  })

  it('validates custom interval bounds and preserves draft after typed server errors', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const scheduleApi = createAvailableScheduleApi({
      onUpsert: async () => {
        throw new ValedictorianHttpError({
          body: {
            code: 'schedule_too_frequent',
            message: 'Schedule interval is below the capability minimum.',
          },
          message: 'ignored raw body dump',
          status: 400,
        })
      },
    })
    const workspace = createWorkspaceSummary({ id: 'workspace-schedule-validate' })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        connectorScheduleApi={scheduleApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi(workspace)}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    await authenticateJobrightInConnectors({ connectorsApi, profileApi })
    await waitFor(() => expect(scheduleApi.getSchedule).toHaveBeenCalled())

    fireEvent.change(await screen.findByLabelText('Schedule mode'), {
      target: { value: 'custom-interval' },
    })
    const everyMinutes = screen.getByLabelText('Every minutes')
    expect(everyMinutes).toHaveAttribute('min', '15')
    expect(everyMinutes).toHaveAttribute('max', '525600')

    fireEvent.change(everyMinutes, {
      target: { value: '5' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }))

    expect(await screen.findByText('Interval must be at least 15 minutes.')).toBeInTheDocument()
    expect(scheduleApi.upsertSchedule).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Every minutes')).toHaveValue(5)

    fireEvent.change(screen.getByLabelText('Every minutes'), {
      target: { value: '525601' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }))

    expect(await screen.findByText('Interval must be at most 525600 minutes.')).toBeInTheDocument()
    expect(scheduleApi.upsertSchedule).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Every minutes'), {
      target: { value: '30' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }))

    expect(await screen.findByText(
      'Schedule interval is below the capability minimum.',
    )).toBeInTheDocument()
    expect(screen.queryByText('ignored raw body dump')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Every minutes')).toHaveValue(30)
    expect(screen.getByLabelText('Schedule mode')).toHaveValue('custom-interval')
  })

  it('saves custom daily and weekly schedules with structured cadence and timezone payloads', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const scheduleApi = createAvailableScheduleApi()
    const workspace = createWorkspaceSummary({ id: 'workspace-schedule-custom-forms' })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        connectorScheduleApi={scheduleApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi(workspace)}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    const instanceId = await authenticateJobrightInConnectors({ connectorsApi, profileApi })
    await waitFor(() => expect(scheduleApi.getSchedule).toHaveBeenCalled())

    fireEvent.change(await screen.findByLabelText('Schedule mode'), {
      target: { value: 'custom-daily' },
    })
    fireEvent.change(screen.getByLabelText('Daily local time'), {
      target: { value: '14:30' },
    })
    selectComboboxOption('Timezone', 'America/New_York')
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }))

    await waitFor(() => {
      expect(scheduleApi.upsertSchedule).toHaveBeenCalledWith({
        connectorInstanceId: instanceId,
        expectedRevision: null,
        state: 'enabled',
        cadence: { kind: 'daily', localTime: '14:30' },
        timezone: 'America/New_York',
      })
    })

    fireEvent.change(screen.getByLabelText('Schedule mode'), {
      target: { value: 'custom-weekly' },
    })
    fireEvent.change(screen.getByLabelText('Weekday'), {
      target: { value: '5' },
    })
    fireEvent.change(screen.getByLabelText('Weekly local time'), {
      target: { value: '08:15' },
    })
    selectComboboxOption('Timezone', 'Europe/London')
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }))

    await waitFor(() => {
      expect(scheduleApi.upsertSchedule).toHaveBeenCalledWith({
        connectorInstanceId: instanceId,
        expectedRevision: 'rev-1',
        state: 'enabled',
        cadence: { kind: 'weekly', dayOfWeek: 5, localTime: '08:15' },
        timezone: 'Europe/London',
      })
    })
  })

  it('hides unsupported cadence modes and presets below the capability minimum', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const scheduleApi = createAvailableScheduleApi({
      capability: {
        available: true,
        supportedCadences: ['interval'],
        minimumIntervalMinutes: 60,
        maximumCatchUpAgeMinutes: 24 * 60,
        timezoneModel: 'iana',
        missedOccurrencePolicy: 'coalesce_one',
      },
    })
    const workspace = createWorkspaceSummary({ id: 'workspace-schedule-limited' })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        connectorScheduleApi={scheduleApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi(workspace)}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    await authenticateJobrightInConnectors({ connectorsApi, profileApi })
    await waitFor(() => expect(scheduleApi.getSchedule).toHaveBeenCalled())

    const modeSelect = await screen.findByLabelText('Schedule mode')
    expect(within(modeSelect).queryByRole('option', { name: 'Custom daily' })).not.toBeInTheDocument()
    expect(within(modeSelect).queryByRole('option', { name: 'Custom weekly' })).not.toBeInTheDocument()
    expect(within(modeSelect).getByRole('option', { name: 'Custom interval' })).toBeInTheDocument()

    fireEvent.change(modeSelect, { target: { value: 'preset' } })
    const presetSelect = screen.getByLabelText('Preset')
    expect(within(presetSelect).queryByRole('option', { name: 'Every 15 minutes' })).not.toBeInTheDocument()
    expect(within(presetSelect).queryByRole('option', { name: 'Every 30 minutes' })).not.toBeInTheDocument()
    expect(within(presetSelect).getByRole('option', { name: 'Every hour' })).toBeInTheDocument()

    fireEvent.change(modeSelect, { target: { value: 'custom-interval' } })
    expect(screen.getByLabelText('Every minutes')).toHaveAttribute('min', '60')
    expect(screen.getByLabelText('Every minutes')).toHaveAttribute('max', '525600')
  })

  it('edits with the current revision, discards drafts, and deletes manual-only schedules', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const initial = createScheduleSummary({
      revision: 'rev-1',
      cadence: { kind: 'interval', everyMinutes: 60 },
    })
    const scheduleApi = createAvailableScheduleApi({ initialSchedule: initial })
    const workspace = createWorkspaceSummary({ id: 'workspace-schedule-edit' })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        connectorScheduleApi={scheduleApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi(workspace)}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    const instanceId = await authenticateJobrightInConnectors({ connectorsApi, profileApi })
    expect(await screen.findByText('Cadence: Every hour')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Schedule mode'), {
      target: { value: 'preset' },
    })
    fireEvent.change(screen.getByLabelText('Preset'), {
      target: { value: 'interval-30' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(await screen.findByText('Cadence: Every hour')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Preset'), {
      target: { value: 'interval-30' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }))

    await waitFor(() => {
      expect(scheduleApi.upsertSchedule).toHaveBeenCalledWith(expect.objectContaining({
        expectedRevision: 'rev-1',
        cadence: { kind: 'interval', everyMinutes: 30 },
      }))
    })

    fireEvent.change(screen.getByLabelText('Schedule mode'), {
      target: { value: 'manual' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }))

    const cancelDialog = await screen.findByRole('alertdialog', {
      name: 'Remove automatic schedule?',
    })
    expect(scheduleApi.deleteSchedule).not.toHaveBeenCalled()
    fireEvent.click(within(cancelDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(
        screen.queryByRole('alertdialog', { name: 'Remove automatic schedule?' }),
      ).not.toBeInTheDocument()
    })
    expect(scheduleApi.deleteSchedule).not.toHaveBeenCalled()
    expect(screen.getByText('Cadence: Every 30 minutes')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }))
    const confirmDialog = await screen.findByRole('alertdialog', {
      name: 'Remove automatic schedule?',
    })
    expect(confirmDialog).toHaveAccessibleDescription(
      'Saving Manual only permanently removes the persisted Jobright internslist schedule.',
    )
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Remove schedule' }))

    await waitFor(() => {
      expect(scheduleApi.deleteSchedule).toHaveBeenCalledWith({
        connectorInstanceId: instanceId,
        expectedRevision: 'rev-2',
      })
    })
    expect(await screen.findByText(/No automatic schedule is persisted/)).toBeInTheDocument()
  })

  it('disables schedule removal confirm while pending and keeps the alert open on error', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const initial = createScheduleSummary({
      revision: 'rev-pending',
      cadence: { kind: 'interval', everyMinutes: 60 },
    })
    let rejectDelete: ((reason?: unknown) => void) | undefined
    const scheduleApi = createAvailableScheduleApi({ initialSchedule: initial })
    scheduleApi.deleteSchedule = vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectDelete = reject
        }),
    )
    const workspace = createWorkspaceSummary({ id: 'workspace-schedule-manual-error' })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        connectorScheduleApi={scheduleApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi(workspace)}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    await authenticateJobrightInConnectors({ connectorsApi, profileApi })
    expect(await screen.findByText('Cadence: Every hour')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Schedule mode'), {
      target: { value: 'manual' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Remove automatic schedule?',
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove schedule' }))

    await waitFor(() => {
      expect(scheduleApi.deleteSchedule).toHaveBeenCalledTimes(1)
    })
    expect(within(dialog).getByRole('button', { name: 'Removing...' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()

    rejectDelete?.(new Error('Schedule revision conflict.'))

    expect(await within(dialog).findByText(/Schedule revision conflict/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Remove schedule' })).toBeEnabled()
    expect(screen.getByRole('alertdialog', { name: 'Remove automatic schedule?' })).toBeInTheDocument()
  })

  it('pauses and resumes using returned revisions and shows last schedule outcomes', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const initial = createScheduleSummary({
      revision: 'rev-live',
      state: 'enabled',
      lastOccurrence: {
        id: 'occ-1',
        scheduleId: 'schedule-1',
        scheduleRevision: 'rev-live',
        nominalAt: '2026-07-12T11:00:00.000Z',
        idempotencyKey: 'key',
        admittedMode: 'scheduled',
        outcome: 'completed',
        connectorRunId: 'run-1',
        createdAt: '2026-07-12T11:00:00.000Z',
      },
      lastRun: {
        id: 'run-1',
        status: 'completed',
        mode: 'scheduled',
        startedAt: '2026-07-12T11:00:00.000Z',
        completedAt: '2026-07-12T11:01:00.000Z',
      },
    })
    const scheduleApi = createAvailableScheduleApi({ initialSchedule: initial })
    const workspace = createWorkspaceSummary({ id: 'workspace-schedule-pause' })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        connectorScheduleApi={scheduleApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi(workspace)}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    const instanceId = await authenticateJobrightInConnectors({ connectorsApi, profileApi })
    expect(await screen.findByText('Enabled')).toBeInTheDocument()
    expect(screen.getByText(/Last occurrence: completed/)).toBeInTheDocument()
    expect(screen.getByText(/Last scheduled run: completed \(scheduled\)/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Pause schedule' }))
    await waitFor(() => {
      expect(scheduleApi.pauseSchedule).toHaveBeenCalledWith({
        connectorInstanceId: instanceId,
        expectedRevision: 'rev-live',
      })
    })
    expect(await screen.findByText('Paused')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Resume schedule' }))
    await waitFor(() => {
      expect(scheduleApi.resumeSchedule).toHaveBeenCalledWith({
        connectorInstanceId: instanceId,
        expectedRevision: 'rev-live-paused',
      })
    })
    expect(await screen.findByText('Enabled')).toBeInTheDocument()
  })

  it('shows connector-disabled schedule state and never uses schedule dispatch helpers', async () => {
    const connectorsApi = createConnectorsApi()
    vi.mocked(connectorsApi.list).mockResolvedValue({
      items: [{
        id: 'jobright-default',
        connectorId: 'jobright.resolver',
        connectorVersion: '0.6.0',
        displayName: 'Jobright internslist',
        enabled: false,
        auth: [{
          id: 'jobright',
          mode: 'username_password',
          label: 'Jobright username and password',
          configured: true,
        }],
        config: {},
        filters: {},
        earliestBackfillDate: '2026-07-02',
        createdAt: '2026-07-09T15:00:00.000Z',
        updatedAt: '2026-07-09T15:00:00.000Z',
      }],
    })
    const scheduleApi = createAvailableScheduleApi({
      initialSchedule: createScheduleSummary({ state: 'enabled' }),
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        connectorScheduleApi={scheduleApi}
        profileApi={createProfileApi()}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi(createWorkspaceSummary({ id: 'workspace-disabled' }))}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()

    expect(await screen.findByText('Connector disabled')).toBeInTheDocument()
    expect(screen.getByText(/Saved schedules stay paused from dispatch/)).toBeInTheDocument()
    expect('dispatchDue' in scheduleApi).toBe(false)
    expect('listAudit' in scheduleApi).toBe(false)
    expect('listOccurrences' in scheduleApi).toBe(false)
  })

  it('ignores late schedule mutation responses after workspace identity changes', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    let resolveUpsert: (value: ConnectorScheduleSummary) => void
    const pendingUpsert = new Promise<ConnectorScheduleSummary>((resolve) => {
      resolveUpsert = resolve
    })
    const firstApi = createAvailableScheduleApi({
      onUpsert: async () => pendingUpsert,
    })
    const secondApi = createAvailableScheduleApi()
    const firstWorkspace = createWorkspaceSummary({ id: 'workspace-mutation-a' })
    const secondWorkspace = createWorkspaceSummary({ id: 'workspace-mutation-b' })

    const view = render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        connectorScheduleApi={firstApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi(firstWorkspace)}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    await authenticateJobrightInConnectors({ connectorsApi, profileApi })
    await waitFor(() => expect(firstApi.getSchedule).toHaveBeenCalled())

    fireEvent.change(await screen.findByLabelText('Schedule mode'), {
      target: { value: 'preset' },
    })
    fireEvent.change(screen.getByLabelText('Preset'), {
      target: { value: 'interval-60' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }))
    await waitFor(() => expect(firstApi.upsertSchedule).toHaveBeenCalled())

    view.rerender(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        connectorScheduleApi={secondApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi(secondWorkspace)}
      />,
    )

    await waitFor(() => expect(secondApi.getCapabilities).toHaveBeenCalled())
    await waitFor(() => expect(secondApi.getSchedule).toHaveBeenCalled())

    resolveUpsert!(createScheduleSummary({
      revision: 'stale-from-workspace-a',
      cadence: { kind: 'interval', everyMinutes: 60 },
      timezone: 'UTC',
    }))

    await waitFor(() => {
      expect(screen.queryByText('Cadence: Every hour')).not.toBeInTheDocument()
    })
    expect(screen.queryByText('Schedule saved.')).not.toBeInTheDocument()
    expect(screen.queryByText('stale-from-workspace-a')).not.toBeInTheDocument()
  })

  it('ignores late schedule responses after workspace identity changes', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    let resolveFirstCapabilities: (value: { connectorScheduling: ConnectorSchedulingCapability }) => void
    const firstCapabilities = new Promise<{ connectorScheduling: ConnectorSchedulingCapability }>((resolve) => {
      resolveFirstCapabilities = resolve
    })
    const firstApi: ScheduleApiMocks = {
      getCapabilities: vi.fn(() => firstCapabilities),
      getSchedule: vi.fn(async () => null),
      upsertSchedule: vi.fn(),
      pauseSchedule: vi.fn(),
      resumeSchedule: vi.fn(),
      deleteSchedule: vi.fn(),
    }
    const secondApi = createAvailableScheduleApi()

    const view = render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        connectorScheduleApi={firstApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi(createWorkspaceSummary({ id: 'workspace-a' }))}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    await authenticateJobrightInConnectors({ connectorsApi, profileApi })
    await waitFor(() => expect(firstApi.getCapabilities).toHaveBeenCalled())

    view.rerender(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        connectorScheduleApi={secondApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi(createWorkspaceSummary({ id: 'workspace-b' }))}
      />,
    )

    await waitFor(() => expect(secondApi.getCapabilities).toHaveBeenCalled())
    resolveFirstCapabilities!({
      connectorScheduling: { available: false },
    })

    await waitFor(() => {
      expect(screen.queryByText(CONNECTOR_SCHEDULE_UNAVAILABLE_EXPLANATION)).not.toBeInTheDocument()
    })
    expect(secondApi.getSchedule).toHaveBeenCalled()
    expect(firstApi.getSchedule).not.toHaveBeenCalled()
  })

  it('keeps schedule controls inactive while schedule GET is pending and still allows manual Run', async () => {
    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    let resolveSchedule: (value: ConnectorScheduleSummary | null) => void
    const pendingSchedule = new Promise<ConnectorScheduleSummary | null>((resolve) => {
      resolveSchedule = resolve
    })
    const scheduleApi = createAvailableScheduleApi()
    scheduleApi.getSchedule = vi.fn(() => pendingSchedule)

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        connectorsApi={connectorsApi}
        connectorScheduleApi={scheduleApi}
        profileApi={profileApi}
        settingsApi={createSettingsApi()}
        workspaceApi={createWorkspaceApi(createWorkspaceSummary({ id: 'workspace-schedule-loading' }))}
      />,
    )

    await screen.findByRole('table', { name: 'Applications' })
    openConnectorsOverview()
    await authenticateJobrightInConnectors({ connectorsApi, profileApi })
    await waitFor(() => expect(scheduleApi.getSchedule).toHaveBeenCalled())

    const scheduleSection = await screen.findByLabelText('Jobright internslist schedule')
    expect(within(scheduleSection).getByRole('status', { name: 'Jobright internslist schedule status' }))
      .toHaveTextContent(/Loading schedule/i)
    expect(within(scheduleSection).queryByLabelText('Schedule mode')).not.toBeInTheDocument()
    expect(within(scheduleSection).queryByRole('button', { name: 'Save schedule' })).not.toBeInTheDocument()
    expect(within(scheduleSection).queryByRole('button', { name: 'Pause schedule' })).not.toBeInTheDocument()
    expect(within(scheduleSection).queryByRole('button', { name: 'Resume schedule' })).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run Jobright now' }))
    })
    await waitFor(() => {
      expect(connectorsApi.runs.trigger).toHaveBeenCalled()
    })

    resolveSchedule!(null)
    expect(await screen.findByLabelText('Schedule mode')).toBeEnabled()
  })

  it('keeps a persisted IANA timezone alias selected and saves it unchanged', async () => {
    const supportedValuesOf = vi.spyOn(Intl as typeof Intl & {
      supportedValuesOf: (key: string) => string[]
    }, 'supportedValuesOf').mockImplementation((key: string) => {
      if (key !== 'timeZone') {
        throw new RangeError('invalid key')
      }
      return ['UTC', 'America/New_York', 'Europe/London']
    })

    const connectorsApi = createConnectorsApi()
    const profileApi = createProfileApi()
    const scheduleApi = createAvailableScheduleApi({
      initialSchedule: createScheduleSummary({
        cadence: { kind: 'daily', localTime: '09:00' },
        timezone: 'US/Eastern',
      }),
    })

    try {
      render(
        <App
          applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
          connectorsApi={connectorsApi}
          connectorScheduleApi={scheduleApi}
          profileApi={profileApi}
          settingsApi={createSettingsApi()}
          workspaceApi={createWorkspaceApi(createWorkspaceSummary({ id: 'workspace-timezone-alias' }))}
        />,
      )

      await screen.findByRole('table', { name: 'Applications' })
      openConnectorsOverview()
      const instanceId = await authenticateJobrightInConnectors({ connectorsApi, profileApi })
      await waitFor(() => expect(scheduleApi.getSchedule).toHaveBeenCalled())

      const timezone = await screen.findByRole('combobox', { name: 'Timezone' })
      expect(timezone).toHaveTextContent('US/Eastern')
      fireEvent.click(timezone)
      expect(screen.getByRole('option', { name: 'US/Eastern' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'UTC' })).toBeInTheDocument()
      fireEvent.keyDown(timezone, { key: 'Escape' })

      fireEvent.change(screen.getByLabelText('Schedule mode'), {
        target: { value: 'custom-daily' },
      })
      fireEvent.change(screen.getByLabelText('Daily local time'), {
        target: { value: '10:30' },
      })
      expect(screen.getByRole('combobox', { name: 'Timezone' })).toHaveTextContent('US/Eastern')
      fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }))

      await waitFor(() => expect(scheduleApi.upsertSchedule).toHaveBeenCalled())
      expect(scheduleApi.upsertSchedule).toHaveBeenCalledWith({
        connectorInstanceId: instanceId,
        expectedRevision: 'rev-1',
        state: 'enabled',
        cadence: { kind: 'daily', localTime: '10:30' },
        timezone: 'US/Eastern',
      })
      expect(screen.getByRole('combobox', { name: 'Timezone' })).toHaveTextContent('US/Eastern')
    } finally {
      supportedValuesOf.mockRestore()
    }
  })
})
