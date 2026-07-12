import { canonicalDateOnlySchema, type CanonicalDateOnly } from 'sparxie'

const DEFAULT_EARLIEST_BACKFILL_OFFSET_DAYS = 7
const MAXIMUM_EARLIEST_BACKFILL_HORIZON_DAYS = 90
const CANONICAL_DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function utcCalendarDateFromInstant(instant: string): CanonicalDateOnly {
  const parsed = Date.parse(instant)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid connector createdAt instant: ${instant}`)
  }
  return formatUtcCalendarDate(new Date(parsed))
}

export function subtractUtcCalendarDays(
  dateOnly: CanonicalDateOnly,
  days: number,
): CanonicalDateOnly {
  if (!Number.isInteger(days) || days < 0) {
    throw new Error(`Invalid UTC calendar day offset: ${days}`)
  }
  const parts = parseCanonicalDateParts(dateOnly)
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day - days)
  return formatUtcCalendarDate(new Date(utc))
}

export function defaultEarliestBackfillDate(createdAt: string): CanonicalDateOnly {
  return subtractUtcCalendarDays(
    utcCalendarDateFromInstant(createdAt),
    DEFAULT_EARLIEST_BACKFILL_OFFSET_DAYS,
  )
}

export function minimumSelectableEarliestBackfillDate(createdAt: string): CanonicalDateOnly {
  return subtractUtcCalendarDays(
    utcCalendarDateFromInstant(createdAt),
    MAXIMUM_EARLIEST_BACKFILL_HORIZON_DAYS,
  )
}

export function maximumSelectableEarliestBackfillDate(nowInstant: string): CanonicalDateOnly {
  return utcCalendarDateFromInstant(nowInstant)
}

export function inclusiveCoverageStartFromEarliestBackfillDate(
  earliestBackfillDate: CanonicalDateOnly,
): string {
  const value = assertPersistedEarliestBackfillDate(earliestBackfillDate)
  return `${value}T00:00:00.000Z`
}

export function assertPersistedEarliestBackfillDate(value: unknown): CanonicalDateOnly {
  if (typeof value !== 'string' || !CANONICAL_DATE_ONLY_PATTERN.test(value)) {
    throw new Error('Persisted earliest backfill date is missing or invalid')
  }
  const parsed = canonicalDateOnlySchema.safeParse(value)
  if (!parsed.success || !isRealGregorianDate(value)) {
    throw new Error('Persisted earliest backfill date is missing or invalid')
  }
  return parsed.data
}

export function validateSelectableEarliestBackfillDate(input: {
  candidate: unknown
  createdAt: string
  todayUtc: CanonicalDateOnly
}): { ok: true; value: CanonicalDateOnly } | { ok: false; message: string } {
  let value: CanonicalDateOnly
  try {
    value = assertPersistedEarliestBackfillDate(input.candidate)
  } catch {
    return {
      ok: false,
      message: 'Choose a valid calendar date as YYYY-MM-DD.',
    }
  }

  const minimum = minimumSelectableEarliestBackfillDate(input.createdAt)
  const maximum = assertPersistedEarliestBackfillDate(input.todayUtc)

  if (value < minimum) {
    return {
      ok: false,
      message: `Earliest backfill cannot be earlier than ${minimum} (createdAt minus 90 UTC calendar days).`,
    }
  }
  if (value > maximum) {
    return {
      ok: false,
      message: `Earliest backfill cannot be later than today's UTC date (${maximum}).`,
    }
  }

  return { ok: true, value }
}

function formatUtcCalendarDate(date: Date): CanonicalDateOnly {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return assertPersistedEarliestBackfillDate(`${year}-${month}-${day}`)
}

function parseCanonicalDateParts(dateOnly: CanonicalDateOnly): {
  year: number
  month: number
  day: number
} {
  const value = assertPersistedEarliestBackfillDate(dateOnly)
  const match = CANONICAL_DATE_ONLY_PATTERN.exec(value)
  if (!match) {
    throw new Error('Persisted earliest backfill date is missing or invalid')
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
}

function isRealGregorianDate(value: string): boolean {
  const match = CANONICAL_DATE_ONLY_PATTERN.exec(value)
  if (!match) {
    return false
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  return (
    utc.getUTCFullYear() === year
    && utc.getUTCMonth() === month - 1
    && utc.getUTCDate() === day
  )
}
