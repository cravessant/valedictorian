/**
 * Canonical Job facts timing composition (issue #396).
 *
 * Every Job facts write composes its timing block here. The canonical inputs are the
 * structured `terms` plus `timingMode`/`startDate`/`endDate`; the contract's `term` is a
 * formatted display projection of `terms` and is never accepted as an input. A caller that
 * still supplies `term` is rejected rather than silently ignored, matching the SDK's
 * `normalizeJobTimingInput` admission.
 *
 * Terms are canonicalized before they are persisted or projected: validated against the live
 * `jobFactsSchema.shape.terms` contract (season vocabulary, year bounds, strict keys, and the
 * array cap — read from the schema so none of it is restated here), deduplicated, then ordered
 * by year and season. `term` is formatted from that same normalized array, so the display
 * projection and the stored structure can never disagree.
 *
 * The projection is app-owned because lifecycle Job terms use `lifecycleJobSeasons`, which
 * carries `winter`; the SDK's `formatJobTerms`/`normalizeJobTerms` cover only the three-season
 * vocabulary and reject a winter term outright. `SEASON_ORDER` therefore extends the SDK's
 * spring/summer/fall order with winter in the year-closing position, so every term set the SDK
 * can also express sorts identically here.
 */
import { jobFactsSchema, type Job } from '@sparxie/sdk'

type JobFacts = Job['facts']
type LifecycleJobTerm = JobFacts['terms'][number]

const SEASON_ORDER: Record<LifecycleJobTerm['season'], number> = {
  spring: 1,
  summer: 2,
  fall: 3,
  winter: 4,
}

const SEASON_LABELS: Record<LifecycleJobTerm['season'], string> = {
  spring: 'Spring',
  summer: 'Summer',
  fall: 'Fall',
  winter: 'Winter',
}

/** The canonical timing block of a Job facts blob, including the derived `term` projection. */
export type JobFactsTiming = Pick<JobFacts, 'term' | 'terms' | 'timingMode' | 'startDate' | 'endDate'>

export interface JobFactsTimingInput {
  readonly terms: readonly LifecycleJobTerm[]
  readonly timingMode: JobFacts['timingMode']
  readonly startDate: string | null
  readonly endDate: string | null
}

/** Contract-validated, deduplicated, chronologically ordered lifecycle terms. */
export function normalizeLifecycleJobTerms(terms: readonly LifecycleJobTerm[]): LifecycleJobTerm[] {
  const byKey = new Map<string, LifecycleJobTerm>()
  for (const term of jobFactsSchema.shape.terms.parse(terms)) {
    byKey.set(`${term.season}:${term.year}`, term)
  }
  return [...byKey.values()].sort((left, right) =>
    left.year === right.year
      ? SEASON_ORDER[left.season] - SEASON_ORDER[right.season]
      : left.year - right.year,
  )
}

function formatNormalizedTerms(terms: readonly LifecycleJobTerm[]): string | null {
  if (terms.length === 0) return null
  return terms.map((term) => `${SEASON_LABELS[term.season]} ${term.year}`).join(' / ')
}

export function jobFactsTiming(input: JobFactsTimingInput): JobFactsTiming {
  if (Object.prototype.hasOwnProperty.call(input, 'term')) {
    throw new Error('Job timing input does not accept term; provide structured terms.')
  }
  const terms = normalizeLifecycleJobTerms(input.terms)
  return {
    term: formatNormalizedTerms(terms),
    terms,
    timingMode: input.timingMode,
    startDate: input.startDate,
    endDate: input.endDate,
  }
}
