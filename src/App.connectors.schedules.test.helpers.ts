import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, vi, type Mock } from 'vitest'
import type {
  ConnectorScheduleSummary,
  ConnectorSchedulingCapability,
} from 'sparxie'
import {
  createConnectorsApiWithJobrightDescriptor as createConnectorsApi,
  createProfileApi,
  lastCreatedConnectorInstanceId,
  selectSoftwareEngineeringTaxonomy,
} from './App.test-helpers'
import type { ConnectorScheduleUiApi } from './settings/connector-schedule.types'

export async function openConnectorsOverview() {
  const appNavigation = within(
    screen.getByRole('complementary', { name: 'Application navigation' }),
  ).getByRole('navigation', { name: 'Application views' })
  fireEvent.click(within(appNavigation).getByRole('button', { name: 'Connectors' }))
  fireEvent.click(await within(appNavigation).findByRole('button', { name: 'Overview' }))
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

export function createScheduleSummary(
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

export type ScheduleApiMocks = {
  getCapabilities: Mock
  getSchedule: Mock
  upsertSchedule: Mock
  pauseSchedule: Mock
  resumeSchedule: Mock
  deleteSchedule: Mock
}

export function createUnavailableScheduleApi(): ScheduleApiMocks {
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

export function createAvailableScheduleApi(
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
      if (options.onUpsert) return options.onUpsert(input)
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
      if (!store.schedule) throw new Error('missing schedule')
      const paused = {
        ...store.schedule,
        revision: `${input.expectedRevision}-paused`,
        state: 'paused' as const,
      }
      store.schedule = paused
      return paused
    }),
    resumeSchedule: vi.fn(async (input) => {
      if (!store.schedule) throw new Error('missing schedule')
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

export async function authenticateJobrightInConnectors({
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
  await selectSoftwareEngineeringTaxonomy()
  fireEvent.click(screen.getByLabelText('Jobright connector enabled'))
  fireEvent.click(screen.getByRole('button', { name: 'Save Jobright internslist connector settings' }))
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Run Jobright now' })).toBeEnabled()
  })
  return instanceId
}
