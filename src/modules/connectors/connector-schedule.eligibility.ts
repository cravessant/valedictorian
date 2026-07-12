import type { ConnectorScheduleCadence } from 'sparxie'

const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR

/** Hard bound for missed-nominal walks; horizon skip keeps real work far below this. */
const MAX_NOMINAL_WALK_STEPS = 10_000

type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/**
 * First cadence instant strictly after `now` (server clock).
 * Shared by create/edit/resume and due/catch-up advancement.
 */
export function computeNextEligibleAt({
  cadence,
  now,
  timezone,
}: {
  cadence: ConnectorScheduleCadence
  now: Date
  timezone: string
}): string {
  return computeNextNominalAfter({
    cadence,
    after: now,
    timezone,
  })
}

/**
 * First cadence nominal strictly after `after`.
 * This is the single recurrence primitive for interval, daily, and weekly.
 */
export function computeNextNominalAfter({
  cadence,
  after,
  timezone,
}: {
  cadence: ConnectorScheduleCadence
  after: Date | string | number
  timezone: string
}): string {
  const afterMs = toEpochMs(after)

  if (cadence.kind === 'interval') {
    return new Date(afterMs + cadence.everyMinutes * MS_PER_MINUTE).toISOString()
  }

  const [hour, minute] = parseLocalTime(cadence.localTime)
  const afterParts = getZonedParts(new Date(afterMs), timezone)
  let probe = {
    year: afterParts.year,
    month: afterParts.month,
    day: afterParts.day,
  }

  for (let step = 0; step < MAX_NOMINAL_WALK_STEPS; step += 1) {
    if (cadence.kind === 'weekly') {
      const isoDow = zonedIsoDayOfWeek(probe.year, probe.month, probe.day, timezone)
      if (isoDow !== cadence.dayOfWeek) {
        probe = addCalendarDays(probe, 1)
        continue
      }
    }

    const instantMs = resolveZonedLocalInstant({
      timeZone: timezone,
      year: probe.year,
      month: probe.month,
      day: probe.day,
      hour,
      minute,
    })

    if (instantMs > afterMs) {
      return new Date(instantMs).toISOString()
    }

    probe = addCalendarDays(probe, 1)
  }

  throw new Error('Cadence recurrence walk exceeded bound while computing next nominal')
}

/**
 * Enumerate/classify missed nominals from stored `nextEligibleAt` through `now`.
 * Skips directly toward the catch-up horizon so large missed ranges stay bounded.
 * Future eligibility advances along the stored nominal grid — never resets to now+interval.
 */
export function resolveMissedNominals({
  cadence,
  nextEligibleAt,
  now,
  maximumCatchUpAgeMinutes,
  timezone,
}: {
  cadence: ConnectorScheduleCadence
  nextEligibleAt: string
  now: Date
  maximumCatchUpAgeMinutes: number
  timezone: string
}): {
  missed: string[]
  inHorizon: string[]
  futureEligibleAt: string
} {
  const nowMs = now.getTime()
  const firstDueMs = Date.parse(nextEligibleAt)

  if (!(firstDueMs <= nowMs)) {
    return { missed: [], inHorizon: [], futureEligibleAt: nextEligibleAt }
  }

  const futureEligibleAt = advanceStoredGridUntilAfter({
    cadence,
    anchorNominalAt: nextEligibleAt,
    afterMs: nowMs,
    timezone,
  })

  const secondDue = computeNextNominalAfter({
    cadence,
    after: nextEligibleAt,
    timezone,
  })
  const multipleMissed = Date.parse(secondDue) <= nowMs
  const horizonCutoffMs = nowMs - maximumCatchUpAgeMinutes * MS_PER_MINUTE

  let cursor = nextEligibleAt
  let cursorMs = firstDueMs

  if (cursorMs < horizonCutoffMs) {
    // Skip expired prefix while remaining on the cadence grid.
    if (cadence.kind === 'interval') {
      const stepMs = cadence.everyMinutes * MS_PER_MINUTE
      const steps = Math.ceil((horizonCutoffMs - cursorMs) / stepMs)
      cursorMs = firstDueMs + steps * stepMs
      cursor = new Date(cursorMs).toISOString()
    } else {
      const skipped = computeNextNominalAfter({
        cadence,
        after: horizonCutoffMs - 1,
        timezone,
      })
      const skippedMs = Date.parse(skipped)
      if (skippedMs > cursorMs) {
        cursor = skipped
        cursorMs = skippedMs
      }
    }
  }

  if (cursorMs > nowMs) {
    return {
      missed: multipleMissed ? [nextEligibleAt, secondDue] : [nextEligibleAt],
      inHorizon: [],
      futureEligibleAt,
    }
  }

  let steps = 0
  while (steps < MAX_NOMINAL_WALK_STEPS) {
    const next = computeNextNominalAfter({
      cadence,
      after: cursor,
      timezone,
    })
    const nextMs = Date.parse(next)
    if (nextMs > nowMs) {
      break
    }
    cursor = next
    cursorMs = nextMs
    steps += 1
  }

  if (steps >= MAX_NOMINAL_WALK_STEPS) {
    throw new Error('Cadence recurrence walk exceeded bound while resolving missed nominals')
  }

  const inHorizon = cursorMs >= horizonCutoffMs ? [cursor] : []
  const missed = multipleMissed
    ? [nextEligibleAt, secondDue]
    : [nextEligibleAt]

  return { missed, inHorizon, futureEligibleAt }
}

