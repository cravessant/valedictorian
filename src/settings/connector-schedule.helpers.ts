import {
  isIanaTimeZone,
  MAX_CONNECTOR_SCHEDULE_INTERVAL_MINUTES,
  type ConnectorScheduleCadence,
  type ConnectorScheduleSummary,
  type ConnectorSchedulingCapability,
} from 'sparxie'
import { classifyErrorPresentation } from '../app/error-presentation'
import type { ConnectorScheduleDraft } from './connector-schedule.types'

export const CONNECTOR_SCHEDULE_UNAVAILABLE_EXPLANATION =
  'No external or cloud scheduler capability is connected. This connector stays manual-only until a scheduler capability is available.'

export const CONNECTOR_SCHEDULE_LOAD_FAILURE_EXPLANATION =
  'Automatic schedule status could not be loaded. Schedule changes are disabled until the scheduler capability can be read. Manual runs remain available.'

export type ConnectorSchedulePreset = {
  id: string
  label: string
  cadence: ConnectorScheduleCadence
}

const COMMON_SCHEDULE_PRESETS: ConnectorSchedulePreset[] = [
  {
    id: 'interval-15',
    label: 'Every 15 minutes',
    cadence: { kind: 'interval', everyMinutes: 15 },
  },
  {
    id: 'interval-30',
    label: 'Every 30 minutes',
    cadence: { kind: 'interval', everyMinutes: 30 },
  },
  {
    id: 'interval-60',
    label: 'Every hour',
    cadence: { kind: 'interval', everyMinutes: 60 },
  },
  {
    id: 'interval-360',
    label: 'Every 6 hours',
    cadence: { kind: 'interval', everyMinutes: 360 },
  },
  {
    id: 'daily-09',
    label: 'Daily at 09:00',
    cadence: { kind: 'daily', localTime: '09:00' },
  },
  {
    id: 'weekly-mon-09',
    label: 'Weekly on Monday at 09:00',
    cadence: { kind: 'weekly', dayOfWeek: 1, localTime: '09:00' },
  },
]

export function createEmptyConnectorScheduleDraft(
  timezone = 'UTC',
): ConnectorScheduleDraft {
  return {
    mode: 'manual',
    presetId: null,
    state: 'enabled',
    timezone,
    everyMinutes: '60',
    localTime: '09:00',
    dayOfWeek: '1',
  }
}

export function draftFromCanonicalSchedule(
  schedule: ConnectorScheduleSummary | null,
  fallbackTimezone = 'UTC',
): ConnectorScheduleDraft {
  if (!schedule) {
    return createEmptyConnectorScheduleDraft(fallbackTimezone)
  }

  const matchingPreset = COMMON_SCHEDULE_PRESETS.find((preset) =>
    cadenceEquals(preset.cadence, schedule.cadence),
  )

  if (matchingPreset) {
    return {
      mode: 'preset',
      presetId: matchingPreset.id,
      state: schedule.state,
      timezone: schedule.timezone,
      everyMinutes:
        schedule.cadence.kind === 'interval'
          ? String(schedule.cadence.everyMinutes)
          : '60',
      localTime:
        schedule.cadence.kind === 'daily' || schedule.cadence.kind === 'weekly'
          ? schedule.cadence.localTime
          : '09:00',
      dayOfWeek:
        schedule.cadence.kind === 'weekly' ? String(schedule.cadence.dayOfWeek) : '1',
    }
  }

  if (schedule.cadence.kind === 'interval') {
    return {
      mode: 'custom-interval',
      presetId: null,
      state: schedule.state,
      timezone: schedule.timezone,
      everyMinutes: String(schedule.cadence.everyMinutes),
      localTime: '09:00',
      dayOfWeek: '1',
    }
  }

  if (schedule.cadence.kind === 'daily') {
    return {
      mode: 'custom-daily',
      presetId: null,
      state: schedule.state,
      timezone: schedule.timezone,
      everyMinutes: '60',
      localTime: schedule.cadence.localTime,
      dayOfWeek: '1',
    }
  }

  return {
    mode: 'custom-weekly',
    presetId: null,
    state: schedule.state,
    timezone: schedule.timezone,
    everyMinutes: '60',
    localTime: schedule.cadence.localTime,
    dayOfWeek: String(schedule.cadence.dayOfWeek),
  }
}

export function supportedSchedulePresets(
  capability: Extract<ConnectorSchedulingCapability, { available: true }>,
): ConnectorSchedulePreset[] {
  return COMMON_SCHEDULE_PRESETS.filter((preset) => {
    if (!capability.supportedCadences.includes(preset.cadence.kind)) {
      return false
    }

    if (preset.cadence.kind === 'interval') {
      return preset.cadence.everyMinutes >= capability.minimumIntervalMinutes
        && preset.cadence.everyMinutes <= MAX_CONNECTOR_SCHEDULE_INTERVAL_MINUTES
    }

    return true
  })
}

export function listIanaTimeZones(currentTimezone?: string): string[] {
  const supportedValuesOf = (
    Intl as typeof Intl & {
      supportedValuesOf?: (key: string) => string[]
    }
  ).supportedValuesOf

  let values: string[]
  if (typeof supportedValuesOf === 'function') {
    try {
      const supported = supportedValuesOf('timeZone')
      if (Array.isArray(supported) && supported.length > 0) {
        values = supported.includes('UTC') ? [...supported] : ['UTC', ...supported]
      } else {
        values = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo']
      }
    } catch {
      values = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo']
    }
  } else {
    values = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo']
  }

  if (
    currentTimezone
    && isIanaTimeZone(currentTimezone)
    && !values.includes(currentTimezone)
  ) {
    return [...values, currentTimezone]
  }

  return values
}

