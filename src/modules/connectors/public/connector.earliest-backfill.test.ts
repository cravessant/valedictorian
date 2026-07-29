import { afterEach, describe, expect, it } from 'vitest'
import {
  assertPersistedEarliestBackfillDate,
  defaultEarliestBackfillDate,
  inclusiveCoverageStartFromEarliestBackfillDate,
  maximumSelectableEarliestBackfillDate,
  minimumSelectableEarliestBackfillDate,
  subtractUtcCalendarDays,
  utcCalendarDateFromInstant,
  validateSelectableEarliestBackfillDate,
} from './connector.earliest-backfill'

const originalTz = process.env.TZ

afterEach(() => {
  if (originalTz === undefined) {
    delete process.env.TZ
  } else {
    process.env.TZ = originalTz
  }
})

describe('connector earliest backfill UTC date policy', () => {
  it('reads the UTC calendar date containing an instant across month and year boundaries', () => {
    expect(utcCalendarDateFromInstant('2026-03-01T00:00:00.000Z')).toBe('2026-03-01')
    expect(utcCalendarDateFromInstant('2026-01-01T00:00:00.000Z')).toBe('2026-01-01')
    expect(utcCalendarDateFromInstant('2025-12-31T23:59:59.999Z')).toBe('2025-12-31')
  })

  it('subtracts UTC calendar days through month, year, and leap-day boundaries', () => {
    expect(subtractUtcCalendarDays('2026-03-01', 1)).toBe('2026-02-28')
    expect(subtractUtcCalendarDays('2024-03-01', 1)).toBe('2024-02-29')
    expect(subtractUtcCalendarDays('2026-01-05', 7)).toBe('2025-12-29')
    expect(subtractUtcCalendarDays('2026-07-11', 90)).toBe('2026-04-12')
  })

  it('defaults earliest backfill to createdAt UTC date minus seven calendar days', () => {
    expect(defaultEarliestBackfillDate('2026-07-11T15:30:00.000Z')).toBe('2026-07-04')
    expect(defaultEarliestBackfillDate('2026-01-03T01:00:00.000Z')).toBe('2025-12-27')
  })

  it('keeps UTC calendar math stable under a DST-aware host timezone', () => {
    process.env.TZ = 'America/New_York'
    // US spring-forward 2026-03-08; still UTC calendar day math.
    expect(utcCalendarDateFromInstant('2026-03-08T06:30:00.000Z')).toBe('2026-03-08')
    expect(subtractUtcCalendarDays('2026-03-09', 1)).toBe('2026-03-08')
    expect(defaultEarliestBackfillDate('2026-03-09T04:00:00.000Z')).toBe('2026-03-02')
    expect(inclusiveCoverageStartFromEarliestBackfillDate('2026-03-08')).toBe(
      '2026-03-08T00:00:00.000Z',
    )
  })

  it('converts persisted earliest dates to inclusive UTC midnight coverage starts', () => {
    expect(inclusiveCoverageStartFromEarliestBackfillDate('2026-07-04')).toBe(
      '2026-07-04T00:00:00.000Z',
    )
  })

  it('bounds selectable dates from createdAt-90 through today UTC', () => {
    expect(minimumSelectableEarliestBackfillDate('2026-07-11T12:00:00.000Z')).toBe('2026-04-12')
    expect(maximumSelectableEarliestBackfillDate('2026-07-11T23:59:59.999Z')).toBe('2026-07-11')
    expect(validateSelectableEarliestBackfillDate({
      candidate: '2026-04-12',
      createdAt: '2026-07-11T12:00:00.000Z',
      todayUtc: '2026-07-11',
    })).toEqual({ ok: true, value: '2026-04-12' })
    expect(validateSelectableEarliestBackfillDate({
      candidate: '2026-04-11',
      createdAt: '2026-07-11T12:00:00.000Z',
      todayUtc: '2026-07-11',
    })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/90|earliest|minimum/i),
    })
    expect(validateSelectableEarliestBackfillDate({
      candidate: '2026-07-12',
      createdAt: '2026-07-11T12:00:00.000Z',
      todayUtc: '2026-07-11',
    })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/future|today|maximum/i),
    })
  })

  it('fails closed for missing or invalid persisted earliest backfill dates', () => {
    expect(() => assertPersistedEarliestBackfillDate(null)).toThrow(/earliest backfill date/i)
    expect(() => assertPersistedEarliestBackfillDate(undefined)).toThrow(/earliest backfill date/i)
    expect(() => assertPersistedEarliestBackfillDate('')).toThrow(/earliest backfill date/i)
    expect(() => assertPersistedEarliestBackfillDate('2026-7-4')).toThrow(/earliest backfill date/i)
    expect(() => assertPersistedEarliestBackfillDate('2026-02-30')).toThrow(/earliest backfill date/i)
    expect(() => assertPersistedEarliestBackfillDate('2026-07-04T00:00:00.000Z')).toThrow(
      /earliest backfill date/i,
    )
    expect(assertPersistedEarliestBackfillDate('2026-07-04')).toBe('2026-07-04')
  })
})