/**
 * First nominal on the stored sequence strictly after `afterMs`.
 * Interval uses direct grid arithmetic from the anchor; daily/weekly walk the calendar grid.
 */
function advanceStoredGridUntilAfter({
  cadence,
  anchorNominalAt,
  afterMs,
  timezone,
}: {
  cadence: ConnectorScheduleCadence
  anchorNominalAt: string
  afterMs: number
  timezone: string
}): string {
  if (cadence.kind === 'interval') {
    const stepMs = cadence.everyMinutes * MS_PER_MINUTE
    const anchorMs = Date.parse(anchorNominalAt)
    if (!(anchorMs <= afterMs)) {
      return anchorNominalAt
    }
    const steps = Math.floor((afterMs - anchorMs) / stepMs) + 1
    return new Date(anchorMs + steps * stepMs).toISOString()
  }

  let cursor = anchorNominalAt
  for (let step = 0; step < MAX_NOMINAL_WALK_STEPS; step += 1) {
    if (Date.parse(cursor) > afterMs) {
      return cursor
    }
    cursor = computeNextNominalAfter({
      cadence,
      after: cursor,
      timezone,
    })
  }

  throw new Error('Cadence recurrence walk exceeded bound while advancing stored grid')
}

function parseLocalTime(localTime: string): [number, number] {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(localTime)
  if (!match) {
    throw new Error(`Invalid localTime: ${localTime}`)
  }
  return [Number(match[1]), Number(match[2])]
}

function toEpochMs(value: Date | string | number): number {
  if (typeof value === 'number') {
    return value
  }
  if (value instanceof Date) {
    return value.getTime()
  }
  return Date.parse(value)
}

function getZonedParts(instant: Date, timeZone: string, formatter?: Intl.DateTimeFormat): ZonedParts {
  const parts = (formatter ?? new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })).formatToParts(instant)

  const read = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((part) => part.type === type)?.value
    if (!value) {
      throw new Error(`Missing ${type} for timezone ${timeZone}`)
    }
    return Number(value)
  }

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  }
}

function partsEqualWallClock(
  left: ZonedParts,
  right: Pick<ZonedParts, 'year' | 'month' | 'day' | 'hour' | 'minute'>,
): boolean {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
}

/**
 * Resolve a local civil wall-clock in an IANA zone to a UTC epoch ms.
 * Spring-forward gap → first valid instant after the gap.
 * Fall-back overlap → earlier instant.
 */
