import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  computeNextEligibleAt,
  computeNextNominalAfter,
  resolveMissedNominals,
  resolveZonedLocalInstant,
} from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/core/connector-schedule.eligibility'

/** Ordinary valid resolution must stay far below a day-long minute scan (~1440 formats). */
const MAX_ORDINARY_ZONED_RESOLUTION_FORMATS = 48

function countFormatToPartsCalls(run: () => void): number {
  const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
  try {
    run()
    return spy.mock.calls.length
  } finally {
    spy.mockRestore()
  }
}

describe('connector schedule recurrence engine', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('computes interval next eligibility and nominal steps', () => {
    expect(computeNextEligibleAt({
      cadence: { kind: 'interval', everyMinutes: 60 },
      now: new Date('2026-07-11T12:00:00.000Z'),
      timezone: 'UTC',
    })).toBe('2026-07-11T13:00:00.000Z')

    expect(computeNextNominalAfter({
      cadence: { kind: 'interval', everyMinutes: 60 },
      after: '2026-07-11T13:00:00.000Z',
      timezone: 'UTC',
    })).toBe('2026-07-11T14:00:00.000Z')
  })

  it('resolves spring-forward nonexistent local time to first valid after the gap', () => {
    // America/New_York 2026-03-08: 02:30 does not exist; first valid after gap is 03:00 EDT.
    expect(new Date(resolveZonedLocalInstant({
      timeZone: 'America/New_York',
      year: 2026,
      month: 3,
      day: 8,
      hour: 2,
      minute: 30,
    })).toISOString()).toBe('2026-03-08T07:00:00.000Z')
  })

  it('resolves fall-back repeated local time to the earlier instant', () => {
    // America/New_York 2026-11-01: 01:30 occurs twice; earlier is EDT (05:30Z).
    expect(new Date(resolveZonedLocalInstant({
      timeZone: 'America/New_York',
      year: 2026,
      month: 11,
      day: 1,
      hour: 1,
      minute: 30,
    })).toISOString()).toBe('2026-11-01T05:30:00.000Z')
  })

  it('resolves fall-back overlap to the earliest instant for non-hour transitions', () => {
    // Australia/Lord_Howe 2026-04-05: clocks fall back 30 minutes; 01:45 occurs twice.
    // Earlier occurrence is still on GMT+11 → 2026-04-04T14:45:00.000Z.
    expect(new Date(resolveZonedLocalInstant({
      timeZone: 'Australia/Lord_Howe',
      year: 2026,
      month: 4,
      day: 5,
      hour: 1,
      minute: 45,
    })).toISOString()).toBe('2026-04-04T14:45:00.000Z')
  })

  it('resolves multi-hour historical overlap to the earlier Intl-derived instant', () => {
    // Pacific/Kwajalein 1969-09-30: Intl shows a ~23h backward date-line shift.
    // Wall 01:00 occurs at 1969-09-29T14:00:00.000Z (GMT+11) and 1969-09-30T13:00:00.000Z (GMT-12).
    expect(new Date(resolveZonedLocalInstant({
      timeZone: 'Pacific/Kwajalein',
      year: 1969,
      month: 9,
      day: 30,
      hour: 1,
      minute: 0,
    })).toISOString()).toBe('1969-09-29T14:00:00.000Z')
  })

  it('discovers offsets from a fixed day-scale window rather than encoded shift durations', () => {
    const msPerDay = 24 * 60 * 60 * 1000
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
    try {
      const resolved = resolveZonedLocalInstant({
        timeZone: 'UTC',
        year: 2026,
        month: 7,
        day: 11,
        hour: 12,
        minute: 0,
      })
      expect(new Date(resolved).toISOString()).toBe('2026-07-11T12:00:00.000Z')

      const probed = new Set(
        spy.mock.calls
          .map((call) => call[0])
          .filter((value): value is Date => value instanceof Date)
          .map((value) => value.getTime()),
      )
      // Algorithm must observe offsets at the converged instant and ±1/±2 calendar days,
      // not a hard-coded list of 15m/30m/1h transition lengths.
      expect(probed.has(resolved)).toBe(true)
      expect(probed.has(resolved - msPerDay)).toBe(true)
      expect(probed.has(resolved + msPerDay)).toBe(true)
      expect(probed.has(resolved - 2 * msPerDay)).toBe(true)
      expect(probed.has(resolved + 2 * msPerDay)).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  it('bounds timezone format work for ordinary non-overlap resolution', () => {
    const ordinaryCases = [
      { timeZone: 'UTC', year: 2026, month: 7, day: 11, hour: 12, minute: 0, expected: '2026-07-11T12:00:00.000Z' },
      { timeZone: 'America/New_York', year: 2026, month: 7, day: 11, hour: 12, minute: 0, expected: '2026-07-11T16:00:00.000Z' },
      { timeZone: 'America/New_York', year: 2026, month: 1, day: 15, hour: 9, minute: 30, expected: '2026-01-15T14:30:00.000Z' },
    ] as const

    for (const testCase of ordinaryCases) {
      let resolvedMs = 0
      const formatCount = countFormatToPartsCalls(() => {
        resolvedMs = resolveZonedLocalInstant({
          timeZone: testCase.timeZone,
          year: testCase.year,
          month: testCase.month,
          day: testCase.day,
          hour: testCase.hour,
          minute: testCase.minute,
        })
      })
      expect(new Date(resolvedMs).toISOString()).toBe(testCase.expected)
      expect(formatCount).toBeLessThanOrEqual(MAX_ORDINARY_ZONED_RESOLUTION_FORMATS)
    }

    // Overlap and spring-gap cases remain correct under the same resolver.
    expect(new Date(resolveZonedLocalInstant({
      timeZone: 'Australia/Lord_Howe',
      year: 2026,
      month: 4,
      day: 5,
      hour: 1,
      minute: 45,
    })).toISOString()).toBe('2026-04-04T14:45:00.000Z')
    expect(new Date(resolveZonedLocalInstant({
      timeZone: 'America/New_York',
      year: 2026,
      month: 11,
      day: 1,
      hour: 1,
      minute: 30,
    })).toISOString()).toBe('2026-11-01T05:30:00.000Z')
    expect(new Date(resolveZonedLocalInstant({
      timeZone: 'America/New_York',
      year: 2026,
      month: 3,
      day: 8,
      hour: 2,
      minute: 30,
    })).toISOString()).toBe('2026-03-08T07:00:00.000Z')
  })

  it('computes daily and weekly next eligibility in an IANA zone', () => {
    expect(computeNextEligibleAt({
      cadence: { kind: 'daily', localTime: '02:30' },
      now: new Date('2026-03-06T12:00:00.000Z'),
      timezone: 'America/New_York',
    })).toBe('2026-03-07T07:30:00.000Z')

    expect(computeNextEligibleAt({
      cadence: { kind: 'weekly', dayOfWeek: 7, localTime: '01:30' },
      now: new Date('2026-10-25T12:00:00.000Z'),
      timezone: 'America/New_York',
    })).toBe('2026-11-01T05:30:00.000Z')
  })

  it('admits a daily spring-forward gap nominal at the first valid local instant after the gap', () => {
    // Mar 8 02:30 America/New_York does not exist; eligibility is 03:00 EDT.
    expect(computeNextEligibleAt({
      cadence: { kind: 'daily', localTime: '02:30' },
      now: new Date('2026-03-07T12:00:00.000Z'),
      timezone: 'America/New_York',
    })).toBe('2026-03-08T07:00:00.000Z')
  })

  it('admits a weekly fall-back overlap nominal at the earlier repeated local instant', () => {
    expect(computeNextEligibleAt({
      cadence: { kind: 'weekly', dayOfWeek: 7, localTime: '01:30' },
      now: new Date('2026-10-25T12:00:00.000Z'),
      timezone: 'America/New_York',
    })).toBe('2026-11-01T05:30:00.000Z')
  })

  it('coalesces missed daily nominals across a spring-forward gap using IANA local time', () => {
    const resolved = resolveMissedNominals({
      cadence: { kind: 'daily', localTime: '02:30' },
      nextEligibleAt: '2026-03-07T07:30:00.000Z',
      now: new Date('2026-03-09T12:00:00.000Z'),
      maximumCatchUpAgeMinutes: 7 * 24 * 60,
      timezone: 'America/New_York',
    })

    expect(resolved.inHorizon).toEqual(['2026-03-09T06:30:00.000Z'])
    expect(resolved.futureEligibleAt).toBe('2026-03-10T06:30:00.000Z')
  })

  it('coalesces missed weekly nominals choosing the earlier fall-back overlap instant', () => {
    const resolved = resolveMissedNominals({
      cadence: { kind: 'weekly', dayOfWeek: 7, localTime: '01:30' },
      nextEligibleAt: '2026-11-01T05:30:00.000Z',
      now: new Date('2026-11-08T12:00:00.000Z'),
      maximumCatchUpAgeMinutes: 21 * 24 * 60,
      timezone: 'America/New_York',
    })

    expect(resolved.inHorizon).toEqual(['2026-11-08T06:30:00.000Z'])
    expect(resolved.futureEligibleAt).toBe('2026-11-15T06:30:00.000Z')
  })

  it('classifies multi-miss catch-up and skips expired horizon prefix without burst replay', () => {
    const resolved = resolveMissedNominals({
      cadence: { kind: 'interval', everyMinutes: 60 },
      nextEligibleAt: '2026-07-01T00:00:00.000Z',
      now: new Date('2026-07-11T15:30:00.000Z'),
      maximumCatchUpAgeMinutes: 24 * 60,
      timezone: 'UTC',
    })

    expect(resolved.missed.length).toBeGreaterThan(1)
    expect(resolved.inHorizon).toEqual(['2026-07-11T15:00:00.000Z'])
    // Anchored grid from stored nextEligibleAt: …15:00, then 16:00 — not now+interval (16:30).
    expect(resolved.futureEligibleAt).toBe('2026-07-11T16:00:00.000Z')
  })

  it('returns empty in-horizon when every missed nominal is older than the catch-up horizon', () => {
    const resolved = resolveMissedNominals({
      cadence: { kind: 'interval', everyMinutes: 60 },
      nextEligibleAt: '2026-07-11T13:00:00.000Z',
      now: new Date('2026-07-11T15:59:00.000Z'),
      maximumCatchUpAgeMinutes: 30,
      timezone: 'UTC',
    })

    expect(resolved.missed.length).toBeGreaterThan(1)
    expect(resolved.inHorizon).toEqual([])
    // Anchored grid: 13/14/15 expired; first future on the series is 16:00 — not now+interval (16:59).
    expect(resolved.futureEligibleAt).toBe('2026-07-11T16:00:00.000Z')
  })

  it('coalesces multiple missed interval nominals into one catch_up admission', () => {
    const resolved = resolveMissedNominals({
      cadence: { kind: 'interval', everyMinutes: 60 },
      nextEligibleAt: '2026-07-11T13:00:00.000Z',
      now: new Date('2026-07-11T15:30:00.000Z'),
      maximumCatchUpAgeMinutes: 24 * 60,
      timezone: 'UTC',
    })

    expect(resolved.inHorizon).toEqual(['2026-07-11T15:00:00.000Z'])
    expect(resolved.futureEligibleAt).toBe('2026-07-11T16:00:00.000Z')
  })

  it('advances eligibility without admitting when all missed nominals are outside the catch-up horizon', () => {
    const resolved = resolveMissedNominals({
      cadence: { kind: 'interval', everyMinutes: 60 },
      nextEligibleAt: '2026-07-11T13:00:00.000Z',
      now: new Date('2026-07-11T15:59:00.000Z'),
      maximumCatchUpAgeMinutes: 30,
      timezone: 'UTC',
    })

    expect(resolved.inHorizon).toEqual([])
    expect(resolved.futureEligibleAt).toBe('2026-07-11T16:00:00.000Z')
  })

  it('advances catch-up future eligibility along the create-time interval grid at 15:30', () => {
    const resolved = resolveMissedNominals({
      cadence: { kind: 'interval', everyMinutes: 60 },
      nextEligibleAt: '2026-07-11T13:00:00.000Z',
      now: new Date('2026-07-11T15:30:00.000Z'),
      maximumCatchUpAgeMinutes: 24 * 60,
      timezone: 'UTC',
    })

    expect(resolved.inHorizon).toEqual(['2026-07-11T15:00:00.000Z'])
    expect(resolved.futureEligibleAt).toBe('2026-07-11T16:00:00.000Z')
  })
})
