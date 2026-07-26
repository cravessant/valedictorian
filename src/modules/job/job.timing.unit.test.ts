import { describe, expect, it } from 'vitest'
import { jobFactsSchema } from '@sparxie/sdk'
import { jobFactsTiming, normalizeLifecycleJobTerms } from './job.timing'

const UNKNOWN = { terms: [], timingMode: 'unknown', startDate: null, endDate: null } as const

describe('normalizeLifecycleJobTerms', () => {
  it('orders by year, then by the owned season order that closes the year with winter', () => {
    expect(normalizeLifecycleJobTerms([
      { season: 'winter', year: 2026 },
      { season: 'spring', year: 2027 },
      { season: 'fall', year: 2026 },
      { season: 'summer', year: 2026 },
      { season: 'spring', year: 2026 },
    ])).toEqual([
      { season: 'spring', year: 2026 },
      { season: 'summer', year: 2026 },
      { season: 'fall', year: 2026 },
      { season: 'winter', year: 2026 },
      { season: 'spring', year: 2027 },
    ])
  })

  it('deduplicates repeated terms', () => {
    expect(normalizeLifecycleJobTerms([
      { season: 'fall', year: 2026 },
      { season: 'winter', year: 2026 },
      { season: 'fall', year: 2026 },
    ])).toEqual([{ season: 'fall', year: 2026 }, { season: 'winter', year: 2026 }])
  })

  it('rejects terms the live contract does not admit', () => {
    expect(() => normalizeLifecycleJobTerms([{ season: 'autumn', year: 2026 }] as never)).toThrow()
    expect(() => normalizeLifecycleJobTerms([{ season: 'fall', year: 1999 }])).toThrow()
    expect(() => normalizeLifecycleJobTerms([{ season: 'fall', year: 2201 }])).toThrow()
    expect(() => normalizeLifecycleJobTerms([{ season: 'fall', year: 2026.5 }])).toThrow()
    expect(() => normalizeLifecycleJobTerms([{ season: 'fall', year: 2026, label: 'x' }] as never)).toThrow()
    // The contract caps the supplied array, so an oversized input is rejected before dedup.
    expect(() => normalizeLifecycleJobTerms(
      Array.from({ length: 21 }, () => ({ season: 'fall', year: 2026 } as const)),
    )).toThrow()
  })
})

describe('jobFactsTiming', () => {
  it('projects term from the structured terms across the lifecycle season vocabulary', () => {
    expect(jobFactsTiming({ ...UNKNOWN, terms: [{ season: 'fall', year: 2026 }] }).term).toBe('Fall 2026')
    expect(jobFactsTiming({
      ...UNKNOWN,
      terms: [{ season: 'winter', year: 2026 }, { season: 'spring', year: 2027 }],
      timingMode: 'fixed',
    }).term).toBe('Winter 2026 / Spring 2027')
  })

  it('emits canonical terms and derives term from that same normalized array', () => {
    const timing = jobFactsTiming({
      ...UNKNOWN,
      terms: [
        { season: 'fall', year: 2026 },
        { season: 'spring', year: 2026 },
        { season: 'fall', year: 2026 },
        { season: 'winter', year: 2026 },
      ],
      timingMode: 'fixed',
    })
    expect(timing.terms).toEqual([
      { season: 'spring', year: 2026 },
      { season: 'fall', year: 2026 },
      { season: 'winter', year: 2026 },
    ])
    expect(timing.term).toBe('Spring 2026 / Fall 2026 / Winter 2026')
  })

  it('projects a null term when no structured terms are supplied', () => {
    expect(jobFactsTiming(UNKNOWN).term).toBeNull()
  })

  it('rejects a retired term input instead of ignoring it', () => {
    expect(() => jobFactsTiming({ ...UNKNOWN, term: 'Fall 2026 internship' } as never))
      .toThrow(/does not accept term/)
  })

  it('composes a contract-valid timing block for a Job facts write', () => {
    const facts = {
      companyName: 'Acme',
      roleTitle: 'Staff Engineer',
      sourceName: 'LinkedIn',
      roleKind: 'experienced',
      ...jobFactsTiming({
        terms: [{ season: 'fall', year: 2026 }],
        timingMode: 'fixed',
        startDate: '2026-09-01',
        endDate: '2027-05-01',
      }),
      location: null,
      workMode: 'unknown',
      employmentType: 'unknown',
      seniority: 'unknown',
      compensation: null,
      postedAt: null,
      destination: null,
    }
    expect(jobFactsSchema.parse(facts)).toMatchObject({ term: 'Fall 2026', terms: [{ season: 'fall', year: 2026 }] })
  })
})