export function resolveZonedLocalInstant({
  timeZone,
  year,
  month,
  day,
  hour,
  minute,
}: {
  timeZone: string
  year: number
  month: number
  day: number
  hour: number
  minute: number
}): number {
  const wanted = { year, month, day, hour, minute }
  const formatter = createZonedFormatter(timeZone)
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0)

  for (let i = 0; i < 4; i += 1) {
    const observed = getZonedParts(new Date(utc), timeZone, formatter)
    const asUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    )
    const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0)
    const delta = desiredAsUtc - asUtc
    if (delta === 0) {
      break
    }
    utc += delta
  }

  const resolved = getZonedParts(new Date(utc), timeZone, formatter)
  if (partsEqualWallClock(resolved, wanted)) {
    return earliestMatchingWallInstant({
      formatter,
      timeZone,
      utc,
      wanted,
    })
  }

  // Nonexistent local time (spring-forward): walk forward to the first valid instant
  // on this local calendar day at or after the requested wall clock, else next day start.
  const dayStartGuess = Date.UTC(year, month - 1, day, 0, 0, 0) - MS_PER_DAY
  let probe = Math.max(dayStartGuess, utc - MS_PER_DAY)
  const probeEnd = utc + MS_PER_DAY

  while (probe <= probeEnd) {
    const parts = getZonedParts(new Date(probe), timeZone, formatter)
    if (
      parts.year === year
      && parts.month === month
      && parts.day === day
      && (parts.hour > hour || (parts.hour === hour && parts.minute >= minute))
    ) {
      return probe
    }
    if (
      parts.year > year
      || (parts.year === year && parts.month > month)
      || (parts.year === year && parts.month === month && parts.day > day)
    ) {
      return probe
    }
    probe += MS_PER_MINUTE
  }

  throw new Error(
    `Unable to resolve local ${year}-${month}-${day} ${hour}:${minute} in ${timeZone}`,
  )
}

function createZonedFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function utcOffsetAt(
  instantMs: number,
  timeZone: string,
  formatter: Intl.DateTimeFormat,
): number {
  const parts = getZonedParts(new Date(instantMs), timeZone, formatter)
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  return instantMs - asUtc
}

/**
 * Choose the earliest UTC instant for a valid local wall time.
 * Observe UTC offsets at a fixed symmetric day-scale window around the
 * converged candidate, then evaluate candidates for those offsets only.
 */
function earliestMatchingWallInstant({
  formatter,
  timeZone,
  utc,
  wanted,
}: {
  formatter: Intl.DateTimeFormat
  timeZone: string
  utc: number
  wanted: { year: number; month: number; day: number; hour: number; minute: number }
}): number {
  const sampleInstants = [
    utc,
    utc - MS_PER_DAY,
    utc + MS_PER_DAY,
    utc - 2 * MS_PER_DAY,
    utc + 2 * MS_PER_DAY,
  ] as const

  const offsets = new Set<number>()
  for (const sample of sampleInstants) {
    offsets.add(utcOffsetAt(sample, timeZone, formatter))
  }

  const wallAsUtc = Date.UTC(
    wanted.year,
    wanted.month - 1,
    wanted.day,
    wanted.hour,
    wanted.minute,
    0,
  )

  let earliest: number | null = null
  for (const offset of offsets) {
    const candidate = wallAsUtc + offset
    const parts = getZonedParts(new Date(candidate), timeZone, formatter)
    if (!partsEqualWallClock(parts, wanted)) {
      continue
    }
    if (earliest === null || candidate < earliest) {
      earliest = candidate
    }
  }

  return earliest ?? utc
}

function addCalendarDays(
  date: { year: number; month: number; day: number },
  days: number,
): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  }
}

/** ISO day-of-week 1=Monday … 7=Sunday for a civil date in `timeZone`. */
function zonedIsoDayOfWeek(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): number {
  // Noon local avoids most DST edge ambiguity when reading weekday for a civil date.
  const noon = resolveZonedLocalInstant({
    timeZone,
    year,
    month,
    day,
    hour: 12,
    minute: 0,
  })
  const jsDay = new Date(noon).getUTCDay() // 0=Sunday … 6=Saturday in UTC
  // Re-read weekday in zone via formatter to avoid UTC weekday skew near zone boundaries.
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(new Date(noon))
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  }
  const iso = map[weekday]
  if (!iso) {
    // Fallback from UTC day if locale short name unexpected.
    return jsDay === 0 ? 7 : jsDay
  }
  return iso
}