export function formatConnectorScheduleCadence(cadence: ConnectorScheduleCadence): string {
  if (cadence.kind === 'interval') {
    if (cadence.everyMinutes % 60 === 0) {
      const hours = cadence.everyMinutes / 60
      return hours === 1 ? 'Every hour' : `Every ${hours} hours`
    }

    return `Every ${cadence.everyMinutes} minutes`
  }

  if (cadence.kind === 'daily') {
    return `Daily at ${cadence.localTime}`
  }

  const weekday = WEEKDAY_LABELS[cadence.dayOfWeek] ?? `weekday ${cadence.dayOfWeek}`
  return `Weekly on ${weekday} at ${cadence.localTime}`
}

const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
}

export type ConnectorScheduleValidationField =
  | 'timezone'
  | 'preset'
  | 'everyMinutes'
  | 'localTime'
  | 'dayOfWeek'

export function validateConnectorScheduleDraft(
  draft: ConnectorScheduleDraft,
  capability: Extract<ConnectorSchedulingCapability, { available: true }>,
): { field: ConnectorScheduleValidationField; message: string } | null {
  if (draft.mode === 'manual') {
    return null
  }

  if (!isIanaTimeZone(draft.timezone)) {
    return { field: 'timezone', message: 'Choose a valid IANA timezone.' }
  }

  if (draft.mode === 'preset') {
    const preset = supportedSchedulePresets(capability).find((item) => item.id === draft.presetId)
    if (!preset) {
      return { field: 'preset', message: 'Choose a supported schedule preset.' }
    }
    return null
  }

  if (draft.mode === 'custom-interval') {
    if (!capability.supportedCadences.includes('interval')) {
      return { field: 'everyMinutes', message: 'Interval schedules are not supported.' }
    }

    const everyMinutes = Number(draft.everyMinutes)
    if (!Number.isInteger(everyMinutes)) {
      return { field: 'everyMinutes', message: 'Interval minutes must be a whole number.' }
    }

    if (everyMinutes < capability.minimumIntervalMinutes) {
      return {
        field: 'everyMinutes',
        message: `Interval must be at least ${capability.minimumIntervalMinutes} minutes.`,
      }
    }

    if (everyMinutes > MAX_CONNECTOR_SCHEDULE_INTERVAL_MINUTES) {
      return {
        field: 'everyMinutes',
        message: `Interval must be at most ${MAX_CONNECTOR_SCHEDULE_INTERVAL_MINUTES} minutes.`,
      }
    }

    return null
  }

  if (draft.mode === 'custom-daily') {
    if (!capability.supportedCadences.includes('daily')) {
      return { field: 'localTime', message: 'Daily schedules are not supported.' }
    }

    if (!isCanonicalLocalTime(draft.localTime)) {
      return { field: 'localTime', message: 'Daily time must use HH:mm.' }
    }

    return null
  }

  if (!capability.supportedCadences.includes('weekly')) {
    return { field: 'dayOfWeek', message: 'Weekly schedules are not supported.' }
  }

  const dayOfWeek = Number(draft.dayOfWeek)
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
    return {
      field: 'dayOfWeek',
      message: 'Weekly day must be an ISO weekday from 1 (Monday) through 7 (Sunday).',
    }
  }

  if (!isCanonicalLocalTime(draft.localTime)) {
    return { field: 'localTime', message: 'Weekly time must use HH:mm.' }
  }

  return null
}

export function cadenceFromDraft(
  draft: ConnectorScheduleDraft,
  capability: Extract<ConnectorSchedulingCapability, { available: true }>,
): ConnectorScheduleCadence | null {
  if (draft.mode === 'manual') {
    return null
  }

  if (draft.mode === 'preset') {
    const preset = supportedSchedulePresets(capability).find((item) => item.id === draft.presetId)
    return preset?.cadence ?? null
  }

  if (draft.mode === 'custom-interval') {
    return {
      kind: 'interval',
      everyMinutes: Number(draft.everyMinutes),
    }
  }

  if (draft.mode === 'custom-daily') {
    return {
      kind: 'daily',
      localTime: draft.localTime,
    }
  }

  return {
    kind: 'weekly',
    dayOfWeek: Number(draft.dayOfWeek),
    localTime: draft.localTime,
  }
}

function cadenceEquals(left: ConnectorScheduleCadence, right: ConnectorScheduleCadence) {
  if (left.kind !== right.kind) {
    return false
  }

  if (left.kind === 'interval' && right.kind === 'interval') {
    return left.everyMinutes === right.everyMinutes
  }

  if (left.kind === 'daily' && right.kind === 'daily') {
    return left.localTime === right.localTime
  }

  if (left.kind === 'weekly' && right.kind === 'weekly') {
    return left.dayOfWeek === right.dayOfWeek && left.localTime === right.localTime
  }

  return false
}

function isCanonicalLocalTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function sanitizeConnectorScheduleError(error: unknown): string {
  return classifyErrorPresentation(error, {
    scope: 'form',
    trigger: 'save',
  }).message
}

export function isConnectorScheduleDraftDirty(
  draft: ConnectorScheduleDraft,
  canonical: ConnectorScheduleSummary | null,
): boolean {
  const baseline = draftFromCanonicalSchedule(canonical, draft.timezone)
  return JSON.stringify(draft) !== JSON.stringify(baseline)
}
