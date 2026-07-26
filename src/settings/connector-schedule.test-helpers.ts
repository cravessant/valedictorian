import { vi } from 'vitest'
import type {
  ConnectorScheduleSummary,
  ConnectorSchedulingCapability,
} from '@sparxie/sdk'
import type { ConnectorScheduleUiApi } from './connector-schedule.types'
import type { ConnectorSettingsInstance } from './connector-settings.types'

type AvailableSchedulingCapability = Extract<ConnectorSchedulingCapability, { available: true }>

export const availableSchedulingCapability: AvailableSchedulingCapability = {
  available: true,
  supportedCadences: ['interval', 'daily', 'weekly'],
  minimumIntervalMinutes: 15,
  maximumCatchUpAgeMinutes: 24 * 60,
  timezoneModel: 'iana',
  missedOccurrencePolicy: 'coalesce_one',
}

function scheduleApi(
  connectorScheduling: ConnectorSchedulingCapability,
  overrides: Partial<ConnectorScheduleUiApi>,
): ConnectorScheduleUiApi {
  return {
    getCapabilities: vi.fn(async () => ({ connectorScheduling })),
    getSchedule: vi.fn(async () => null),
    upsertSchedule: vi.fn(async () => { throw new Error('unavailable') }),
    pauseSchedule: vi.fn(async () => { throw new Error('unavailable') }),
    resumeSchedule: vi.fn(async () => { throw new Error('unavailable') }),
    deleteSchedule: vi.fn(async () => { throw new Error('unavailable') }),
    ...overrides,
  }
}

/** Scheduling capability off: every mutation rejects so callers cannot silently depend on one. */
export function unavailableScheduleApi(
  overrides: Partial<ConnectorScheduleUiApi> = {},
): ConnectorScheduleUiApi {
  return scheduleApi({ available: false }, overrides)
}

export function availableScheduleApi(
  overrides: Partial<ConnectorScheduleUiApi> = {},
): ConnectorScheduleUiApi {
  return scheduleApi(availableSchedulingCapability, overrides)
}

export function scheduleSummary(
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

/** Schedule API whose reads succeed and whose writes echo the canonical summary. */
export function respondingScheduleApi(
  overrides: Partial<ConnectorScheduleUiApi> = {},
): ConnectorScheduleUiApi {
  return availableScheduleApi({
    getSchedule: vi.fn(async () => scheduleSummary()),
    upsertSchedule: vi.fn(async () => scheduleSummary()),
    pauseSchedule: vi.fn(async () => scheduleSummary({ state: 'paused' })),
    resumeSchedule: vi.fn(async () => scheduleSummary()),
    deleteSchedule: vi.fn(async () => undefined),
    ...overrides,
  })
}

/** Instance the schedule fixtures above are keyed to. */
export const schedulableInstance: ConnectorSettingsInstance = {
  id: 'jobright-default',
  connectorId: 'jobright',
  connectorVersion: '1',
  displayName: 'Jobright internslist',
  enabled: true,
  lifecycle: 'enabled',
  auth: [],
  config: {},
  filters: {},
  earliestBackfillDate: '2026-01-01',
  createdAt: '2026-07-12T12:00:00.000Z',
  updatedAt: '2026-07-12T12:00:00.000Z',
}
