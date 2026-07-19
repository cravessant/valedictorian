import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorSchedulingCapability } from 'sparxie'
import App from './App'
import {
  createApplication,
  createConnectorsApiWithJobrightDescriptor as createConnectorsApi,
  createListResult,
  createProfileApi,
  createSettingsApi,
  createWorkspaceApi,
  createWorkspaceSummary,
  stubCmdkEnvironment,
} from './App.test-helpers'
import {
  authenticateJobrightInConnectors,
  createAvailableScheduleApi,
  createUnavailableScheduleApi,
  openConnectorsOverview,
  type ScheduleApiMocks,
} from './App.connectors.schedules.test.helpers'
import {
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
    await openConnectorsOverview()
    await authenticateJobrightInConnectors({ connectorsApi, profileApi })

    expect(await screen.findByText(CONNECTOR_SCHEDULE_UNAVAILABLE_EXPLANATION)).toBeInTheDocument()
    expect(screen.getByText(/Persisted:\s*Not loaded/i)).toBeInTheDocument()
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
    await openConnectorsOverview()
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
})
