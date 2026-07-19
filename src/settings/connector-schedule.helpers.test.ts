import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorSchedulingCapability } from 'sparxie'
import {
  cadenceFromDraft,
  createEmptyConnectorScheduleDraft,
  draftFromCanonicalSchedule,
  isConnectorScheduleDraftDirty,
  listIanaTimeZones,
  supportedSchedulePresets,
  validateConnectorScheduleDraft,
} from './connector-schedule.helpers'

const availableCapability: Extract<ConnectorSchedulingCapability, { available: true }> = {
  available: true,
  supportedCadences: ['interval', 'daily', 'weekly'],
  minimumIntervalMinutes: 15,
  maximumCatchUpAgeMinutes: 24 * 60,
  timezoneModel: 'iana',
  missedOccurrencePolicy: 'coalesce_one',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('connector schedule helpers', () => {
  it('validates interval boundaries without rendering React', () => {
    const draft = {
      ...createEmptyConnectorScheduleDraft(),
      mode: 'custom-interval' as const,
    }

    expect(validateConnectorScheduleDraft(
      { ...draft, everyMinutes: '5' },
      availableCapability,
    )).toEqual({
      field: 'everyMinutes',
      message: 'Interval must be at least 15 minutes.',
    })
    expect(validateConnectorScheduleDraft(
      { ...draft, everyMinutes: '525601' },
      availableCapability,
    )).toEqual({
      field: 'everyMinutes',
      message: 'Interval must be at most 525600 minutes.',
    })
    expect(validateConnectorScheduleDraft(
      { ...draft, everyMinutes: '30' },
      availableCapability,
    )).toBeNull()
  })

  it('maps custom daily and weekly drafts to canonical cadence', () => {
    expect(cadenceFromDraft({
      ...createEmptyConnectorScheduleDraft('America/New_York'),
      mode: 'custom-daily',
      localTime: '14:30',
    }, availableCapability)).toEqual({ kind: 'daily', localTime: '14:30' })

    expect(cadenceFromDraft({
      ...createEmptyConnectorScheduleDraft('Europe/London'),
      mode: 'custom-weekly',
      dayOfWeek: '5',
      localTime: '08:15',
    }, availableCapability)).toEqual({
      kind: 'weekly',
      dayOfWeek: 5,
      localTime: '08:15',
    })
  })

  it('filters unsupported schedule modes and presets', () => {
    const intervalOnly = {
      ...availableCapability,
      supportedCadences: ['interval'] as const,
      minimumIntervalMinutes: 60,
    }

    expect(supportedSchedulePresets(intervalOnly).map(({ id }) => id)).toEqual([
      'interval-60',
      'interval-360',
    ])
    expect(validateConnectorScheduleDraft({
      ...createEmptyConnectorScheduleDraft(),
      mode: 'custom-daily',
    }, intervalOnly)).toEqual({
      field: 'localTime',
      message: 'Daily schedules are not supported.',
    })
    expect(validateConnectorScheduleDraft({
      ...createEmptyConnectorScheduleDraft(),
      mode: 'custom-weekly',
    }, intervalOnly)).toEqual({
      field: 'dayOfWeek',
      message: 'Weekly schedules are not supported.',
    })
  })

  it('preserves a valid persisted IANA timezone alias', () => {
    vi.spyOn(Intl as typeof Intl & {
      supportedValuesOf: (key: string) => string[]
    }, 'supportedValuesOf').mockReturnValue(['UTC', 'America/New_York', 'Europe/London'])

    expect(listIanaTimeZones('US/Eastern')).toEqual([
      'UTC',
      'America/New_York',
      'Europe/London',
      'US/Eastern',
    ])
  })

  it('maps persisted schedules to drafts and detects only real edits', () => {
    const schedule = {
      id: 'schedule-1',
      connectorInstanceId: 'jobright-default',
      revision: 'rev-1',
      state: 'enabled' as const,
      cadence: { kind: 'interval' as const, everyMinutes: 60 },
      timezone: 'UTC',
      nextEligibleAt: '2026-07-12T13:00:00.000Z',
      createdAt: '2026-07-12T12:00:00.000Z',
      updatedAt: '2026-07-12T12:00:00.000Z',
      lastOccurrence: null,
      lastRun: null,
    }
    const draft = draftFromCanonicalSchedule(schedule)

    expect(draft).toMatchObject({ mode: 'preset', presetId: 'interval-60' })
    expect(isConnectorScheduleDraftDirty(draft, schedule)).toBe(false)
    expect(isConnectorScheduleDraftDirty({ ...draft, presetId: 'interval-30' }, schedule)).toBe(true)
  })
})
